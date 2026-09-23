// Editing commands over the layout tree (see docs/cursor-refactor.md).
//
// Every command is a pure function EditorState -> EditorState. A command that
// has nothing to do returns the *same* state object, so callers can tell a
// no-op apart (e.g. Backspace in an empty equation lets the workbench remove
// the line instead).
//
// Commands only ever insert or remove atoms at the cursor and move the
// cursor; the semantic tree is re-derived by parse.ts after every change, so
// there is no operator-precedence logic here.
//
// With a selection (see selection.ts), typing replaces it, Backspace/Delete
// remove it, and structure commands wrap it: "/" makes it the numerator,
// "(" and "|" bracket it, \sqrt makes it the radicand, \sin the argument, …

import { type Cursor, allPositions, cursorAtStart, cursorsEqual } from './cursor'
import {
  type Atom,
  type BranchName,
  type GroupDelimiter,
  type Row,
  type RowPath,
  childRows,
  derivative,
  fraction,
  func,
  getChildRow,
  getRow,
  group,
  root,
  row,
  superscript,
  symbol,
} from './layout'
import { collapseSelection, selectionOf } from './selection'
import { GREEK_NAMES, functionForSpelling } from './identifiers'
import { getFunctionDefinition } from '../registry/nodes'

export interface EditorState {
  root: Row
  cursor: Cursor
  // Other end of the selection (see selection.ts); null/absent when nothing
  // is selected. Commands that edit always return a state without one.
  anchor?: Cursor | null
}

export type Command = (state: EditorState) => EditorState

