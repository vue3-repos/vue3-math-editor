// The editing model: a layout tree of rows and atoms.
//
// This is deliberately *not* the semantic AST. A row is a flat, ordered list
// of atoms — exactly what the user sees left to right — and structure atoms
// (fractions, superscripts, roots, brackets, derivatives) own named child
// rows. The semantic `AstNode` is derived from this tree by a parser; editing
// never manipulates operator precedence directly.
//
// Cursor positions are gaps in rows (see cursor.ts): a row of n atoms has
// n + 1 positions, so every gap — including the very end of the equation —
// is addressable.

export type Row = Atom[]

export type BranchName = 'num' | 'den' | 'sup' | 'index' | 'body' | 'expr' | 'variable'

interface AtomBase {
  // Stable identity for rendering (DOM tagging) and hit-testing. Never used
  // for equality in the editing logic.
  id: string
}

// A single visible glyph: a digit, a letter, an operator (+ - = · ,), a
// decimal point. Multi-digit numbers and multi-letter names are several
// symbol atoms; the parser groups them.
export interface SymbolAtom extends AtomBase {
  kind: 'symbol'
  value: string
}

// A named function head such as "sin". Atomic: the cursor never sits inside
// the name. The parser pairs it with a following group to build a call.
export interface FunctionAtom extends AtomBase {
  kind: 'function'
  name: string
}

export interface FractionAtom extends AtomBase {
  kind: 'fraction'
  num: Row
  den: Row
}

// Attaches to the atom before it at parse time (MathLive style), so "x^2" is
// [x, superscript([2])] rather than a Power atom with its own base row.
export interface SuperscriptAtom extends AtomBase {
  kind: 'superscript'
  sup: Row
}

export interface RootAtom extends AtomBase {
  kind: 'root'
  // null for a square root; a row (possibly empty) for an nth root.
  index: Row | null
  body: Row
}

export type GroupDelimiter = '(' | ')' | '|'

export interface GroupAtom extends AtomBase {
  kind: 'group'
  open: GroupDelimiter
  close: GroupDelimiter
  body: Row
}

// d(expr)/d(variable)
export interface DerivativeAtom extends AtomBase {
  kind: 'derivative'
  expr: Row
  variable: Row
}

export type StructureAtom = FractionAtom | SuperscriptAtom | RootAtom | GroupAtom | DerivativeAtom

export type Atom = SymbolAtom | FunctionAtom | StructureAtom

// One step down the tree: the atom at `atom` in the current row, then its
// child row named `branch`.
export interface RowPathSegment {
  atom: number
  branch: BranchName
}

// Path from the root row to a row. [] is the root row itself.
export type RowPath = RowPathSegment[]

// ---------------------------------------------------------------------------
// Child rows
// ---------------------------------------------------------------------------

// Child rows of an atom in navigation (reading) order. Atoms without child
// rows return []. An nth root's index comes before its body because it is
// drawn to the left; a square root has no index row at all.
export function childRows(atom: Atom): Array<[BranchName, Row]> {
  switch (atom.kind) {
    case 'fraction':
      return [
        ['num', atom.num],
        ['den', atom.den],
      ]
    case 'superscript':
      return [['sup', atom.sup]]
    case 'root':
      return atom.index
        ? [
            ['index', atom.index],
            ['body', atom.body],
          ]
        : [['body', atom.body]]
    case 'group':
      return [['body', atom.body]]
    case 'derivative':
      return [
        ['expr', atom.expr],
        ['variable', atom.variable],
      ]
    default:
      return []
  }
}

export function hasChildRows(atom: Atom): boolean {
  return childRows(atom).length > 0
}

export function getChildRow(atom: Atom, branch: BranchName): Row | null {
  return childRows(atom).find(([name]) => name === branch)?.[1] ?? null
}

// The row at `path`, or null if the path does not resolve.
export function getRow(root: Row, path: RowPath): Row | null {
  let row: Row = root

  for (const segment of path) {
    const atom = row[segment.atom]

    if (!atom) {
      return null
    }

    const child = getChildRow(atom, segment.branch)

    if (!child) {
      return null
    }

    row = child
  }

  return row
}

export function rowPathsEqual(a: RowPath, b: RowPath): boolean {
  return (
    a.length === b.length &&
    a.every((segment, i) => segment.atom === b[i].atom && segment.branch === b[i].branch)
  )
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

let nextId = 0

export function newAtomId(): string {
  nextId += 1
  return `a${nextId}`
}

export function symbol(value: string): SymbolAtom {
  return { kind: 'symbol', id: newAtomId(), value }
}

export function func(name: string): FunctionAtom {
  return { kind: 'function', id: newAtomId(), name }
}

export function fraction(num: Row = [], den: Row = []): FractionAtom {
  return { kind: 'fraction', id: newAtomId(), num, den }
}

export function superscript(sup: Row = []): SuperscriptAtom {
  return { kind: 'superscript', id: newAtomId(), sup }
}

export function root(body: Row = [], index: Row | null = null): RootAtom {
  return { kind: 'root', id: newAtomId(), index, body }
}

export function group(
  body: Row = [],
  open: GroupDelimiter = '(',
  close?: GroupDelimiter,
): GroupAtom {
  return { kind: 'group', id: newAtomId(), open, close: close ?? (open === '(' ? ')' : open), body }
}

export function derivative(expr: Row = [], variable: Row = []): DerivativeAtom {
  return { kind: 'derivative', id: newAtomId(), expr, variable }
}

// Convenience row builder: strings are split into one symbol atom per
// character, atoms are used as-is. row('x+', fraction(row('1'), row('2')))
// is the row "x + 1/2".
export function row(...items: Array<string | Atom>): Row {
  return items.flatMap((item) =>
    typeof item === 'string' ? Array.from(item).map((char) => symbol(char)) : [item],
  )
}
