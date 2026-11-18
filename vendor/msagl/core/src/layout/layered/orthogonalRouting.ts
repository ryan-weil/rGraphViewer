import {Curve, PointLocation} from '../../math/geometry/curve'
import {Point} from '../../math/geometry/point'
import {RectilinearEdgeRouter} from '../../routing/rectilinear/RectilinearEdgeRouter'
import {BasicGraph} from '../../structs/BasicGraph'
import {Arrowhead} from '../core/arrowhead'
import {FloatingPort} from '../core/floatingPort'
import {GeomEdge} from '../core/geomEdge'
import {GeomGraph} from '../core/geomGraph'
import {GeomNode} from '../core/geomNode'
import {EdgeLabelPlacement} from '../edgeLabelPlacement'
import {Anchor} from './anchor'
import {Database} from './Database'
import {LayerArrays} from './LayerArrays'
import {PolyIntEdge} from './polyIntEdge'

/** Distance between parallel edge segments, and between a node and an edge that passes along it. */
const GAP = 12
/** Distance between neighboring edge ends on a node side. */
const END_SPACING = 16
/** Least distance from an edge end to either end of the node side, which keeps ends off rounded corners. */
const CORNER_CLEARANCE = 8
const CORNER_RADIUS = 3
/** Sort keys that put detour ends outside every edge end that heads toward a column. */
const OUTSIDE = 1e12

/** Where a net's end meets its channel: the side the edge comes from or goes to. */
const enum Side {
  Top,
  Bottom,
}

/** The piece of one edge inside one channel, the space between two neighboring layers. The edge enters the
 * channel at `entry` and leaves it at `exit` (x coordinates); a net whose entry and exit coincide is a straight
 * vertical through the channel, every other net runs horizontally along one track. */
class Net {
  track = 0
  y = 0
  constructor(
    readonly channel: Channel,
    public entry: number,
    readonly entrySide: Side,
    public exit: number,
    readonly exitSide: Side,
  ) {
    channel.nets.push(this)
  }
  get straight(): boolean {
    return this.entrySide !== this.exitSide && Math.abs(this.entry - this.exit) < 1e-6
  }
  get low(): number {
    return Math.min(this.entry, this.exit)
  }
  get high(): number {
    return Math.max(this.entry, this.exit)
  }
}

/** The space between two neighboring layers (or above the first layer, or below the last one). */
class Channel {
  nets: Net[] = []
  constructor(readonly upperLayer: number, readonly lowerLayer: number) {}
}

/** One end of an edge on a node side, waiting for its x. */
class End {
  x = 0
  constructor(readonly node: number, readonly key: number) {}
}

/** A column beside a node through which an edge passes the node's layer; its index counts from the node outward. */
class Detour {
  index = 0
  x = 0
  constructor(readonly node: number, readonly right: boolean, readonly key: number) {}
}

/** A column an upward edge passes a layer through, outside its loop: beside the loop's outermost vertex of that
 * layer. Rails of one vertex side are numbered from the inside out, after the vertex's own detours. */
class Rail {
  index = 0
  x = 0
  constructor(readonly vertex: number, readonly right: boolean) {}
}

/** Where an edge crosses a channel, roughly: x on the channel's top side and x on its bottom side. A way around
 * a node has two ends on one side (two tops below the node, two bottoms above it). */
class Sketch {
  constructor(readonly e: PolyIntEdge, readonly tops: number[], readonly bottoms: number[]) {}
}

/** How an edge passes the layers between its ends: through the layout's own vertices (downward edges and upward
 * edges without a loop), or for an upward edge around the loop it closes. */
class Plan {
  lowDetour: Detour = null
  highDetour: Detour = null
  /** For an upward edge, the column of every layer strictly between its ends, from the top: a rail or a vertex. */
  columns: Array<Rail | number> = null
  constructor(readonly e: PolyIntEdge, readonly chain: number[], readonly upward: boolean) {}
}

/** The way of one edge: its two ends and its nets, in drawing order. */
class EdgeWay {
  nets: Net[] = []
  constructor(readonly edge: GeomEdge, readonly start: End, readonly end: End) {}
}

function byKey(a: {key: number}, b: {key: number}): number {
  return a.key - b.key
}

function bySize(a: {size: number}, b: {size: number}): number {
  return a.size - b.size
}

