import {LabelLine, Position, Rgba, Scene, Theme, PALETTES} from './scene'

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function color(value: readonly number[]): string { return `rgba(${value[0]},${value[1]},${value[2]},${value[3] / 255})` }

function path(points: Position[], close = false): string {
  let result = ''
  for (let i = 0; i < points.length; i++) result += `${i === 0 ? 'M' : 'L'}${points[i][0].toFixed(3)},${points[i][1].toFixed(3)} `
  return result + (close ? 'Z' : '')
}

function text(lines: LabelLine<unknown>[], size: number, ink: Rgba): string {
  let spans = ''
  for (const line of lines) spans += `<tspan x="${line.position[0]}" y="${line.position[1]}" text-anchor="${line.anchor}">${escapeText(line.text)}</tspan>`
  return `<text fill="${color(ink)}" font-size="${size}" dominant-baseline="central">${spans}</text>`
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
  for (const edge of scene.edges) if (edge.lines.length) parts.push(text(edge.lines, edge.fontSize, edge.labelInk))
  for (const node of scene.nodes) {
    parts.push(`<path d="${path(node.path, true)}" fill="${color(node.fill)}" stroke="${color(node.stroke)}" stroke-width="${node.width}"/>`)
    parts.push(text(node.lines, node.fontSize, node.ink))
  }
  parts.push('</svg>')
  return parts.join('')
}
