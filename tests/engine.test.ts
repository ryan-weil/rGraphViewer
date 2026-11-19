import test from 'node:test'
import assert from 'node:assert/strict'
import {Curve, EdgeRoutingMode, GeomEdge, GeomGraph, Graph, ICurve, LineSegment, Point, Polyline, Rectangle, Size} from '@msagl/core'
import {DrawingEdge, DrawingGraph, DrawingNode} from '@msagl/drawing'
import {dotLabelValue, graphToJSON, parseDot, parseDotLabel, parseJSON} from '@msagl/parser'
import {layoutGraph} from '../vendor/msagl/renderer-common/src/layout'
import {RectilinearEdgeRouter} from '../vendor/msagl/core/src/routing/rectilinear/RectilinearEdgeRouter'
import {Shape} from '../vendor/msagl/core/src/routing/shape'
import {LAYOUT, parseSource} from '../src/graph'

function checkObstacles(transpose: boolean) {
  const obstacles: Shape[] = []
  for (const [x, y, width, height] of [[0, 0, 20, 20], [5, 40, 40, 20], [-5, 80, 30, 20]]) {
    const center = transpose ? new Point(y, x) : new Point(x, y)
    const size = transpose ? new Size(height, width) : new Size(width, height)
    obstacles.push(new Shape(Rectangle.mkSizeCenter(size, center).perimeter()))
  }
  const router = new RectilinearEdgeRouter(obstacles, 1, 0)
  let edges = 0
  for (const edge of router.VisibilityGraph.Edges) {
    edges++
    const line = LineSegment.mkPP(edge.SourcePoint, edge.TargetPoint)
    for (const obstacle of obstacles) {
      const interior = obstacle.BoundingBox.clone()
      interior.pad(-0.001)
      assert.equal(Curve.getAllIntersections(line, interior.perimeter(), false).length, 0)
    }
  }
  assert.ok(edges > 0)
}

function verticalObstacles() { checkObstacles(false) }
function horizontalObstacles() { checkObstacles(true) }

function measure(text: string): Size {
  let width = 0
  for (const line of text.split('\n')) width = Math.max(width, line.length * 7)
  return new Size(width, text.split('\n').length * 15)
}

function tallGraphLabelsAndRoutes() {
  const source = ['digraph { node [shape=box]']
  for (let i = 0; i < 199; i++) source.push(`n${i} -> n${i + 1} [label="Next"]`)
  source.push('n199 -> n0 [label="Return"]', 'n139 -> n60 [label="Loop"]', '}')
  let graph = parseDot(source.join('\n'))
  ;(DrawingGraph.getDrawingObj(graph) as DrawingGraph).createGeometry(measure)
  graph = parseJSON(graphToJSON(graph))
  layoutGraph(graph, LAYOUT, true)
  const geom = GeomGraph.getGeom(graph)
  const labels = new Set<string>()
  for (const edge of geom.deepEdges) {
    assert.ok(edge.curve)
    assert.equal(edge.label.isPositioned, true)
    labels.add(`${edge.label.center.x},${edge.label.center.y}`)
    for (const node of geom.nodesBreadthFirst) {
      if (node === edge.source || node === edge.target) continue
      const interior = node.boundingBox.clone()
      interior.pad(-0.001)
      assert.equal(Curve.getAllIntersections(edge.curve, interior.perimeter(), false).length, 0,
        `${edge.source.id} -> ${edge.target.id} crosses ${node.id}`)
    }
  }
  assert.equal(labels.size, 201)
}

function edgesLeaveBottomsAndEnterTops() {
  const graph = parseSource(String.raw`digraph { node [shape=box]
    entry [label="entry:\lv0 = Load rsp\lJump loop\l"]
    loop [label="loop:\lv1 = Add v0, 1\lv2 = Eq v1, 10\lBranch v2 ? exit : body\l"]
    body [label="body:\lStore v1, v0\lBranch v1 ? body : loop\l"]
    exit [label="exit:\lReturn\l"]
    entry -> loop; loop -> exit [label="T"]; loop -> body [label="F"]
    body -> body [label="T"]; body -> loop [label="F"]
  }`, 'loop.dot')
  ;(DrawingGraph.getDrawingObj(graph) as DrawingGraph).createGeometry(measure)
  layoutGraph(graph, LAYOUT, true)
  const geom = GeomGraph.getGeom(graph)
  let edges = 0
  for (const edge of geom.deepEdges) {
    edges++
    const name = `${edge.source.id} -> ${edge.target.id}`
    const source = edge.source.boundingBox
    const target = edge.target.boundingBox
    const start = edge.curve.start
    const tip = edge.targetArrowhead.tipPosition
    // Leaves the source through its bottom, heading down, and enters the target through its top, from above.
    assert.ok(Math.abs(start.y - source.bottom) < 1e-6 && start.x > source.left && start.x < source.right, `${name} leaves through the bottom`)
    assert.ok(edge.curve.value(edge.curve.parStart + 0.01 * (edge.curve.parEnd - edge.curve.parStart)).y < start.y, `${name} heads down`)
    assert.ok(Math.abs(tip.y - target.top) < 1e-6 && tip.x > target.left && tip.x < target.right, `${name} enters through the top`)
    assert.ok(Math.abs(edge.curve.end.x - tip.x) < 1e-6 && edge.curve.end.y > tip.y, `${name} comes down into the target`)
    for (const node of geom.nodesBreadthFirst) {
      if (node === edge.source || node === edge.target) continue
      const interior = node.boundingBox.clone()
      interior.pad(-0.001)
      assert.equal(Curve.getAllIntersections(edge.curve, interior.perimeter(), false).length, 0, `${name} crosses ${node.id}`)
    }
  }
  assert.equal(edges, 5)
}

