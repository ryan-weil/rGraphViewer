import {FloatingPort} from '../../layout/core/floatingPort'
import {GeomEdge} from '../../layout/core/geomEdge'
import {GeomGraph} from '../../layout/core/geomGraph'
import {GeomNode} from '../../layout/core/geomNode'
import {LayerDirectionEnum} from '../../layout/layered/layerDirectionEnum'
import {Curve, PointLocation} from '../../math/geometry/curve'
import {Point} from '../../math/geometry/point'

/** Distance between neighboring edge ends on a node side. */
const END_SPACING = 16
/** Least distance from an edge end to either end of the node side, which keeps ends off rounded corners. */
const CORNER_CLEARANCE = 8

type EdgeEnd = {edge: GeomEdge; order: number}

function byOrder(a: EdgeEnd, b: EdgeEnd): number {
  return a.order - b.order
}

function addEnd(ends: Map<GeomNode, EdgeEnd[]>, node: GeomNode, edge: GeomEdge, other: GeomNode, vertical: boolean) {
  // Ends are ordered by the position of the edge's other node; self-edges come last so they loop around the far side.
  const order = other === node ? Infinity : vertical ? other.center.x : other.center.y
  let list = ends.get(node)
  if (list == null) {
    list = []
    ends.set(node, list)
  }
  list.push({edge, order})
}

function sidePoint(node: GeomNode, vertical: boolean, sign: number, along: number): Point {
  const box = node.boundingBox
  return vertical
    ? new Point(box.center.x + along, sign > 0 ? box.top : box.bottom)
    : new Point(sign > 0 ? box.right : box.left, box.center.y + along)
}

/** Spreads the ends around the middle of one node side. When the outermost ends would not lie on the node's
 * boundary (a side that is not flat, such as an ellipse's), every end is placed at the side's middle. */
function placeEnds(node: GeomNode, ends: EdgeEnd[], leaving: boolean, vertical: boolean, sign: number) {
  ends.sort(byOrder)
  const box = node.boundingBox
  const length = vertical ? box.width : box.height
  let spacing = ends.length > 1 ? Math.min(END_SPACING, Math.max(0, length - 2 * CORNER_CLEARANCE) / (ends.length - 1)) : 0
  const reach = ((ends.length - 1) / 2) * spacing
  if (
    spacing > 0 &&
    (Curve.PointRelativeToCurveLocation(sidePoint(node, vertical, sign, -reach), node.boundaryCurve) !== PointLocation.Boundary ||
      Curve.PointRelativeToCurveLocation(sidePoint(node, vertical, sign, reach), node.boundaryCurve) !== PointLocation.Boundary)
  ) {
    spacing = 0
  }
  for (let i = 0; i < ends.length; i++) {
    const port = new FloatingPort(node.boundaryCurve, sidePoint(node, vertical, sign, (i - (ends.length - 1) / 2) * spacing))
    port.Curve = node.boundaryCurve // the FloatingPort constructor does not keep its curve argument
    if (leaving) ends[i].edge.sourcePort = port
    else ends[i].edge.targetPort = port
  }
}

/** In a layered layout, makes every edge leave its source through the node side that faces the next layer and
 * enter its target through the side that faces the previous layer: the bottom and the top for top-to-bottom layers.
 * A port on a node's boundary only opens outward, so the rectilinear router attaches no edge to any other side;
 * a self-edge leaves through one side and loops around the node to the other. Edges to and from clusters keep
 * their ports. Call this after the layout has placed the nodes and before routing. */
export function attachEdgesToLayerSides(edges: Iterable<GeomEdge>, direction: LayerDirectionEnum) {
  const vertical = direction === LayerDirectionEnum.TB || direction === LayerDirectionEnum.BT
  // The side edges leave through: the bottom (-1) for TB, the top (+1) for BT, the right (+1) for LR, the left (-1) for RL.
  const leavingSign = direction === LayerDirectionEnum.TB || direction === LayerDirectionEnum.RL ? -1 : 1
  const leaving = new Map<GeomNode, EdgeEnd[]>()
  const entering = new Map<GeomNode, EdgeEnd[]>()
  for (const edge of edges) {
    if (edge.source instanceof GeomGraph || edge.target instanceof GeomGraph) continue
    addEnd(leaving, edge.source, edge, edge.target, vertical)
    addEnd(entering, edge.target, edge, edge.source, vertical)
  }
  for (const [node, ends] of leaving) placeEnds(node, ends, true, vertical, leavingSign)
  for (const [node, ends] of entering) placeEnds(node, ends, false, vertical, -leavingSign)
}