/** Routes the edges of a top-to-bottom layered layout with horizontal and vertical segments that follow the
 * layout: an edge leaves its source at the bottom, enters its target at the top, and passes every layer between
 * them through the column the layout reserved for it, so that it crosses only the edges the layer order makes it
 * cross. An edge drawn upward closes a loop (the vertices below its target that reach its source); it leaves its
 * source at the bottom, goes up around the loop on the side where it crosses fewer edges, and enters its target at
 * the top. A self-edge goes around its node. Horizontal segments run on separate tracks between layers, in an order
 * that keeps them off the vertical segments of the other edges where possible, and layers move apart when they
 * need more room. Edges this cannot route (flat edges, edges of clusters) are left to the rectilinear router. */
export class OrthogonalLayeredRouting {
  private layersTopDown: number[] = []
  private rank = new Map<number, number>()
  private layerOfVertex: number[]
  private channelBelow = new Map<number, Channel>()
  private channels: Channel[] = []
  private ways: EdgeWay[] = []
  private bottomEnds = new Map<number, End[]>()
  private topEnds = new Map<number, End[]>()
  private detours = new Map<number, Detour[]>()
  private rails = new Map<number, Rail[]>()
  private element: boolean[]
  private sketches = new Map<Channel, Sketch[]>()

  constructor(
    private readonly graph: GeomGraph,
    private readonly database: Database,
    private readonly layerArrays: LayerArrays,
    private readonly intGraph: BasicGraph<GeomNode, PolyIntEdge>,
  ) {}

  /** True when every node is a plain node, so that the layered layout's anchors describe all obstacles. */
  static canRoute(graph: GeomGraph): boolean {
    for (const node of graph.shallowNodes) if (node instanceof GeomGraph) return false
    return true
  }

  run() {
    const anchors = this.database.Anchors
    this.layerOfVertex = this.layerArrays.y
    this.createChannels()

    // Placeholder edges of the layout have no drawn edge behind them.
    const plans: Plan[] = []
    for (const list of this.database.RegularMultiedges()) {
      for (const e of list) {
        if (e.edge == null || e.IsVirtualEdge) continue
        const chain = this.chainOf(e, anchors)
        if (chain != null) plans.push(new Plan(e, chain, e.edge.source !== this.intGraph.nodes[chain[0]]))
      }
    }
    const selfEdges: PolyIntEdge[] = []
    for (const [pair, list] of this.database.Multiedges.keyValues()) {
      if (pair.x === pair.y) for (const e of list) if (e.edge != null && !e.IsVirtualEdge) selfEdges.push(e)
    }

    const loops = this.findLoops(plans)
    // The vertices that are drawn: nodes, and the layout's vertices of the edges that pass layers through them.
    this.element = new Array<boolean>(anchors.length).fill(false)
    for (let i = 0; i < this.intGraph.nodeCount; i++) this.element[i] = true
    for (const plan of plans) if (!loops.has(plan)) for (const v of plan.chain) this.element[v] = true
    for (const plan of plans) if (!loops.has(plan)) this.sketchThroughVertices(plan, anchors)

    // Upward edges choose their sides, the inner loops first, so that the outer ones go around them.
    const ordered: Array<{plan: Plan; size: number}> = []
    for (const [plan, body] of loops) ordered.push({plan, size: body.size})
    ordered.sort(bySize)
    for (const {plan} of ordered) this.planLoop(plan, loops.get(plan), anchors)
    for (const plan of plans) if (plan.upward && !loops.has(plan)) this.planUpwardThroughVertices(plan, anchors)
    const selfDetours = new Map<PolyIntEdge, Detour>()
    for (const e of selfEdges) selfDetours.set(e, this.addDetour(e.source, true, 1, 0))
    this.orderDetours()
    this.widenLayers(anchors)
    this.placeColumns(anchors)
    this.updateNodeCenters(anchors)

    // Edge ends, ordered by where the edge goes next, so that edges of one node do not cross each other.
    for (const plan of plans) {
      const high = plan.chain[0]
      const low = plan.chain[plan.chain.length - 1]
      let start: End
      let end: End
      if (!plan.upward) {
        start = this.addEnd(this.bottomEnds, high, anchors[plan.chain[1]].x)
        end = this.addEnd(this.topEnds, low, anchors[plan.chain[plan.chain.length - 2]].x)
      } else {
        start = this.addEnd(this.bottomEnds, low, detourKey(plan.lowDetour))
        end = this.addEnd(this.topEnds, high, detourKey(plan.highDetour))
      }
      this.ways.push(new EdgeWay(plan.e.edge, start, end))
    }
    for (const e of selfEdges) {
      const detour = selfDetours.get(e)
      this.ways.push(new EdgeWay(e.edge, this.addEnd(this.bottomEnds, e.source, detourKey(detour)), this.addEnd(this.topEnds, e.source, detourKey(detour))))
    }
    this.placeEnds(this.bottomEnds, false)
    this.placeEnds(this.topEnds, true)

    // Nets, channel by channel, in drawing order.
    let wayIndex = 0
    for (const plan of plans) this.createNets(this.ways[wayIndex++], plan, anchors)
    for (const e of selfEdges) this.createSelfNets(this.ways[wayIndex++], e.source, selfDetours.get(e))

    this.assignTracksAndSpreadLayers(anchors)
    this.updateNodeCenters(anchors)
    for (const way of this.ways) this.setCurve(way)
    const labeled: GeomEdge[] = []
    for (const way of this.ways) if (way.edge.label != null) labeled.push(way.edge)
    if (labeled.length > 0) EdgeLabelPlacement.constructorGA(this.graph, labeled).run()
  }