type AxisSegment = {edge: GeomEdge; vertical: boolean; at: number; low: number; high: number}

function collectCorners(curve: ICurve, points: Point[]) {
  if (curve instanceof Curve) for (const segment of curve.segs) collectCorners(segment, points)
  else if (curve instanceof Polyline) for (const point of curve) points.push(point)
  else points.push(curve.start, curve.end)
}

function axisSegments(edge: GeomEdge, segments: AxisSegment[]) {
  const points: Point[] = []
  collectCorners(edge.curve, points)
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) > 1) segments.push({edge, vertical: true, at: a.x, low: Math.min(a.y, b.y), high: Math.max(a.y, b.y)})
    else if (Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.x - b.x) > 1) segments.push({edge, vertical: false, at: a.y, low: Math.min(a.x, b.x), high: Math.max(a.x, b.x)})
  }
}

/** The smallest distance between two parallel segments of different edges that run side by side. */
function closestSideBySideEdges(geom: GeomGraph): number {
  const segments: AxisSegment[] = []
  for (const edge of geom.deepEdges) axisSegments(edge, segments)
  let closest = Infinity
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i]
      const b = segments[j]
      if (a.edge === b.edge || a.vertical !== b.vertical || Math.min(a.high, b.high) - Math.max(a.low, b.low) <= 1) continue
      closest = Math.min(closest, Math.abs(a.at - b.at))
    }
  }
  return closest
}

function edgesDoNotRunTogether() {
  // Two branches leave entry toward the same side, four paths join, and the loop returns to the top.
  const graph = parseSource(String.raw`digraph { node [shape=box]
    entry [label="entry:\lv0 = Load rsp\lSwitch v0\l"]
    a [label="a:\lv1 = Add v0, 1\l"]; b [label="b:\lv2 = Add v0, 2\l"]
    c [label="c:\lv3 = Add v0, 3\l"]; d [label="d:\lv4 = Add v0, 4\l"]
    join [label="join:\lv5 = Phi v1, v2, v3, v4\lBranch v5 ? entry : exit\l"]
    exit [label="exit:\lReturn v5\l"]
    entry -> a; entry -> b; entry -> c; entry -> d
    a -> join; b -> join; c -> join; d -> join
    join -> entry [label="T"]; join -> exit [label="F"]
  }`, 'fan.dot')
  ;(DrawingGraph.getDrawingObj(graph) as DrawingGraph).createGeometry(measure)
  layoutGraph(graph, LAYOUT, true)
  const closest = closestSideBySideEdges(GeomGraph.getGeom(graph))
  assert.ok(closest >= 8, `two edges run side by side ${closest.toFixed(1)} apart`)
}

/** The number of places where a segment of one edge crosses or touches a segment of another. */
function edgeCrossings(geom: GeomGraph): number {
  const segments: AxisSegment[] = []
  for (const edge of geom.deepEdges) axisSegments(edge, segments)
  let crossings = 0
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i]
      const b = segments[j]
      if (a.edge === b.edge || a.vertical === b.vertical) continue
      const vertical = a.vertical ? a : b
      const horizontal = a.vertical ? b : a
      if (horizontal.low - 1e-6 < vertical.at && vertical.at < horizontal.high + 1e-6 && vertical.low - 1e-6 < horizontal.at && horizontal.at < vertical.high + 1e-6) crossings++
    }
  }
  return crossings
}

