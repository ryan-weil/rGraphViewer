import {Curve, GeomEdge, GeomGraph, GeomNode, Graph, ICurve, LineSegment, Point, Polyline, Rectangle} from '@msagl/core'
import {Color, DrawingEdge, DrawingNode} from '@msagl/drawing'
import {labelOf} from './graph'

export type Position = [number, number]
export type Rgba = [number, number, number, number]
export type Theme = 'light' | 'dark'
export type NodeItem = {
  kind: 'node'; id: string; path: Position[]; position: Position; labelPosition: Position
  label: string; fontSize: number; accent: Rgba; fill: Rgba; stroke: Rgba; ink: Rgba; width: number
}
export type EdgeItem = {
  kind: 'edge'; index: number; source: string; target: string; path: Position[]
  label: string; labelPosition: Position; fontSize: number; original: Rgba | null
  ink: Rgba; labelInk: Rgba; width: number
}
export type ArrowItem = {kind: 'edge'; index: number; path: Position[]; edge: EdgeItem}
export type ShadowItem = {path: Position[]; ink: Rgba}
export type Scene = {nodes: NodeItem[]; edges: EdgeItem[]; arrows: ArrowItem[]; shadows: ShadowItem[]; bounds: Rectangle}

export const PALETTES = {
  light: {base: [255,255,255,255], border: [184,195,217,255], text: [46,59,85,255], edge: [150,160,184,255], label: [112,123,145,255], accent: [103,92,219,255], background: [247,248,252,255]},
  dark: {base: [32,42,60,255], border: [75,91,118,255], text: [226,233,247,255], edge: [99,113,139,255], label: [161,174,198,255], accent: [166,156,255,255], background: [18,23,34,255]},
} as const

function rgba(color: Color | undefined, fallback: Rgba): Rgba {
  return color ? [color.R, color.G, color.B, color.A] : fallback
}

export function mixColor(accent: readonly number[], base: readonly number[], amount: number): Rgba {
  const ratio = amount * accent[3] / 255
  return [Math.round(base[0] * (1-ratio) + accent[0] * ratio), Math.round(base[1] * (1-ratio) + accent[1] * ratio), Math.round(base[2] * (1-ratio) + accent[2] * ratio), 255]
}

function position(point: Point): Position { return [point.x, -point.y] }

function appendCurve(curve: ICurve, points: Position[]) {
  if (curve instanceof Curve) {
    for (const segment of curve.segs) appendCurve(segment, points)
  } else if (curve instanceof Polyline) {
    for (const point of curve) points.push(position(point))
    if (curve.closed) points.push(position(curve.start))
  } else if (curve instanceof LineSegment) points.push(position(curve.end))
  else for (let i = 1; i <= 48; i++) points.push(position(curve.value(curve.parStart + (curve.parEnd - curve.parStart) * i / 48)))
}

export function curvePoints(curve: ICurve): Position[] {
  const points = [position(curve.start)]
  appendCurve(curve, points)
  return points
}

function addArrow(arrows: ArrowItem[], edge: EdgeItem, tip: Point | undefined, base: Point) {
  if (!tip) return
  const vector = tip.sub(base)
  if (vector.length < 0.001) return
  const normal = new Point(-vector.y, vector.x).normalize().mul(Math.min(4, vector.length * 0.4))
  arrows.push({kind: 'edge', index: edge.index, edge, path: [position(tip), position(base.add(normal)), position(base.sub(normal))]})
}

export function createScene(graph: Graph): Scene {
  const scene: Scene = {nodes: [], edges: [], arrows: [], shadows: [], bounds: GeomGraph.getGeom(graph).boundingBox.clone()}
  for (const node of graph.nodesBreadthFirst) {
    const geom = GeomNode.getGeom(node)
    if (!geom?.boundaryCurve) continue
    const drawing = DrawingNode.getDrawingObj(node) as DrawingNode
    scene.nodes.push({kind: 'node', id: node.id, path: curvePoints(geom.boundaryCurve), position: position(geom.center),
      labelPosition: [geom.center.x, geom instanceof GeomGraph ? -geom.boundingBox.top + 14 : -geom.center.y],
      label: labelOf(node), fontSize: drawing.fontsize, accent: rgba(drawing.fillColor, [201,214,244,255]),
      fill: [0,0,0,255], stroke: [0,0,0,255], ink: [0,0,0,255], width: 0.85})
  }
  let index = 0
  for (const edge of graph.deepEdges) {
    const edgeIndex = index++
    const geom = GeomEdge.getGeom(edge)
    if (!geom?.curve) continue
    const drawing = DrawingEdge.getDrawingObj(edge) as DrawingEdge
    const original = drawing.color && drawing.color.R + drawing.color.G + drawing.color.B > 80 ? rgba(drawing.color, [0,0,0,255]) : null
    const item: EdgeItem = {kind: 'edge', index: edgeIndex, source: edge.source.id, target: edge.target.id,
      path: curvePoints(geom.curve), label: geom.label ? drawing.labelText || '' : '',
      labelPosition: geom.label ? position(geom.label.center) : [0,0], fontSize: drawing.fontsize,
      original, ink: [0,0,0,255], labelInk: [0,0,0,255], width: 1.2}
    scene.edges.push(item)
    addArrow(scene.arrows, item, geom.targetArrowhead?.tipPosition, geom.curve.end)
    addArrow(scene.arrows, item, geom.sourceArrowhead?.tipPosition, geom.curve.start)
  }
  return scene
}

export function styleScene(scene: Scene, theme: Theme, selected: string | null) {
  const palette = PALETTES[theme]
  const neighbors = new Set<string>()
  for (const edge of scene.edges) {
    const active = selected !== null && (edge.source === selected || edge.target === selected)
    if (active) { neighbors.add(edge.source); neighbors.add(edge.target) }
    edge.ink = [...(active ? palette.accent : edge.original ?? palette.edge)] as Rgba
    edge.labelInk = [...(active ? palette.accent : palette.label)] as Rgba
    edge.width = active ? 1.7 : 1.2
  }
  for (const node of scene.nodes) {
    node.fill = mixColor(node.id === selected ? palette.accent : node.accent, palette.base, node.id === selected || theme === 'dark' ? 0.12 : 0.25)
    node.stroke = neighbors.has(node.id) || node.id === selected ? [...palette.accent] : mixColor(node.accent, palette.border, theme === 'dark' ? 0.22 : 0.7)
    node.ink = [...palette.text]
    node.width = node.id === selected ? 2 : neighbors.has(node.id) ? 1.1 : 0.85
  }
  scene.shadows = []
  for (let spread = 3; spread >= 1; spread--) {
    for (const node of scene.nodes) {
      const path: Position[] = []
      for (const point of node.path) {
        const dx = point[0] - node.position[0]
        const dy = point[1] - node.position[1]
        const length = Math.hypot(dx, dy) || 1
        path.push([point[0] + dx / length * spread, point[1] + dy / length * spread + 2.5])
      }
      scene.shadows.push({path, ink: theme === 'dark' ? [0,0,0,16] : [21,35,67,9]})
    }
  }
  // New array identities rebuild GPU attributes on theme/selection changes only.
  scene.nodes = scene.nodes.slice()
  scene.edges = scene.edges.slice()
  scene.arrows = scene.arrows.slice()
}
