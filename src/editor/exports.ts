// "Copy as": an equation, or the selected part of one, in a chosen format.
//
// The selection is exported on its own: its atoms are parsed as a row of
// their own, so selecting "a+b" in "y=a+b" gives the MathJSON for a+b. A
// selection that isn't a complete expression (e.g. "+b") gets placeholders
// for what's missing, as in the output panels.

import { rowToLatexSource } from './clipboard'
import type { Row } from './layout'
import { parseRow } from './parse'
import { renderMathJson } from '../renderers/mathjson'
import { astToContentMathML } from '../renderers/mathml'

export type ExportFormat = 'latex' | 'mathjson' | 'mathml'

export const EXPORT_FORMATS: ReadonlyArray<{ format: ExportFormat; label: string }> = [
  { format: 'latex', label: 'LaTeX' },
  { format: 'mathjson', label: 'MathJSON' },
  { format: 'mathml', label: 'Content MathML' },
]

const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML'

export function exportRow(row: Row, format: ExportFormat): string {
  switch (format) {
    case 'latex':
      return rowToLatexSource(row)
    case 'mathjson':
      return renderMathJson(parseRow(row).ast)
    case 'mathml':
      return contentMathML(row)
  }
}

// A complete, indented Content MathML document for a row.
export function contentMathML(row: Row): string {
  const body = astToContentMathML(parseRow(row).ast)
  return formatXml(`<math xmlns="${MATHML_NAMESPACE}">${body}</math>`)
}

// Re-indent simple XML (elements and text only, as the MathML renderer
// produces): whitespace between tags is dropped and each element goes on its
// own line; an element holding only text stays on one line (<ci>x</ci>).
export function formatXml(xml: string, indent = '  '): string {
  const tokens = xml.match(/<[^>]+>|[^<]+/g) ?? []
  const lines: string[] = []
  let depth = 0

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    if (!token.startsWith('<')) {
      const text = token.trim()
      if (text) lines.push(indent.repeat(depth) + text)
      continue
    }

    if (token.startsWith('</')) {
      depth = Math.max(0, depth - 1)
      lines.push(indent.repeat(depth) + token)
      continue
    }

    if (token.endsWith('/>')) {
      lines.push(indent.repeat(depth) + token)
      continue
    }

    // <tag>text</tag> on one line.
    const text = tokens[i + 1]
    const close = tokens[i + 2]
    if (text && !text.startsWith('<') && text.trim() && close?.startsWith('</')) {
      lines.push(indent.repeat(depth) + token + text.trim() + close)
      i += 2
      continue
    }

    lines.push(indent.repeat(depth) + token)
    depth++
  }

  return lines.join('\n')
}
