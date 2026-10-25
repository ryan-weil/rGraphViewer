import {EdgeRoutingMode, Graph, Node} from '@msagl/core'
import {DrawingGraph, DrawingNode, DrawingEdge, DrawingObject} from '@msagl/drawing'
import {parseDot, parseJSON} from '@msagl/parser'
import {LayoutOptions, TextMeasurer} from '@msagl/renderer-common'

export const LAYOUT: LayoutOptions = {
  layoutType: 'Sugiyama TB',
  edgeRoutingMode: EdgeRoutingMode.Rectilinear,
  smoothCorners: false,
  label: {fontFamily: 'Segoe UI, sans-serif', fontSize: 13, lineHeight: 1},
}

export function parseSource(source: string, name: string): Graph {
  if (!source.trim()) throw new Error('Add some DOT source or open a graph file first.')
  const graph = name.toLowerCase().endsWith('.json') || source.trimStart().startsWith('{')
    ? parseJSON(JSON.parse(source))
    : parseDot(source)
  if (!graph || graph.nodeCountDeep === 0) throw new Error('This file does not contain any nodes.')
  return graph
}

export function prepareGeometry(graph: Graph, measure: TextMeasurer['measure']) {
  const drawing = DrawingGraph.getDrawingObj(graph) as DrawingGraph
  drawing.fontname = 'Segoe UI, sans-serif'
  drawing.fontsize = 13
  for (const node of graph.nodesBreadthFirst) {
    const dn = DrawingNode.getDrawingObj(node) as DrawingNode
    dn.fontname = drawing.fontname
    dn.fontsize = 13
    dn.LabelMargin = 12
    dn.XRadius = dn.YRadius = 5
  }
  for (const edge of graph.deepEdges) {
    const de = DrawingEdge.getDrawingObj(edge) as DrawingEdge
    de.fontname = drawing.fontname
    de.fontsize = 11
  }
  drawing.createGeometry(measure)
}

export function labelOf(node: Node): string {
  return (DrawingObject.getDrawingObj(node) as DrawingNode)?.labelText || node.id
}

export function firstLine(text: string): string {
  return text.split('\n')[0]
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