  private createChannels() {
    const layers = this.layerArrays.Layers
    for (let i = 0; i < layers.length; i++) if (layers[i].length > 0) this.layersTopDown.push(i)
    this.layersTopDown.sort(this.compareLayersTopDown.bind(this))
    for (let i = 0; i < this.layersTopDown.length; i++) this.rank.set(this.layersTopDown[i], i)
    // one channel above every layer and one below the last
    let upper = -1
    for (const layer of this.layersTopDown) {
      const channel = new Channel(upper, layer)
      this.channels.push(channel)
      this.channelBelow.set(upper, channel)
      upper = layer
    }
    const last = new Channel(upper, -1)
    this.channels.push(last)
    this.channelBelow.set(upper, last)
  }

  private compareLayersTopDown(a: number, b: number): number {
    return this.layerY(b) - this.layerY(a)
  }

  private layerY(layer: number): number {
    return this.database.Anchors[this.layerArrays.Layers[layer][0]].y
  }

  private rankOf(vertex: number): number {
    return this.rank.get(this.layerOfVertex[vertex])
  }

  /** The vertices of an edge from its upper end to its lower end, one per layer; null for a flat edge. */
  private chainOf(e: PolyIntEdge, anchors: Anchor[]): number[] {
    if (e.LayerEdges == null || e.LayerEdges.length === 0) return null
    const chain = [e.LayerEdges[0].Source]
    for (const le of e.LayerEdges) chain.push(le.Target)
    for (let i = 1; i < chain.length; i++) if (this.layerOfVertex[chain[i]] === this.layerOfVertex[chain[i - 1]]) return null
    if (anchors[chain[0]].y < anchors[chain[chain.length - 1]].y) chain.reverse()
    if (chain[0] >= this.intGraph.nodeCount || chain[chain.length - 1] >= this.intGraph.nodeCount) return null
    return chain
  }

  /** For every upward edge, the vertices of the loop it closes: those reached going down from its target that reach
   * its source going down, both ends included. Upward edges whose source cannot be reached have no loop. */
  private findLoops(plans: Plan[]): Map<Plan, Set<number>> {
    const down = new Map<number, number[]>()
    const up = new Map<number, number[]>()
    for (const plan of plans) {
      if (plan.upward) continue
      for (let i = 0; i + 1 < plan.chain.length; i++) {
        addTo(down, plan.chain[i], plan.chain[i + 1])
        addTo(up, plan.chain[i + 1], plan.chain[i])
      }
    }
    const loops = new Map<Plan, Set<number>>()
    for (const plan of plans) {
      if (!plan.upward) continue
      const high = plan.chain[0]
      const low = plan.chain[plan.chain.length - 1]
      const lowest = this.rankOf(low)
      const highest = this.rankOf(high)
      const fromHigh = reach(high, down, this.layerOfVertex, this.rank, highest, lowest)
      if (!fromHigh.has(low)) continue
      const toLow = reach(low, up, this.layerOfVertex, this.rank, highest, lowest)
      const body = new Set<number>()
      for (const v of fromHigh) if (toLow.has(v)) body.add(v)
      loops.set(plan, body)
    }
    return loops
  }

  /** Records where an edge that passes the layers through the layout's vertices crosses each channel. */
  private sketchThroughVertices(plan: Plan, anchors: Anchor[]) {
    const chain = plan.chain
    for (let i = 0; i + 1 < chain.length; i++) {
      this.addSketch(this.channelUnder(chain[i]), new Sketch(plan.e, [anchors[chain[i]].x], [anchors[chain[i + 1]].x]))
    }
  }

