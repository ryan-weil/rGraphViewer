import test from 'node:test'
import assert from 'node:assert/strict'
import {GeomEdge, GeomNode, Size} from '@msagl/core'
import {layoutGraph} from '../vendor/msagl/renderer-common/src/layout'
import {LAYOUT, parseSource, prepareGeometry} from '../src/graph'
import {createScene, styleScene} from '../src/scene'
import {exportSvg} from '../src/svg-export'

function measure(text: string, options: {fontSize: number}): Size {
  let width = 0
  for (const line of text.split('\n')) width = Math.max(width, line.length * options.fontSize * 0.6)
  return new Size(width, text.split('\n').length * options.fontSize * 1.2)
}

function sample() {
  const graph = parseSource('digraph { node [shape=box]; a [label="A & <value>"]; a -> b [label="Next"]; b -> c; c -> a [label="Return"] }', 'sample.dot')
  prepareGeometry(graph, measure)
  layoutGraph(graph, LAYOUT, true)
  return graph
}

function preserveRoutedGeometry() {
  const graph = sample()
  const scene = createScene(graph)
  assert.equal(scene.nodes.length, 3)
  assert.equal(scene.edges.length, 3)
  assert.equal(scene.arrows.length, 3)
  const edges = Array.from(graph.deepEdges)
  for (const edge of scene.edges) {
    const geom = GeomEdge.getGeom(edges[edge.index])
    assert.deepEqual(edge.path[0], [geom.curve.start.x, -geom.curve.start.y])
    assert.deepEqual(edge.path[edge.path.length - 1], [geom.curve.end.x, -geom.curve.end.y])
    if (geom.label) assert.deepEqual(edge.labelPosition, [geom.label.center.x, -geom.label.center.y])
  }
  for (const node of scene.nodes) {
    const geom = GeomNode.getGeom(graph.findNode(node.id))
    assert.deepEqual(node.position, [geom.center.x, -geom.center.y])
  }
  for (const arrow of scene.arrows) {
    const geom = GeomEdge.getGeom(edges[arrow.index])
    assert.deepEqual(arrow.path[0], [geom.targetArrowhead.tipPosition.x, -geom.targetArrowhead.tipPosition.y])
  }
}

function preserveGeometryAcrossThemes() {
  const scene = createScene(sample())
  const paths = []
  for (const edge of scene.edges) paths.push(edge.path)
  const original = JSON.stringify(paths)
  styleScene(scene, 'light', 'a')
  const lightFill = scene.nodes[0].fill
  styleScene(scene, 'dark', null)
  assert.notDeepEqual(scene.nodes[0].fill, lightFill)
  const after = []
  for (const edge of scene.edges) after.push(edge.path)
  assert.equal(JSON.stringify(after), original)
}

function vectorExport() {
  const scene = createScene(sample())
  styleScene(scene, 'dark', 'a')
  const svg = exportSvg(scene, 'dark')
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/)
  assert.match(svg, /A &amp; &lt;value&gt;/)
  assert.match(svg, /Return/)
  assert.match(svg, /rgba\(18,23,34,1\)/)
  assert.equal((svg.match(/<text /g) || []).length, 5)
  assert.equal(svg.includes('<canvas'), false)
}

test('WebGL scene preserves routed curves, arrow tips, labels, and node centers', preserveRoutedGeometry)
test('theme and selection updates keep every edge route unchanged', preserveGeometryAcrossThemes)
test('SVG export retains graph labels and escapes source text', vectorExport)