export function emptyState(): EditorState {
  return { root: [], cursor: cursorAtStart() }
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

function requireRow(tree: Row, path: RowPath): Row {
  const found = getRow(tree, path)
  if (!found) throw new Error('Cursor path does not resolve')
  return found
}

// Rebuild the tree with the row at `path` replaced by update(row).
function updateRow(tree: Row, path: RowPath, update: (row: Row) => Row): Row {
  if (path.length === 0) return update(tree)

  const [head, ...rest] = path
  const atom = tree[head.atom]
  const child = getChildRow(atom, head.branch)
  if (!child) throw new Error('Cursor path does not resolve')

  const next = tree.slice()
  // Branch names are the atoms' own property names (num, den, sup, …).
  next[head.atom] = { ...atom, [head.branch]: updateRow(child, rest, update) } as Atom
  return next
}

function splice(
  state: EditorState,
  path: RowPath,
  start: number,
  deleteCount: number,
  items: Atom[],
  cursor: Cursor,
): EditorState {
  return {
    root: updateRow(state.root, path, (r) => [
      ...r.slice(0, start),
      ...items,
      ...r.slice(start + deleteCount),
    ]),
    cursor,
  }
}

const OPERATOR_VALUES = new Set(['+', '-', '−', '=', '*', '·', '×', ','])

function isOperator(atom: Atom | undefined): boolean {
  return atom?.kind === 'symbol' && OPERATOR_VALUES.has(atom.value)
}

function isEmptyStructure(atom: Atom): boolean {
  const rows = childRows(atom)
  return rows.length > 0 && rows.every(([, r]) => r.length === 0)
}

// The atom that owns the cursor's row, and where it sits.
interface Owner {
  rowPath: RowPath
  index: number
  atom: Atom
  branch: BranchName
}

function ownerOf(state: EditorState, depth = state.cursor.path.length): Owner | null {
  if (depth === 0) return null
  const path = state.cursor.path
  const rowPath = path.slice(0, depth - 1)
  const { atom: index, branch } = path[depth - 1]
  return { rowPath, index, atom: requireRow(state.root, rowPath)[index], branch }
}

// Replace a structure atom by the contents of all its rows, in order.
function unwrap(state: EditorState, owner: Owner, cursorOffset: number): EditorState {
  const content = childRows(owner.atom).flatMap(([, r]) => r)
  return splice(state, owner.rowPath, owner.index, 1, content, {
    path: owner.rowPath,
    offset: owner.index + cursorOffset,
  })
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

// Remove the selected atoms, leaving the cursor where they were. Without a
// selection, returns the state unchanged (minus a leftover empty anchor).
function clearSelection(state: EditorState): EditorState {
  const selection = selectionOf(state)

  if (!selection) {
    return state.anchor ? { root: state.root, cursor: state.cursor } : state
  }

  return splice(state, selection.path, selection.start, selection.end - selection.start, [], {
    path: selection.path,
    offset: selection.start,
  })
}

// A bracketed operand loses its brackets when it becomes a numerator:
// (x+1)/ gives x+1 over □.
function withoutOuterParens(content: Row): Row {
  const only = content[0]
  return content.length === 1 && only.kind === 'group' && only.open === '(' ? only.body : content
}

// A structure built around the selection, or an empty one at the cursor.
// With a selection, the selected atoms become `build(selection)` and the
// cursor goes to the new atom's `wrappedInto` row (or just `after` it);
// without one, `build([])` is inserted and the cursor goes to `emptyInto`.
function wrapSelection(
  build: (content: Row) => Atom,
  wrappedInto: BranchName | 'after',
  emptyInto: BranchName,
): Command {
  return (state) => {
    const selection = selectionOf(state)

    if (!selection) {
      const base = clearSelection(state)
      const { path, offset } = base.cursor
      return splice(base, path, offset, 0, [build([])], {
        path: [...path, { atom: offset, branch: emptyInto }],
        offset: 0,
      })
    }

    const { path, start, end } = selection
    const content = requireRow(state.root, path).slice(start, end)
    const cursor: Cursor =
      wrappedInto === 'after'
        ? { path, offset: start + 1 }
        : { path: [...path, { atom: start, branch: wrappedInto }], offset: 0 }

    return splice(state, path, start, end - start, [build(content)], cursor)
  }
}

function displayName(name: string): string {
  return getFunctionDefinition(name)?.latexName ?? name
}

// ---------------------------------------------------------------------------
// Typing
// ---------------------------------------------------------------------------

// Insert atoms at the cursor, replacing the selection if there is one; the
// cursor goes after them (pasting).
export function insertAtoms(atoms: Row): Command {
  return (current) => {
    const state = clearSelection(current)
    if (atoms.length === 0) return state

    const { path, offset } = state.cursor
    return splice(state, path, offset, 0, atoms, { path, offset: offset + atoms.length })
  }
}

// Insert one glyph (digit, letter, operator, …) at the cursor. Letters are
// never turned into anything else as they are typed: which letters form a
// name, and whether a name is a function, is worked out from the whole run
// when parsing and rendering (see identifiers.ts).
export function insertSymbol(value: string): Command {
  return (current) => {
    const state = clearSelection(current)
    const { path, offset } = state.cursor
    return splice(state, path, offset, 0, [symbol(value)], { path, offset: offset + 1 })
  }
}

// Insert a structure atom at the cursor and move into one of its rows.
export function insertStructure(atom: Atom, branch: BranchName): Command {
  return (current) => {
    const state = clearSelection(current)
    const { path, offset } = state.cursor
    return splice(state, path, offset, 0, [atom], {
      path: [...path, { atom: offset, branch }],
      offset: 0,
    })
  }
}

// \frac and the toolbar button: the selection becomes the numerator (cursor
// to the denominator); without one, an empty fraction (cursor to the
// numerator).
export const fractionOfSelection: Command = wrapSelection(
  (content) => fraction(withoutOuterParens(content), []),
  'den',
  'num',
)

// "/": the selection, or else the operand just before the cursor (everything
// back to the previous operator), becomes the numerator, and the cursor goes
// to the denominator. A bracketed operand loses its brackets: (x+1)/ gives
// x+1 over □. With nothing before the cursor, both rows start empty and the
// cursor goes to the numerator.
export const insertFraction: Command = (current) => {
  if (selectionOf(current)) return fractionOfSelection(current)

  const state = clearSelection(current)
  const { path, offset } = state.cursor
  const here = requireRow(state.root, path)

  let start = offset
  while (start > 0 && !isOperator(here[start - 1])) start--

  const numerator = withoutOuterParens(here.slice(start, offset))

  const branch: BranchName = numerator.length > 0 ? 'den' : 'num'
  return splice(state, path, start, offset - start, [fraction(numerator, [])], {
    path: [...path, { atom: start, branch }],
    offset: 0,
  })
}

// "^": into the superscript right after the cursor, or the end of the one
// right before it, or a new one. With a selection, the selection gets the
// exponent: a single atom directly, several in brackets ((a+b)^□).
export const insertSuperscript: Command = (current) => {
  const selection = selectionOf(current)

  if (selection) {
    const { path, start, end } = selection
    const content = requireRow(current.root, path).slice(start, end)
    const base = content.length === 1 ? content : [group(content, '(')]
    return splice(current, path, start, end - start, [...base, superscript()], {
      path: [...path, { atom: start + base.length, branch: 'sup' }],
      offset: 0,
    })
  }

  const state = clearSelection(current)
  const { path, offset } = state.cursor
  const here = requireRow(state.root, path)
  const after = here[offset]
  const before = here[offset - 1]

  if (after?.kind === 'superscript') {
    return {
      root: state.root,
      cursor: { path: [...path, { atom: offset, branch: 'sup' }], offset: 0 },
    }
  }

  if (before?.kind === 'superscript') {
    return {
      root: state.root,
      cursor: { path: [...path, { atom: offset - 1, branch: 'sup' }], offset: before.sup.length },
    }
  }

  return insertStructure(superscript(), 'sup')(state)
}

// The nearest enclosing bracket group opened with `open`, at any depth.
function enclosingGroup(
  state: EditorState,
  open: GroupDelimiter,
): { owner: Owner; depth: number } | null {
  for (let depth = state.cursor.path.length; depth > 0; depth--) {
    const owner = ownerOf(state, depth)!
    if (owner.atom.kind === 'group' && owner.atom.open === open) return { owner, depth }
  }
  return null
}

// ")" or a closing "|": leave the enclosing group. Typed directly inside the
// group, anything after the cursor moves out with it, so "(x|+1" + ")" gives
// "(x)+1".
function closeGroup(open: GroupDelimiter): Command {
  return (current) => {
    // A selection stays inside the brackets being closed.
    const state = current.anchor ? collapseSelection(current, 'end') : current
    const found = enclosingGroup(state, open)
    if (!found) return current

    const { owner, depth } = found
    const after: Cursor = { path: owner.rowPath, offset: owner.index + 1 }

    if (depth !== state.cursor.path.length || owner.atom.kind !== 'group') {
      return { root: state.root, cursor: after }
    }

    const body = owner.atom.body
    const offset = state.cursor.offset
    const closed = { ...owner.atom, body: body.slice(0, offset) }
    return splice(state, owner.rowPath, owner.index, 1, [closed, ...body.slice(offset)], after)
  }
}

// "(": an empty group with the cursor inside, or brackets round the selection.
export const openParen: Command = wrapSelection((content) => group(content, '('), 'after', 'body')

export const closeParen: Command = closeGroup('(')

// "|" closes the absolute value the cursor is directly inside, otherwise
// opens a new one; with a selection, puts |…| round it.
export const absBar: Command = (state) => {
  if (selectionOf(state)) return insertAbs(state)
  const owner = ownerOf(state)
  if (owner?.atom.kind === 'group' && owner.atom.open === '|') return closeGroup('|')(state)
  return insertStructure(group([], '|'), 'body')(state)
}

// Space: step out of the innermost structure, to just after it
// (e.g. x^2 + space, then keep typing on the baseline).
export const exitStructure: Command = (state) => {
  if (selectionOf(state)) return collapseSelection(state, 'end')
  const owner = ownerOf(state)
  if (!owner) return state
  return { root: state.root, cursor: { path: owner.rowPath, offset: owner.index + 1 } }
}

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

// Backspace.
// - After a symbol: delete it.
// - After a function: remove its last letter ("sin" -> "si"), so a
//   recognised name can be undone letter by letter.
// - After a structure: step into it (its last row, at the end) — or delete it
//   if all its rows are empty.
// - At the start of a row inside a structure: delete the structure if it is
//   empty; from a later row, move to the end of the previous row; from the
//   first row, remove the structure but keep its content ("(x+1" -> "x+1").
// - At the start of the equation: nothing (returns the same state).
export const deleteBackward: Command = (state) => {
  if (selectionOf(state)) return clearSelection(state)
  const { path, offset } = state.cursor
  const current = requireRow(state.root, path)

  if (offset > 0) {
    const atom = current[offset - 1]
    const start = offset - 1

    if (atom.kind === 'symbol') {
      return splice(state, path, start, 1, [], { path, offset: start })
    }

    if (atom.kind === 'function') {
      const letters = row(displayName(atom.name).slice(0, -1))
      return splice(state, path, start, 1, letters, { path, offset: start + letters.length })
    }

    if (isEmptyStructure(atom)) {
      return splice(state, path, start, 1, [], { path, offset: start })
    }

    const rows = childRows(atom)
    const [branch, last] = rows[rows.length - 1]
    return {
      root: state.root,
      cursor: { path: [...path, { atom: start, branch }], offset: last.length },
    }
  }

  const owner = ownerOf(state)
  if (!owner) return state

  if (isEmptyStructure(owner.atom)) {
    return splice(state, owner.rowPath, owner.index, 1, [], {
      path: owner.rowPath,
      offset: owner.index,
    })
  }

  const rows = childRows(owner.atom)
  const index = rows.findIndex(([name]) => name === owner.branch)

  if (index > 0) {
    const [branch, previous] = rows[index - 1]
    return {
      root: state.root,
      cursor: { path: [...owner.rowPath, { atom: owner.index, branch }], offset: previous.length },
    }
  }

  return unwrap(state, owner, 0)
}

// Delete (forward delete): the mirror image of Backspace.
export const deleteForward: Command = (state) => {
  if (selectionOf(state)) return clearSelection(state)
  const { path, offset } = state.cursor
  const current = requireRow(state.root, path)

  if (offset < current.length) {
    const atom = current[offset]

    if (atom.kind === 'symbol') {
      return splice(state, path, offset, 1, [], { path, offset })
    }

    if (atom.kind === 'function') {
      return splice(state, path, offset, 1, row(displayName(atom.name).slice(1)), { path, offset })
    }

    if (isEmptyStructure(atom)) {
      return splice(state, path, offset, 1, [], { path, offset })
    }

    const [branch] = childRows(atom)[0]
    return { root: state.root, cursor: { path: [...path, { atom: offset, branch }], offset: 0 } }
  }

  const owner = ownerOf(state)
  if (!owner) return state

  if (isEmptyStructure(owner.atom)) {
    return splice(state, owner.rowPath, owner.index, 1, [], {
      path: owner.rowPath,
      offset: owner.index,
    })
  }

  const rows = childRows(owner.atom)
  const index = rows.findIndex(([name]) => name === owner.branch)

  if (index < rows.length - 1) {
    const [branch] = rows[index + 1]
    return {
      root: state.root,
      cursor: { path: [...owner.rowPath, { atom: owner.index, branch }], offset: 0 },
    }
  }

  const contentLength = rows.reduce((sum, [, r]) => sum + r.length, 0)
  return unwrap(state, owner, contentLength)
}

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

// Tab / Shift+Tab: the next (or previous) empty row, wrapping around. Returns
// the same state if there is no other empty row.
export function nextPlaceholder(direction: 'forward' | 'backward'): Command {
  return (state) => {
    const positions = allPositions(state.root)
    const empty = positions.filter(({ path }) => requireRow(state.root, path).length === 0)
    if (empty.length === 0) return state

    const here = positions.findIndex((p) => cursorsEqual(p, state.cursor))
    const ordered =
      direction === 'forward'
        ? [...positions.slice(here + 1), ...positions.slice(0, here + 1)]
        : [...positions.slice(0, here).reverse(), ...positions.slice(here).reverse()]

    const target = ordered.find((p) => requireRow(state.root, p.path).length === 0)
    if (!target || cursorsEqual(target, state.cursor)) return state
    return { root: state.root, cursor: target }
  }
}

// ---------------------------------------------------------------------------
// Named commands ("\frac", "\sqrt", "\alpha", toolbar buttons)
// ---------------------------------------------------------------------------

// A function head followed by an empty bracket group, cursor inside: sin(□).
// With a selection, the selection becomes the argument: sin(selection).
export function insertFunction(name: string): Command {
  return (current) => {
    const selection = selectionOf(current)

    if (selection) {
      const { path, start, end } = selection
      const content = requireRow(current.root, path).slice(start, end)
      return splice(current, path, start, end - start, [func(name), group(content, '(')], {
        path,
        offset: start + 2,
      })
    }

    const state = clearSelection(current)
    const { path, offset } = state.cursor
    return splice(state, path, offset, 0, [func(name), group([], '(')], {
      path: [...path, { atom: offset + 1, branch: 'body' }],
      offset: 0,
    })
  }
}

// With a selection these wrap it: √(selection) with the cursor after it;
// the nth root takes it as the radicand with the cursor in the index; |…|;
// the derivative takes it as the expression with the cursor in the variable.
export const insertSquareRoot: Command = wrapSelection((content) => root(content), 'after', 'body')
export const insertNthRoot: Command = wrapSelection(
  (content) => root(content, []),
  'index',
  'index',
)
export const insertAbs: Command = wrapSelection((content) => group(content, '|'), 'after', 'body')
export const insertDerivative: Command = wrapSelection(
  (content) => derivative(content, []),
  'variable',
  'expr',
)

// The command for "\name". A Greek letter's name inserts that letter
// ("\alpha" gives α); any other name is typed out as letters, so "\speed"
// gives the variable speed.
export function namedCommand(name: string): Command {
  switch (name) {
    case 'frac':
    case 'fraction':
      return fractionOfSelection
    case 'sqrt':
      return insertSquareRoot
    case 'root':
      return insertNthRoot
    case 'abs':
      return insertAbs
    case 'dd':
    case 'diff':
    case 'derivative':
      return insertDerivative
    case 'pow':
    case 'power':
      return insertSuperscript
  }

  const spelled = functionForSpelling(name)
  if (spelled) return insertFunction(spelled)

  return insertAtoms(GREEK_NAMES.has(name) ? [symbol(name)] : row(name))
}
