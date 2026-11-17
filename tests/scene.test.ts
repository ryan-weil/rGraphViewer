import test from 'node:test'
import assert from 'node:assert/strict'
import {GeomEdge, GeomNode, Size} from '@msagl/core'
import {DrawingNode} from '@msagl/drawing'
import {layoutGraph} from '../vendor/msagl/renderer-common/src/layout'
import {LAYOUT, parseSource, prepareGeometry} from '../src/graph'
import {LINE_HEIGHT, LabelLine, NodeItem, Scene, createScene, styleScene} from '../src/scene'
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

function justifiedSample() {
  const graph = parseSource(String.raw`digraph { node [shape=box]; code [label="b0:\lv1 = Add v0, 8\lv2 = Sub v1, v0\l"]; mixed [label="Title\nleft\lright\r"]; code -> mixed [label="T\lF\r"] }`, 'lines.dot')
  prepareGeometry(graph, measure)
  layoutGraph(graph, LAYOUT, true)
  return graph
}

function sceneNode(scene: Scene, id: string): NodeItem {
  for (const node of scene.nodes) if (node.id === id) return node
  throw new Error(`no node ${id}`)
}

function assertPlacement(lines: LabelLine<unknown>[], expected: [string, string, number, number][]) {
  assert.equal(lines.length, expected.length)
  for (let i = 0; i < lines.length; i++) {
    const [text, anchor, x, y] = expected[i]
    assert.equal(lines[i].text, text)
    assert.equal(lines[i].anchor, anchor, text)
    assert.ok(Math.abs(lines[i].position[0] - x) < 1e-9 && Math.abs(lines[i].position[1] - y) < 1e-9,
      `${text} at ${lines[i].position}, expected ${x},${y}`)
  }
}

function justifiedLabelLines() {
  const graph = justifiedSample()
  const scene = createScene(graph)
  const code = sceneNode(scene, 'code')
  const width = (DrawingNode.getDrawingObj(graph.findNode('code')) as DrawingNode).measuredTextSize.width
  const [x, y] = code.position
  const step = code.fontSize * LINE_HEIGHT
  assertPlacement(code.lines, [
    ['b0:', 'start', x - width / 2, y - step], ['v1 = Add v0, 8', 'start', x - width / 2, y], ['v2 = Sub v1, v0', 'start', x - width / 2, y + step]])
  let left = Infinity
  for (const point of code.path) left = Math.min(left, point[0])
  assert.ok(Math.abs(x - width / 2 - left - 12) < 1e-6, 'left-justified lines start at the label margin')
  const mixed = sceneNode(scene, 'mixed')
  const mixedWidth = (DrawingNode.getDrawingObj(graph.findNode('mixed')) as DrawingNode).measuredTextSize.width
  const [mx, my] = mixed.position
  assertPlacement(mixed.lines, [
    ['Title', 'middle', mx, my - step], ['left', 'start', mx - mixedWidth / 2, my], ['right', 'end', mx + mixedWidth / 2, my + step]])
  const edge = scene.edges[0]
  const label = GeomEdge.getGeom(Array.from(graph.deepEdges)[0]).label
  const [ex, ey] = edge.labelPosition
  const edgeStep = edge.fontSize * LINE_HEIGHT
  assertPlacement(edge.lines, [
    ['T', 'start', ex - label.boundingBox.width / 2, ey - edgeStep / 2], ['F', 'end', ex + label.boundingBox.width / 2, ey + edgeStep / 2]])
  assert.equal(scene.nodeLabels.length, 6)
  assert.equal(scene.edgeLabels.length, 2)
}

function justifiedVectorExport() {
  const scene = createScene(justifiedSample())
  styleScene(scene, 'light', null)
  const svg = exportSvg(scene, 'light')
  assert.match(svg, /<tspan x="[^"]+" y="[^"]+" text-anchor="start">v1 = Add v0, 8<\/tspan>/)
  assert.match(svg, /<tspan x="[^"]+" y="[^"]+" text-anchor="end">right<\/tspan>/)
  assert.match(svg, /<tspan x="[^"]+" y="[^"]+" text-anchor="middle">Title<\/tspan>/)
}

test('WebGL scene preserves routed curves, arrow tips, labels, and node centers', preserveRoutedGeometry)
test('left- and right-justified label lines line up with the sides of the label', justifiedLabelLines)
test('SVG export keeps the justification of each label line', justifiedVectorExport)
test('theme and selection updates keep every edge route unchanged', preserveGeometryAcrossThemes)
test('SVG export retains graph labels and escapes source text', vectorExport)
