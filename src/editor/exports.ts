// "Copy as": an equation, or the selected part of one, in a chosen format.
//
// The selection is exported on its own: its atoms are parsed as a row of
// their own, so selecting "a+b" in "y=a+b" gives the MathJSON for a+b. A
// selection that isn't a complete expression (e.g. "+b") gets placeholders
// for what's missing, as in the output panels.
//
// CellML mode (`{ cellml: true }`) makes the Content MathML ready for a CellML
// model: the root <math> declares the CellML namespace, and every number
// carries `cellml:units`: its own units (0.25{mV}), or dimensionless.

import { rowToLatexSource } from './clipboard'
import type { Row } from './layout'
import { parseRow } from './parse'
import { renderMathJson } from '../renderers/mathjson'
import { type ContentMathMLOptions, astToContentMathML } from '../renderers/mathml'

export type ExportFormat = 'latex' | 'mathjson' | 'mathml'

export const EXPORT_FORMATS: ReadonlyArray<{ format: ExportFormat; label: string }> = [
  { format: 'latex', label: 'LaTeX' },
  { format: 'mathjson', label: 'MathJSON' },
  { format: 'mathml', label: 'Content MathML' },
]

const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML'
export const CELLML_NAMESPACE = 'http://www.cellml.org/cellml/2.0#'

export type ExportOptions = ContentMathMLOptions

export function exportRow(row: Row, format: ExportFormat, options: ExportOptions = {}): string {
  switch (format) {
    case 'latex':
      return rowToLatexSource(row)
    case 'mathjson':
      return renderMathJson(parseRow(row).ast)
    case 'mathml':
      return contentMathML(row, options)
  }
}

// A complete, indented Content MathML document for a row.
export function contentMathML(row: Row, options: ExportOptions = {}): string {
  const body = astToContentMathML(parseRow(row).ast, options)
  const namespaces = options.cellml
    ? `xmlns="${MATHML_NAMESPACE}" xmlns:cellml="${CELLML_NAMESPACE}"`
    : `xmlns="${MATHML_NAMESPACE}"`
  return formatXml(`<math ${namespaces}>${body}</math>`)
}

// Re-indent simple XML (elements and text only, as the MathML renderer
// produces): whitespace between tags is dropped and each element goes on its
// own line; an element holding only text, perhaps with empty elements between
// (<ci>x</ci>, <cn type="e-notation">1<sep/>-8</cn>), stays on one line, so no
// whitespace is added inside it.
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

    // <tag>text</tag> (or text<sep/>text) on one line.
    let end = i + 1
    while (end < tokens.length && !tokens[end].startsWith('</')) {
      const inner = tokens[end]
      if (inner.startsWith('<') && !inner.endsWith('/>')) break
      end++
    }
    const inline = tokens.slice(i + 1, end)
    if (
      tokens[end]?.startsWith('</') &&
      inline.some((inner) => !inner.startsWith('<') && inner.trim())
    ) {
      const content = inline.map((inner) => (inner.startsWith('<') ? inner : inner.trim())).join('')
      lines.push(indent.repeat(depth) + token + content + tokens[end])
      i = end
      continue
    }

    lines.push(indent.repeat(depth) + token)
    depth++
  }

  return lines.join('\n')
}