  private addSketch(channel: Channel, sketch: Sketch) {
    let list = this.sketches.get(channel)
    if (list == null) {
      list = []
      this.sketches.set(channel, list)
    }
    list.push(sketch)
  }

  /** Chooses the side an upward edge goes around its loop on, reserves its detours beside its two nodes and its
   * rails outside the loop, and records where it crosses the channels. */
  private planLoop(plan: Plan, body: Set<number>, anchors: Anchor[]) {
    const chain = plan.chain
    const last = chain.length - 1
    // the loop's outermost vertices of every layer strictly between the edge's ends
    const leftmost: number[] = []
    const rightmost: number[] = []
    for (let i = 1; i < last; i++) {
      const layer = this.layerOfVertex[chain[i]]
      let left = -1
      let right = -1
      for (const v of this.layerArrays.Layers[layer]) {
        if (!body.has(v) || !this.element[v]) continue
        if (left < 0 || anchors[v].left < anchors[left].left) left = v
        if (right < 0 || anchors[v].right > anchors[right].right) right = v
      }
      leftmost.push(left)
      rightmost.push(right)
    }
    const leftCrossings = this.loopCrossings(plan, leftmost, false, anchors)
    const rightCrossings = this.loopCrossings(plan, rightmost, true, anchors)
    const right = rightCrossings < leftCrossings
    plan.lowDetour = this.addDetour(chain[last], right, 2, 0)
    plan.highDetour = this.addDetour(chain[0], right, 3, 0)
    plan.columns = []
    const outer = right ? rightmost : leftmost
    for (let i = 0; i < outer.length; i++) {
      if (outer[i] < 0) plan.columns.push(chain[i + 1])
      else plan.columns.push(this.addRail(outer[i], right))
    }
    for (const [channel, sketch] of this.loopSketches(plan, outer, right, anchors)) this.addSketch(channel, sketch)
  }

  private loopCrossings(plan: Plan, outer: number[], right: boolean, anchors: Anchor[]): number {
    let crossings = 0
    for (const [channel, sketch] of this.loopSketches(plan, outer, right, anchors)) crossings += this.crossingsWith(channel, sketch)
    return crossings
  }

  /** Where the upward edge would cross each channel going around its loop on one side: pairs of channel and sketch. */
  private loopSketches(plan: Plan, outer: number[], right: boolean, anchors: Anchor[]): Array<[Channel, Sketch]> {
    const chain = plan.chain
    const last = chain.length - 1
    const low = anchors[chain[last]]
    const high = anchors[chain[0]]
    const lowDetour = right ? low.right + GAP : low.left - GAP
    const highDetour = right ? high.right + GAP : high.left - GAP
    const column: number[] = [highDetour]
    for (let i = 0; i < outer.length; i++) {
      const v = outer[i]
      if (v < 0) column.push(anchors[chain[i + 1]].x)
      else column.push(right ? anchors[v].right + GAP * (1 + this.railCount(v, true)) : anchors[v].left - GAP * (1 + this.railCount(v, false)))
    }
    column.push(lowDetour)
    const pieces: Array<[Channel, Sketch]> = []
    pieces.push([this.channelUnder(chain[last]), new Sketch(plan.e, [low.x, lowDetour], [])])
    for (let i = last; i > 0; i--) pieces.push([this.channelOver(chain[i]), new Sketch(plan.e, [column[i - 1]], [column[i]])])
    pieces.push([this.channelOver(chain[0]), new Sketch(plan.e, [], [high.x, highDetour])])
    return pieces
  }

  private crossingsWith(channel: Channel, sketch: Sketch): number {
    const list = this.sketches.get(channel)
    let count = 0
    if (list != null) for (const other of list) if (other.e !== sketch.e && sketchesCross(sketch, other)) count++
    return count
  }

  /** An upward edge without a loop passes the layers through the layout's own vertices, with detours beside its ends
   * on the sides where they cross fewer edges. */
  private planUpwardThroughVertices(plan: Plan, anchors: Anchor[]) {
    const chain = plan.chain
    const last = chain.length - 1
    const towardHigh = anchors[chain[last - 1]].x
    const towardLow = anchors[chain[1]].x
    const lowRight = this.detourSide(this.sketches.get(this.channelOver(chain[last])), plan.e, towardHigh, anchors[chain[last]], true)
    const highRight = this.detourSide(this.sketches.get(this.channelUnder(chain[0])), plan.e, towardLow, anchors[chain[0]], false)
    plan.lowDetour = this.addDetour(chain[last], lowRight, 2, towardHigh)
    plan.highDetour = this.addDetour(chain[0], highRight, 3, towardLow)
    plan.columns = []
    for (let i = 1; i < last; i++) plan.columns.push(chain[i])
  }

