import {Position, Rgba, Scene, Theme, PALETTES} from './scene'

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function color(value: readonly number[]): string { return `rgba(${value[0]},${value[1]},${value[2]},${value[3] / 255})` }

function path(points: Position[], close = false): string {
  let result = ''
  for (let i = 0; i < points.length; i++) result += `${i === 0 ? 'M' : 'L'}${points[i][0].toFixed(3)},${points[i][1].toFixed(3)} `
  return result + (close ? 'Z' : '')
}

function text(label: string, at: Position, size: number, ink: Rgba): string {
  const lines = label.split('\n')
  let spans = ''
  for (let i = 0; i < lines.length; i++) spans += `<tspan x="${at[0]}" y="${at[1] + (i - (lines.length - 1) / 2) * size * 1.2}">${escapeText(lines[i])}</tspan>`
  return `<text fill="${color(ink)}" font-size="${size}" text-anchor="middle" dominant-baseline="central">${spans}</text>`
}

/** SVG is generated only when exporting; the interactive graph is entirely WebGL. */
export function exportSvg(scene: Scene, theme: Theme): string {
  const bounds = scene.bounds
  const x = bounds.left - 30
  const y = -bounds.top - 30
  const width = bounds.width + 60
  const height = bounds.height + 60
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}" font-family="Segoe UI,Arial,sans-serif" font-weight="500">`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color(PALETTES[theme].background)}"/>`]
  for (const edge of scene.edges) parts.push(`<path d="${path(edge.path)}" fill="none" stroke="${color(edge.ink)}" stroke-width="${edge.width}" stroke-linejoin="round"/>`)
  for (const arrow of scene.arrows) parts.push(`<path d="${path(arrow.path, true)}" fill="${color(arrow.edge.ink)}"/>`)
  for (const edge of scene.edges) if (edge.label) parts.push(text(edge.label, edge.labelPosition, edge.fontSize, edge.labelInk))
  for (const node of scene.nodes) {
    parts.push(`<path d="${path(node.path, true)}" fill="${color(node.fill)}" stroke="${color(node.stroke)}" stroke-width="${node.width}"/>`)
    parts.push(text(node.label, node.labelPosition, node.fontSize, node.ink))
  }
  parts.push('</svg>')
  return parts.join('')
}