function loopsGoAroundWithoutCrossing() {
  // Four branches join again; three loops go back to the top: from the outer branches and from the join.
  const graph = parseSource(String.raw`digraph { node [shape=box]
    entry [label="entry:\lv0 = Load rsp\lSwitch v0\l"]
    a [label="a:\lv1 = Add v0, 1\l"]; b [label="b:\lv2 = Add v0, 2\l"]
    c [label="c:\lv3 = Add v0, 3\l"]; d [label="d:\lv4 = Add v0, 4\l"]
    join [label="join:\lv5 = Phi v1, v2, v3, v4\lBranch v5 ? entry : exit\l"]
    exit [label="exit:\lReturn v5\l"]
    entry -> a; entry -> b; entry -> c; entry -> d
    a -> join; b -> join; c -> join; d -> join
    join -> entry [label="T"]; join -> exit [label="F"]
    a -> entry; d -> entry
  }`, 'loops.dot')
  ;(DrawingGraph.getDrawingObj(graph) as DrawingGraph).createGeometry(measure)
  layoutGraph(graph, LAYOUT, true)
  assert.equal(edgeCrossings(GeomGraph.getGeom(graph)), 0)
}

/** The pieces of an edge from its start: V for a vertical piece, L or R for a horizontal one; corner arcs are left out. */
function edgeShape(edge: GeomEdge): string {
  const points: Point[] = []
  collectCorners(edge.curve, points)
  let shape = ''
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    // a corner arc moves both ways at once
    if (Math.abs(dx) > 1e-6 === Math.abs(dy) > 1e-6) continue
    const piece = Math.abs(dy) > 1e-6 ? 'V' : dx > 0 ? 'R' : 'L'
    if (!shape.endsWith(piece)) shape += piece
  }
  return shape
}

/** A loop with two ways back to its head. The branch labels give the layout rows of their own, whose vertices it
 * places to one side of the edges' ends, and the labeled edges turn left and right, run down and go up. */
const BRANCHES = String.raw`digraph { node [shape=box]
  a [label="a:\lv0 = Load rsp\lBranch v0 ? b : x\l"]
  b [label="b:\lv1 = Phi v0, v4\lv2 = Lt v1, 10\lBranch v2 ? c : d\l"]
  c [label="c:\lv3 = Add v1, 1\lBranch v3 ? b : e\l"]
  d [label="d:\lv4 = Sub v1, 1\lJump e\l"]
  e [label="e:\lv5 = Phi v3, v4\lBranch v5 ? b : x\l"]
  x [label="x:\lReturn v1\l"]
  a -> b [label="F"]; a -> x [label="T"]
  b -> c [label="T"]; b -> d [label="F"]
  c -> b [label="T"]; c -> e [label="F"]
  d -> e
  e -> b [label="T"]; e -> x [label="F"]
}`

function edgesBendAsLittleAsTheyCan() {
  const graph = parseSource(BRANCHES, 'branches.dot')
  ;(DrawingGraph.getDrawingObj(graph) as DrawingGraph).createGeometry(measure)
  layoutGraph(graph, LAYOUT, true)
  const geom = GeomGraph.getGeom(graph)
  for (const edge of geom.deepEdges) {
    const shape = edgeShape(edge)
    const sideways = shape.replace(/V/g, '').length
    const name = `${edge.source.id} -> ${edge.target.id} (${shape})`
    // down with at most one run sideways, and straight down into the target; a loop goes up in one column
    if (edge.target.boundingBox.top < edge.source.boundingBox.bottom) assert.ok(sideways <= 1, `${name} turns sideways more than once`)
    else assert.equal(sideways, 2, `${name} goes up in more than one column`)
  }
  assert.equal(edgeCrossings(geom), 0)
}

function labelsKeepToOneSide() {
  const graph = parseSource(BRANCHES, 'branches.dot')
  ;(DrawingGraph.getDrawingObj(graph) as DrawingGraph).createGeometry(measure)
  layoutGraph(graph, LAYOUT, true)
  let labels = 0
  for (const edge of GeomGraph.getGeom(graph).deepEdges) {
    if (edge.label == null) continue
    labels++
    // the piece of the edge closest to the label's center
    const center = edge.label.boundingBox.center
    const segments: AxisSegment[] = []
    axisSegments(edge, segments)
    let closest: AxisSegment = null
    let distance = Infinity
    for (const segment of segments) {
      const along = Math.max(segment.low, Math.min(segment.high, segment.vertical ? center.y : center.x))
      const d = segment.vertical ? Math.hypot(center.x - segment.at, center.y - along) : Math.hypot(center.x - along, center.y - segment.at)
      if (d < distance) {
        distance = d
        closest = segment
      }
    }
    // on the screen, where the geometry's y grows upward: below a horizontal piece, right of a vertical one
    const name = `${edge.source.id} -> ${edge.target.id}`
    if (closest.vertical) assert.ok(center.x > closest.at, `${name}: the label is left of its edge`)
    else assert.ok(center.y < closest.at, `${name}: the label is above its edge`)
  }
  assert.equal(labels, 8)
}