  /** The side of a node whose detour crosses fewer of the sketched edges in the channel the edge enters from there
   * (above the node when it leaves the node upward, below it when it arrives there from below); on a tie, the side
   * of the column it heads for. */
  private detourSide(sketches: Sketch[], e: PolyIntEdge, toward: number, node: Anchor, leavingUpward: boolean): boolean {
    const left = node.left - GAP
    const right = node.right + GAP
    let leftCrossings = 0
    let rightCrossings = 0
    if (sketches != null) {
      for (const g of sketches) {
        if (g.e === e) continue
        const leftSketch = leavingUpward ? new Sketch(e, [toward], [left]) : new Sketch(e, [left], [toward])
        const rightSketch = leavingUpward ? new Sketch(e, [toward], [right]) : new Sketch(e, [right], [toward])
        if (sketchesCross(leftSketch, g)) leftCrossings++
        if (sketchesCross(rightSketch, g)) rightCrossings++
      }
    }
    if (leftCrossings !== rightCrossings) return rightCrossings < leftCrossings
    return toward >= node.x
  }

  /** Reserves a column beside a node. `kind` orders the detours of one side: self-edges (1) innermost, then edges
   * that go on upward from the node (2), then edges that come up to the node (3); `toward` orders those of one kind. */
  private addDetour(node: number, right: boolean, kind: number, toward: number): Detour {
    const detour = new Detour(node, right, kind * OUTSIDE + (right ? toward : -toward))
    addTo(this.detours, node, detour)
    return detour
  }

  private addRail(vertex: number, right: boolean): Rail {
    const rail = new Rail(vertex, right)
    rail.index = this.railCount(vertex, right) + 1
    addTo(this.rails, vertex, rail)
    return rail
  }

  private railCount(vertex: number, right: boolean): number {
    const list = this.rails.get(vertex)
    let count = 0
    if (list != null) for (const rail of list) if (rail.right === right) count++
    return count
  }

  private orderDetours() {
    for (const list of this.detours.values()) {
      list.sort(byKey)
      let left = 0
      let right = 0
      for (const detour of list) detour.index = detour.right ? ++right : ++left
    }
  }

  private detourCount(node: number, right: boolean): number {
    const list = this.detours.get(node)
    let count = 0
    if (list != null) for (const detour of list) if (detour.right === right) count++
    return count
  }

  /** The columns beside a vertex on one side: its detours, then the rails of the loops it bounds. */
  private columnsBeside(vertex: number, right: boolean): number {
    return this.detourCount(vertex, right) + this.railCount(vertex, right)
  }

  /** Moves the vertices of a layer apart where the columns beside them need more room than the layout left. */
  private widenLayers(anchors: Anchor[]) {
    for (const layer of this.layersTopDown) {
      const vertices: number[] = []
      for (const v of this.layerArrays.Layers[layer]) if (this.element[v]) vertices.push(v)
      vertices.sort(compareByX.bind(null, anchors))
      let shift = 0
      for (let i = 0; i < vertices.length; i++) {
        const anchor = anchors[vertices[i]]
        anchor.x += shift
        if (i === 0) continue
        const before = anchors[vertices[i - 1]]
        const needed = this.columnsBeside(vertices[i - 1], true) + this.columnsBeside(vertices[i], false)
        if (needed === 0) continue
        const room = (needed + 1) * GAP
        const free = anchor.left - before.right
        if (free < room) {
          anchor.x += room - free
          shift += room - free
        }
      }
    }
  }

  private placeColumns(anchors: Anchor[]) {
    for (const [node, list] of this.detours) {
      const anchor = anchors[node]
      for (const detour of list) detour.x = detour.right ? anchor.right + detour.index * GAP : anchor.left - detour.index * GAP
    }
    for (const [vertex, list] of this.rails) {
      const anchor = anchors[vertex]
      for (const rail of list) {
        const offset = (this.detourCount(vertex, rail.right) + rail.index) * GAP
        rail.x = rail.right ? anchor.right + offset : anchor.left - offset
      }
    }
  }

  private addEnd(ends: Map<number, End[]>, node: number, key: number): End {
    const end = new End(node, key)
    addTo(ends, node, end)
    return end
  }

