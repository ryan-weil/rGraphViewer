import test from 'node:test'
import assert from 'node:assert/strict'
import {Curve, EdgeRoutingMode, GeomGraph, LineSegment, Point, Rectangle, Size} from '@msagl/core'
import {DrawingGraph, DrawingNode} from '@msagl/drawing'
import {graphToJSON, parseDot, parseJSON} from '@msagl/parser'
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

function colorRoundTrip() {
  const graph = parseJSON(graphToJSON(parseDot('digraph { a [fillcolor="#00ff88", fontcolor="#334455"]; a -> b }')))
  const drawing = DrawingNode.getDrawingObj(graph.findNode('a')) as DrawingNode
  assert.deepEqual([drawing.fillColor.R, drawing.fillColor.G, drawing.fillColor.B], [0, 255, 136])
  assert.deepEqual([drawing.fontColor.R, drawing.fontColor.G, drawing.fontColor.B], [51, 68, 85])
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
test('DOT colors survive the layout worker serialization', colorRoundTrip)
test('the viewer uses top-to-bottom layout and orthogonal routing', fixedLayout)
test('invalid and empty sources produce useful errors', invalidGraphs)