function colorRoundTrip() {
  const graph = parseJSON(graphToJSON(parseDot('digraph { a [fillcolor="#00ff88", fontcolor="#334455"]; a -> b }')))
  const drawing = DrawingNode.getDrawingObj(graph.findNode('a')) as DrawingNode
  assert.deepEqual([drawing.fillColor.R, drawing.fillColor.G, drawing.fillColor.B], [0, 255, 136])
  assert.deepEqual([drawing.fontColor.R, drawing.fontColor.G, drawing.fontColor.B], [51, 68, 85])
}

const LABELS = String.raw`digraph {
  block [label="b0:  ; native 0x140387EC3\lv1:i64 = LoadIntelReg rsp\lv2:i64 = Add v1, 8\l"]
  mixed [label="Title\nleft\lright\r"]
  escaped [label="C:\\dir \{x\} \N"]
  trailing [label="one\ntwo\n"]
  block -> mixed [label="T\l"]
}`

function nodeLabel(graph: Graph, id: string) {
  const drawing = DrawingNode.getDrawingObj(graph.findNode(id)) as DrawingNode
  return [drawing.labelText, drawing.labelLineJustification]
}

function expectLabels(graph: Graph) {
  assert.deepEqual(nodeLabel(graph, 'block'), ['b0:  ; native 0x140387EC3\nv1:i64 = LoadIntelReg rsp\nv2:i64 = Add v1, 8', ['l', 'l', 'l']])
  assert.deepEqual(nodeLabel(graph, 'mixed'), ['Title\nleft\nright', ['n', 'l', 'r']])
  assert.deepEqual(nodeLabel(graph, 'escaped'), ['C:\\dir {x} \\N', undefined])
  assert.deepEqual(nodeLabel(graph, 'trailing'), ['one\ntwo', undefined])
  const edge = DrawingEdge.getDrawingObj(Array.from(graph.deepEdges)[0]) as DrawingEdge
  assert.deepEqual([edge.labelText, edge.labelLineJustification], ['T', ['l']])
}

function graphvizLineEscapes() { expectLabels(parseDot(LABELS)) }

function lineEscapesSurviveTheWorker() {
  // The layout worker serializes the graph twice: to the worker and back.
  expectLabels(parseJSON(graphToJSON(parseJSON(graphToJSON(parseDot(LABELS))))))
}

function labelEscapes() {
  assert.deepEqual(parseDotLabel('a\nb'), {text: 'a\nb', lineJustification: undefined})
  assert.deepEqual(parseDotLabel('a\r\nb\\l'), {text: 'a\nb', lineJustification: ['n', 'l']})
  assert.deepEqual(parseDotLabel('long \\\nline'), {text: 'long line', lineJustification: undefined})
  assert.deepEqual(parseDotLabel('x\\l\\l'), {text: 'x\n', lineJustification: ['l', 'l']})
  for (const value of ['a\\lb\\rc', 'end\\n\\n', 'x\\l\\l', '\\l', 'C:\\\\dir', '\\G', 'tail\\']) {
    const label = parseDotLabel(value)
    assert.deepEqual(parseDotLabel(dotLabelValue(label.text, label.lineJustification)), label, value)
  }
}

function fixedLayout() {
  assert.equal(LAYOUT.layoutType, 'Sugiyama TB')
  assert.equal(LAYOUT.edgeRoutingMode, EdgeRoutingMode.Rectilinear)
}

function rejectEmpty() { parseSource('digraph {}', 'empty.dot') }
function rejectMalformed() { parseSource('digraph { a -> }', 'broken.dot') }
function invalidGraphs() {
  assert.throws(rejectEmpty, /does not contain any nodes/)
  assert.throws(rejectMalformed, /Invalid DOT at line 1, column/)
}

test('vertical visibility paths avoid successive obstacles', verticalObstacles)
test('horizontal visibility paths avoid successive obstacles', horizontalObstacles)
test('tall graph labels are placed and return edges avoid every unrelated node', tallGraphLabelsAndRoutes)
test('edges, back edges and self-loops leave a node at its bottom and enter at its top', edgesLeaveBottomsAndEnterTops)
test('edges that run side by side keep apart instead of overlapping', edgesDoNotRunTogether)
test('loops go around the blocks they close instead of crossing other edges', loopsGoAroundWithoutCrossing)
test('edges go straight down where their rows leave room, and loops go up in one column', edgesBendAsLittleAsTheyCan)
test('edge labels sit below horizontal lines and right of vertical ones, whichever way the edge runs', labelsKeepToOneSide)
test('DOT colors survive the layout worker serialization', colorRoundTrip)
test('labels split at \\n, \\l and \\r and keep each line\'s justification', graphvizLineEscapes)
test('label lines and justification survive the layout worker serialization', lineEscapesSurviveTheWorker)
test('label escapes follow Graphviz and written labels read back unchanged', labelEscapes)
test('the viewer uses top-to-bottom layout and orthogonal routing', fixedLayout)
test('invalid and empty sources produce useful errors', invalidGraphs)