  /** Spreads the ends of every node side around its middle in the order of their keys; on a side that is not
   * flat, such as an ellipse's, they all share the middle. */
  private placeEnds(ends: Map<number, End[]>, top: boolean) {
    for (const [node, list] of ends) {
      list.sort(byKey)
      const geomNode = this.intGraph.nodes[node]
      const box = geomNode.boundingBox
      let spacing = list.length > 1 ? Math.min(END_SPACING, Math.max(0, box.width - 2 * CORNER_CLEARANCE) / (list.length - 1)) : 0
      const reach = ((list.length - 1) / 2) * spacing
      const y = top ? box.top : box.bottom
      if (
        spacing > 0 &&
        (Curve.PointRelativeToCurveLocation(new Point(box.center.x - reach, y), geomNode.boundaryCurve) !== PointLocation.Boundary ||
          Curve.PointRelativeToCurveLocation(new Point(box.center.x + reach, y), geomNode.boundaryCurve) !== PointLocation.Boundary)
      ) {
        spacing = 0
      }
      for (let i = 0; i < list.length; i++) list[i].x = box.center.x + (i - (list.length - 1) / 2) * spacing
    }
  }

  private channelUnder(vertex: number): Channel {
    return this.channelBelow.get(this.layerOfVertex[vertex])
  }

  private channelOver(vertex: number): Channel {
    const index = this.rankOf(vertex)
    return this.channelBelow.get(index === 0 ? -1 : this.layersTopDown[index - 1])
  }

  private createNets(way: EdgeWay, plan: Plan, anchors: Anchor[]) {
    const chain = plan.chain
    const last = chain.length - 1
    if (!plan.upward) {
      for (let i = 0; i < last; i++) {
        const entry = i === 0 ? way.start.x : anchors[chain[i]].x
        const exit = i + 1 === last ? way.end.x : anchors[chain[i + 1]].x
        way.nets.push(new Net(this.channelUnder(chain[i]), entry, Side.Top, exit, Side.Bottom))
      }
      return
    }
    // the column of every layer from the top: the upper node's detour, the columns between, the lower node's detour
    const column: number[] = [plan.highDetour.x]
    for (const c of plan.columns) column.push(typeof c === 'number' ? anchors[c].x : c.x)
    column.push(plan.lowDetour.x)
    // out of the lower node's bottom and over to the detour beside it, up through the layers, over the upper node
    way.nets.push(new Net(this.channelUnder(chain[last]), way.start.x, Side.Top, column[last], Side.Top))
    for (let i = last; i > 0; i--) way.nets.push(new Net(this.channelOver(chain[i]), column[i], Side.Bottom, column[i - 1], Side.Top))
    way.nets.push(new Net(this.channelOver(chain[0]), column[0], Side.Bottom, way.end.x, Side.Bottom))
  }

  private createSelfNets(way: EdgeWay, node: number, detour: Detour) {
    way.nets.push(new Net(this.channelUnder(node), way.start.x, Side.Top, detour.x, Side.Top))
    way.nets.push(new Net(this.channelOver(node), detour.x, Side.Bottom, way.end.x, Side.Bottom))
  }

  /** Puts the nets of every channel on tracks and, going down, moves the layers below a channel apart when its
   * tracks need more room. */
  private assignTracksAndSpreadLayers(anchors: Anchor[]) {
    for (let c = 0; c < this.channels.length; c++) {
      const channel = this.channels[c]
      const tracks = assignTracks(channel.nets)
      if (channel.upperLayer < 0) {
        // above the first layer: tracks count up from the layer
        const lowerTop = this.layerTop(channel.lowerLayer, anchors)
        for (const net of channel.nets) net.y = lowerTop + (tracks - net.track) * GAP
        continue
      }
      const upperBottom = this.layerBottom(channel.upperLayer, anchors)
      if (channel.lowerLayer < 0) {
        for (const net of channel.nets) net.y = upperBottom - (net.track + 1) * GAP
        continue
      }
      const needed = (tracks + 1) * GAP
      const height = upperBottom - this.layerTop(channel.lowerLayer, anchors)
      if (height < needed) this.moveLayersDown(c, needed - height, anchors)
      const bottom = this.layerTop(channel.lowerLayer, anchors)
      const offset = (upperBottom - bottom - (tracks - 1) * GAP) / 2
      for (const net of channel.nets) net.y = upperBottom - offset - net.track * GAP
    }
  }

