// Layout tree -> KaTeX LaTeX for the interactive editor surface.
//
// Every atom is wrapped in \htmlData{atom=<id>} and every row in
// \htmlData{row=<encoded path>}, so caretGeometry.ts can find the painted
// box of any atom or row and turn it back into a cursor position. Nothing
// about the cursor itself is baked into the LaTeX except which empty row (if
// any) the cursor is in, so its placeholder can be drawn as active.
//
// KaTeX spacing: \htmlData produces a plain "enclosing" span, which would
// lose TeX's binary/relation spacing, so operators are wrapped as
// \mathbin{\htmlData{…}{+}} / \mathrel{…} / \mathpunct{…} to keep their class.

import type { Atom, Row, RowPath, RowPathSegment } from '../editor/layout'
import { rowPathsEqual } from '../editor/layout'
import { getFunctionDefinition } from '../registry/nodes'

export interface LayoutLatexOptions {
  // Row the cursor is in. If it is empty, its placeholder gets the
  // `me-ph-active` class.
  activeRow?: RowPath | null
}

// ---------------------------------------------------------------------------
// Row path encoding for data-row attributes: "r", "r/2.num", "r/2.num/0.sup"
// ---------------------------------------------------------------------------

export function encodeRowPath(path: RowPath): string {
  return ['r', ...path.map((s) => `${s.atom}.${s.branch}`)].join('/')
}

export function decodeRowPath(encoded: string | null | undefined): RowPath | null {
  if (!encoded) return null

  const [head, ...rest] = encoded.split('/')
  if (head !== 'r') return null

  const path: RowPath = []

  for (const part of rest) {
    const match = /^(\d+)\.([a-z]+)$/.exec(part)
    if (!match) return null
    path.push({ atom: Number(match[1]), branch: match[2] as RowPathSegment['branch'] })
  }

  return path
}

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

const GREEK_NAMES = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta',
  'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau',
  'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda',
  'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega',
]) // prettier-ignore

const BINARY: Record<string, string> = {
  '+': '+',
  '-': '-',
  '−': '-',
  '*': '\\cdot',
  '·': '\\cdot',
  '×': '\\times',
}

const RELATION: Record<string, string> = { '=': '=' }

const TEXT_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '#': '\\#',
  $: '\\$',
  '%': '\\%',
  '&': '\\&',
  _: '\\_',
  '^': '\\textasciicircum{}',
  '~': '\\textasciitilde{}',
}

function isOperatorSymbol(atom: Atom | undefined): boolean {
  return (
    atom?.kind === 'symbol' &&
    (atom.value in BINARY || atom.value in RELATION || atom.value === ',')
  )
}

function tag(id: string, body: string): string {
  return `\\htmlData{atom=${id}}{${body}}`
}

function renderSymbol(id: string, value: string): string {
  if (value in BINARY) return `\\mathbin{${tag(id, BINARY[value])}}`
  if (value in RELATION) return `\\mathrel{${tag(id, RELATION[value])}}`
  if (value === ',') return `\\mathpunct{${tag(id, ',')}}`
  if (/^[0-9.]$/.test(value) || /^[A-Za-z]$/.test(value)) return tag(id, value)
  if (GREEK_NAMES.has(value)) return tag(id, `\\${value}`)
  if (/^[A-Za-z]+$/.test(value)) return tag(id, `\\mathit{${value}}`)

  const text = Array.from(value)
    .map((char) => TEXT_ESCAPES[char] ?? char)
    .join('')
  return tag(id, `\\text{${text}}`)
}

// ---------------------------------------------------------------------------
// Rows and atoms
// ---------------------------------------------------------------------------

export function rowToLatex(row: Row, options: LayoutLatexOptions = {}): string {
  return renderRow(row, [], options)
}

function renderRow(row: Row, path: RowPath, options: LayoutLatexOptions): string {
  let body: string

  if (row.length === 0) {
    const active = options.activeRow && rowPathsEqual(options.activeRow, path)
    body = `\\htmlClass{me-ph${active ? ' me-ph-active' : ''}}{\\square}`
  } else {
    const pieces: string[] = []

    row.forEach((atom, index) => {
      const childPath = (branch: RowPathSegment['branch']): RowPath => [
        ...path,
        { atom: index, branch },
      ]

      if (atom.kind === 'superscript') {
        // Attach to the previous atom's LaTeX so KaTeX positions the exponent
        // against the real base (a tall fraction, a bracket group, …). With
        // nothing suitable before it, use an empty base.
        const previous = row[index - 1]
        const base = previous && !isOperatorSymbol(previous) ? pieces.pop()! : ''
        pieces.push(`{${base}}^{${tag(atom.id, renderRow(atom.sup, childPath('sup'), options))}}`)
        return
      }

      pieces.push(renderAtom(atom, childPath, options))
    })

    body = pieces.join('')
  }

  return `\\htmlData{row=${encodeRowPath(path)}}{${body}}`
}

function renderAtom(
  atom: Exclude<Atom, { kind: 'superscript' }>,
  childPath: (branch: RowPathSegment['branch']) => RowPath,
  options: LayoutLatexOptions,
): string {
  const child = (row: Row, branch: RowPathSegment['branch']) =>
    renderRow(row, childPath(branch), options)

  switch (atom.kind) {
    case 'symbol':
      return renderSymbol(atom.id, atom.value)

    case 'function': {
      const name = getFunctionDefinition(atom.name)?.latexName ?? atom.name
      return `\\mathop{${tag(atom.id, `\\mathrm{${name}}`)}}`
    }

    case 'fraction':
      return tag(atom.id, `\\frac{${child(atom.num, 'num')}}{${child(atom.den, 'den')}}`)

    case 'root':
      return tag(
        atom.id,
        atom.index
          ? `\\sqrt[${child(atom.index, 'index')}]{${child(atom.body, 'body')}}`
          : `\\sqrt{${child(atom.body, 'body')}}`,
      )

    case 'group': {
      const open = atom.open === '|' ? '|' : '('
      const close = atom.close === '|' ? '|' : ')'
      return tag(atom.id, `\\left${open}${child(atom.body, 'body')}\\right${close}`)
    }

    case 'derivative':
      return tag(
        atom.id,
        `\\frac{\\mathrm{d}${child(atom.expr, 'expr')}}{\\mathrm{d}${child(atom.variable, 'variable')}}`,
      )
  }
}

// KaTeX options the editor surface needs: \htmlData / \htmlClass must be
// trusted, and nothing else.
export const KATEX_EDITOR_OPTIONS = {
  displayMode: true,
  throwOnError: false,
  strict: 'ignore' as const,
  trust: (context: { command: string }) =>
    context.command === '\\htmlData' || context.command === '\\htmlClass',
}
