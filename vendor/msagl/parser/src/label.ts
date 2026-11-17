import {LabelJustification} from '@msagl/drawing'

/** Graphviz replaces these escapes with node, graph, edge, tail, head and label names. They are not substituted here and stay as written. */
const OBJECT_ESCAPES = 'NGETHL'

export type DotLabel = {
  /** The label's lines joined with '\n'. */
  text: string
  /** The justification of each line; undefined when every line is centered. */
  lineJustification: LabelJustification[] | undefined
}

/** Reads a plain-text DOT label the way Graphviz splits it into lines: `\n`, `\l` and `\r` end a centered,
 * left-justified or right-justified line, a line break in the value ends a centered line, text after the
 * last line end is a centered line, and a backslash before any other character stands for that character. */
export function parseDotLabel(value: string): DotLabel {
  const lines: string[] = []
  const justification: LabelJustification[] = []
  let line = ''
  let lineOpen = false
  for (let i = 0; i < value.length; i++) {
    let c = value[i]
    if (c === '\r' && value[i + 1] === '\n') continue // the '\n' of a CRLF ends the line
    if (c === '\\') {
      if (i + 1 === value.length) break // Graphviz drops a backslash that ends the label
      c = value[++i]
      if (c === '\r' && value[i + 1] === '\n') c = value[++i]
      if (c === '\n') continue // a backslash before a line break continues the line
      if (c === 'n' || c === 'l' || c === 'r') {
        lines.push(line)
        justification.push(c)
        line = ''
        lineOpen = false
        continue
      }
      if (OBJECT_ESCAPES.includes(c)) line += '\\'
    } else if (c === '\n') {
      lines.push(line)
      justification.push('n')
      line = ''
      lineOpen = false
      continue
    }
    line += c
    lineOpen = true
  }
  if (lineOpen) {
    lines.push(line)
    justification.push('n')
  }
  let centered = true
  for (const entry of justification) if (entry !== 'n') centered = false
  return {text: lines.join('\n'), lineJustification: centered ? undefined : justification}
}

/** Writes label text and line justification as the DOT label value that parseDotLabel reads back unchanged. */
export function dotLabelValue(text: string, lineJustification?: readonly LabelJustification[]): string {
  const lines = text.split('\n')
  let value = ''
  for (let i = 0; i < lines.length; i++) {
    const justification = lineJustification?.[i] ?? 'n'
    value += lines[i].replace(/\\/g, '\\\\')
    // Text after the last line end is read as a centered line, so only a justified or empty last line needs an ending.
    if (i < lines.length - 1 || justification !== 'n' || (lines[i] === '' && lines.length > 1)) value += '\\' + justification
  }
  return value
}