  private moveLayersDown(channelIndex: number, delta: number, anchors: Anchor[]) {
    for (let c = channelIndex; c < this.channels.length; c++) {
      const layer = this.channels[c].lowerLayer
      if (layer < 0) continue
      for (const vertex of this.layerArrays.Layers[layer]) anchors[vertex].y -= delta
    }
  }

  /** The top of the highest node of a layer, or the layer's line when it has only virtual vertices. */
  private layerTop(layer: number, anchors: Anchor[]): number {
    let top = Number.NEGATIVE_INFINITY
    for (const v of this.layerArrays.Layers[layer]) if (v < this.intGraph.nodeCount) top = Math.max(top, anchors[v].top)
    return top === Number.NEGATIVE_INFINITY ? anchors[this.layerArrays.Layers[layer][0]].y : top
  }

  private layerBottom(layer: number, anchors: Anchor[]): number {
    let bottom = Number.POSITIVE_INFINITY
    for (const v of this.layerArrays.Layers[layer]) if (v < this.intGraph.nodeCount) bottom = Math.min(bottom, anchors[v].bottom)
    return bottom === Number.POSITIVE_INFINITY ? anchors[this.layerArrays.Layers[layer][0]].y : bottom
  }

  private updateNodeCenters(anchors: Anchor[]) {
    for (let i = 0; i < this.intGraph.nodeCount; i++) this.intGraph.nodes[i].center = anchors[i].origin
  }

  private setCurve(way: EdgeWay) {
    const source = way.edge.source
    const target = way.edge.target
    const points: Point[] = [new Point(way.start.x, source.boundingBox.bottom)]
    for (const net of way.nets) {
      if (net.straight) continue
      addPoint(points, new Point(net.entry, net.y))
      addPoint(points, new Point(net.exit, net.y))
    }
    addPoint(points, new Point(way.end.x, target.boundingBox.top))
    const sourcePort = new FloatingPort(source.boundaryCurve, points[0])
    sourcePort.Curve = source.boundaryCurve
    const targetPort = new FloatingPort(target.boundaryCurve, points[points.length - 1])
    targetPort.Curve = target.boundaryCurve
    way.edge.sourcePort = sourcePort
    way.edge.targetPort = targetPort
    way.edge.curve = RectilinearEdgeRouter.FitArcsIntoCorners(CORNER_RADIUS, points)
    Arrowhead.trimSplineAndCalculateArrowheadsII(way.edge, source.boundaryCurve, target.boundaryCurve, way.edge.curve, true)
  }
}

function addTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
  let list = map.get(key)
  if (list == null) {
    list = []
    map.set(key, list)
  }
  list.push(value)
}

/** The vertices reached from `start` along `next` without leaving the layers ranked `highest` to `lowest`. */
function reach(start: number, next: Map<number, number[]>, layerOf: number[], rank: Map<number, number>, highest: number, lowest: number): Set<number> {
  const seen = new Set<number>([start])
  const stack = [start]
  while (stack.length > 0) {
    const v = stack.pop()
    const list = next.get(v)
    if (list == null) continue
    for (const w of list) {
      const r = rank.get(layerOf[w])
      if (r < highest || r > lowest || seen.has(w)) continue
      seen.add(w)
      stack.push(w)
    }
  }
  return seen
}

/** Whether two edges must cross in a channel, given where they meet its sides: two edges that pass straight through
 * cross when their ends come in opposite orders on the two sides; an edge that turns back (two ends on one side)
 * crosses every edge with an end strictly between its two on that side, and every edge that turns back on the same
 * side with exactly one end between them. */
function sketchesCross(a: Sketch, b: Sketch): boolean {
  if (a.tops.length === 1 && a.bottoms.length === 1 && b.tops.length === 1 && b.bottoms.length === 1) {
    return (a.tops[0] - b.tops[0]) * (a.bottoms[0] - b.bottoms[0]) < 0
  }
  if (a.tops.length === 2) return turnCrosses(a.tops, b.tops)
  if (a.bottoms.length === 2) return turnCrosses(a.bottoms, b.bottoms)
  if (b.tops.length === 2) return turnCrosses(b.tops, a.tops)
  if (b.bottoms.length === 2) return turnCrosses(b.bottoms, a.bottoms)
  return false
}

function turnCrosses(turn: number[], others: number[]): boolean {
  const low = Math.min(turn[0], turn[1])
  const high = Math.max(turn[0], turn[1])
  let inside = 0
  for (const x of others) if (low < x && x < high) inside++
  return others.length === 2 ? inside === 1 : inside > 0
}

function compareByX(anchors: Anchor[], a: number, b: number): number {
  return anchors[a].x - anchors[b].x
}

function detourKey(detour: Detour): number {
  // the innermost detour takes the outermost end of its side, so that the ways around the node nest
  return detour.right ? OUTSIDE - detour.index : -OUTSIDE + detour.index
}

/** Appends a point unless it repeats the last one, and drops a middle point of three on one line. */
function addPoint(points: Point[], point: Point) {
  const last = points[points.length - 1]
  if (Math.abs(last.x - point.x) < 1e-6 && Math.abs(last.y - point.y) < 1e-6) return
  if (points.length >= 2) {
    const before = points[points.length - 2]
    const vertical = Math.abs(before.x - last.x) < 1e-6 && Math.abs(last.x - point.x) < 1e-6
    const horizontal = Math.abs(before.y - last.y) < 1e-6 && Math.abs(last.y - point.y) < 1e-6
    if (vertical || horizontal) points.pop()
  }
  points.push(point)
}

/** x of the ends of a net on one side of its channel. */
function pinsOn(net: Net, side: Side): number[] {
  const pins: number[] = []
  if (net.entrySide === side) pins.push(net.entry)
  if (net.exitSide === side) pins.push(net.exit)
  return pins
}

/** Orders the horizontal nets of a channel into tracks, track 0 at the top. A net must run below another whose
 * horizontal segment it would otherwise cross with a vertical end coming down from the top, and above one it would
 * cross going on down to the bottom; when such demands form a cycle, the crossing cannot be avoided and the
 * demand closing the cycle is dropped. Nets whose spans overlap never share a track. Returns the number of tracks. */
function assignTracks(nets: Net[]): number {
  const horizontal: Net[] = []
  for (const net of nets) if (!net.straight) horizontal.push(net)
  const below = new Map<Net, Net[]>()
  for (const net of horizontal) below.set(net, [])
  for (const a of horizontal) {
    for (const b of horizontal) {
      if (a === b) continue
      for (const x of pinsOn(a, Side.Top)) {
        if (b.low < x && x < b.high) below.get(a).push(b)
        // a vertical coming down from the top close to one going on down to the bottom: the first must turn above
        // the second, or the two run along each other between their tracks
        for (const y of pinsOn(b, Side.Bottom)) if (Math.abs(x - y) < GAP) below.get(a).push(b)
      }
      for (const x of pinsOn(a, Side.Bottom)) if (b.low < x && x < b.high) below.get(b).push(a)
    }
  }
  const order = topologicalOrder(horizontal, below)
  const above = new Map<Net, Net[]>()
  for (const net of horizontal) above.set(net, [])
  const rank = new Map<Net, number>()
  for (let i = 0; i < order.length; i++) rank.set(order[i], i)
  for (const [a, list] of below) for (const b of list) if (rank.get(a) < rank.get(b)) above.get(b).push(a)
  const placed: Net[] = []
  let tracks = 0
  for (const net of order) {
    let track = 0
    for (const a of above.get(net)) track = Math.max(track, a.track + 1)
    for (;;) {
      let free = true
      for (const other of placed) {
        if (other.track === track && net.low <= other.high + 1e-6 && other.low <= net.high + 1e-6) {
          free = false
          break
        }
      }
      if (free) break
      track++
    }
    net.track = track
    placed.push(net)
    tracks = Math.max(tracks, track + 1)
  }
  return tracks
}

/** A topological order of the nets by the "must run above" demands, dropping the demands that close cycles. */
function topologicalOrder(nets: Net[], below: Map<Net, Net[]>): Net[] {
  const state = new Map<Net, number>() // 1: on the stack, 2: done
  const order: Net[] = []
  for (const net of nets) if (!state.has(net)) visit(net, below, state, order)
  order.reverse()
  return order
}

function visit(start: Net, below: Map<Net, Net[]>, state: Map<Net, number>, order: Net[]) {
  // iterative depth-first search: a demand that leads back to a net on the stack closes a cycle and is skipped
  const stack: Array<{net: Net; next: number}> = [{net: start, next: 0}]
  state.set(start, 1)
  while (stack.length > 0) {
    const top = stack[stack.length - 1]
    const list = below.get(top.net)
    if (top.next < list.length) {
      const child = list[top.next++]
      if (!state.has(child)) {
        state.set(child, 1)
        stack.push({net: child, next: 0})
      }
    } else {
      state.set(top.net, 2)
      order.push(top.net)
      stack.pop()
    }
  }
}
