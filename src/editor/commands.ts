// Editing commands over the layout tree (see docs/design.md).
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
  type FractionAtom,
  type GroupDelimiter,
  type PiecewiseAtom,
  type Row,
  type RowPath,
  childRows,
  derivative,
  fraction,
  func,
  getChildRow,
  getRow,
  group,
  piecewise,
  piecewiseBranch,
  root,
  row,
  setChildRow,
  superscript,
  symbol,
  unitsAtom,
} from './layout'
import { collapseSelection, selectionOf } from './selection'
import {
  DEFAULT_OTHERWISE,
  GREEK_NAMES,
  bracketFunctionBefore,
  functionForSpelling,
  nameRuns,
  numberRuns,
} from './identifiers'
import { withNameKeyword } from './names'
import { continuesNumber, followsNumber, inUnits, isUnits } from './numberUnits'
import { CONSTANTS, constantForCommand } from './constants'
import {
  CONDITION_OPERATORS,
  combinedWithEquals,
  conditionOperator,
  conditionOperatorForCommand,
} from './operators'
import { FUNCTION_REGISTRY, functionLatex, getFunctionDefinition } from '../registry/nodes'

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
  next[head.atom] = setChildRow(atom, head.branch, updateRow(child, rest, update))
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

// Whether a new superscript can attach to this atom: there is one, and it
// isn't an operator (arithmetic, comparison or logic).
function canTakeSuperscript(atom: Atom | undefined): boolean {
  if (!atom || isOperator(atom)) return false
  return atom.kind !== 'symbol' || !conditionOperator(atom.value)
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
  // A piecewise's rows don't join up into anything meaningful, and a units
  // name dropped into the row would become a variable, so neither is
  // dissolved: the cursor just steps out, before it (Backspace) or after it
  // (Delete). Removing pieces is done piece by piece.
  if (owner.atom.kind === 'piecewise' || owner.atom.kind === 'units') {
    const offset = cursorOffset === 0 ? owner.index : owner.index + 1
    return { root: state.root, cursor: { path: owner.rowPath, offset } }
  }

  const content = childRows(owner.atom).flatMap(([, r]) => r)
  return splice(state, owner.rowPath, owner.index, 1, content, {
    path: owner.rowPath,
    offset: owner.index + cursorOffset,
  })
}

// ---------------------------------------------------------------------------
// Piecewise pieces
// ---------------------------------------------------------------------------

interface PiecewiseOwner extends Owner {
  atom: PiecewiseAtom
}

// The innermost piecewise the cursor is inside, at any depth (the cursor may
// be in a fraction inside a condition).
function enclosingPiecewise(state: EditorState): PiecewiseOwner | null {
  for (let depth = state.cursor.path.length; depth > 0; depth--) {
    const owner = ownerOf(state, depth)
    if (owner?.atom.kind === 'piecewise') return owner as PiecewiseOwner
  }
  return null
}

const branchPath = (owner: Owner, branch: BranchName): RowPath => [
  ...owner.rowPath,
  { atom: owner.index, branch },
]

const isEmptyPiece = (piece: { value: Row; condition: Row }) =>
  piece.value.length === 0 && piece.condition.length === 0

// Enter inside a piecewise: a new, empty piece below the current one (from
// otherwise, the new piece goes last, just above it), with the cursor in its
// value. Outside a piecewise, nothing (Enter then adds an equation line).
export const newPiece: Command = (state) => {
  const owner = enclosingPiecewise(state)
  if (!owner) return state

  const where = piecewiseBranch(owner.branch)!
  const { pieces } = owner.atom
  const at = where.part === 'otherwise' ? pieces.length : where.piece + 1
  const atom: PiecewiseAtom = {
    ...owner.atom,
    pieces: [...pieces.slice(0, at), { value: [], condition: [] }, ...pieces.slice(at)],
  }

  return splice(state, owner.rowPath, owner.index, 1, [atom], {
    path: branchPath(owner, `value${at}`),
    offset: 0,
  })
}

// \otherwise: give the enclosing piecewise an otherwise (0.0, selected so
// typing replaces it), or move to the one it has.
export const addOtherwise: Command = (state) => {
  const owner = enclosingPiecewise(state)
  if (!owner) return state

  const path = branchPath(owner, 'otherwise')

  if (owner.atom.otherwise) {
    return { root: state.root, cursor: { path, offset: owner.atom.otherwise.length } }
  }

  const otherwise = row(DEFAULT_OTHERWISE)
  const next = splice(state, owner.rowPath, owner.index, 1, [{ ...owner.atom, otherwise }], {
    path,
    offset: otherwise.length,
  })
  return { ...next, anchor: { path, offset: 0 } }
}

// Backspace at the start of a row of a piecewise, for the cases that remove a
// piece: in an empty piece (not the only one), remove it and go to the end
// of the piece above; in an empty otherwise, remove it. Null otherwise.
function deletePieceBackward(state: EditorState, owner: PiecewiseOwner): EditorState | null {
  const where = piecewiseBranch(owner.branch)!
  const { pieces, otherwise } = owner.atom

  if (where.part === 'otherwise') {
    if (!otherwise || otherwise.length > 0) return null
    const last = pieces.length - 1
    return splice(state, owner.rowPath, owner.index, 1, [{ ...owner.atom, otherwise: null }], {
      path: branchPath(owner, `cond${last}`),
      offset: pieces[last].condition.length,
    })
  }

  if (where.part !== 'value' || pieces.length < 2 || !isEmptyPiece(pieces[where.piece])) {
    return null
  }

  const atom = { ...owner.atom, pieces: pieces.filter((_, i) => i !== where.piece) }
  const cursor =
    where.piece > 0
      ? {
          path: branchPath(owner, `cond${where.piece - 1}`),
          offset: pieces[where.piece - 1].condition.length,
        }
      : { path: branchPath(owner, 'value0'), offset: 0 }
  return splice(state, owner.rowPath, owner.index, 1, [atom], cursor)
}

// Delete at the end of a row of a piecewise: the mirror image. In an empty
// piece (not the only one), remove it and go to the start of what followed;
// in an empty otherwise, remove it and step out after the piecewise.
function deletePieceForward(state: EditorState, owner: PiecewiseOwner): EditorState | null {
  const where = piecewiseBranch(owner.branch)!
  const { pieces, otherwise } = owner.atom

  if (where.part === 'otherwise') {
    if (!otherwise || otherwise.length > 0) return null
    return splice(state, owner.rowPath, owner.index, 1, [{ ...owner.atom, otherwise: null }], {
      path: owner.rowPath,
      offset: owner.index + 1,
    })
  }

  if (pieces.length < 2 || !isEmptyPiece(pieces[where.piece])) return null

  const atom = { ...owner.atom, pieces: pieces.filter((_, i) => i !== where.piece) }
  const cursor =
    where.piece < atom.pieces.length
      ? { path: branchPath(owner, `value${where.piece}`), offset: 0 }
      : atom.otherwise
        ? { path: branchPath(owner, 'otherwise'), offset: 0 }
        : { path: owner.rowPath, offset: owner.index + 1 }
  return splice(state, owner.rowPath, owner.index, 1, [atom], cursor)
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

// "=": after "<", ">" or "¬" it combines with it into "≤", "≥" or "≠"
// (typed <=, >=, !=); otherwise it is an equals sign.
export const typeEquals: Command = (current) => {
  if (!selectionOf(current)) {
    const { path, offset } = current.cursor
    const before = requireRow(current.root, path)[offset - 1]
    const combined = before?.kind === 'symbol' ? combinedWithEquals(before.value) : undefined

    if (combined) {
      const state = { root: current.root, cursor: current.cursor }
      return splice(state, path, offset - 1, 1, [symbol(combined)], { path, offset })
    }
  }

  return insertSymbol('=')(current)
}

// A piecewise with one piece and an otherwise pre-filled with 0.0, with the
// cursor in the first value. A selection becomes the first value.
export const insertPiecewise: Command = (current) => {
  const selection = selectionOf(current)

  if (selection) {
    const { path, start, end } = selection
    const content = requireRow(current.root, path).slice(start, end)
    const atom = piecewise([[content, []]], row(DEFAULT_OTHERWISE))
    return splice(current, path, start, end - start, [atom], {
      path: [...path, { atom: start, branch: 'cond0' }],
      offset: 0,
    })
  }

  return insertStructure(piecewise([[[], []]], row(DEFAULT_OTHERWISE)), 'value0')(current)
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
// exponent: a single atom directly, several in brackets ((a+b)^□). Without a
// base before the cursor (start of a row, an operator) it does nothing, so
// "^^" doesn't nest an empty exponent inside another.
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

  if (!canTakeSuperscript(before)) return current

  return insertStructure(superscript(), 'sup')(state)
}

// The nearest enclosing bracket group opened with one of `opens`, at any
// depth.
function enclosingGroup(
  state: EditorState,
  opens: readonly GroupDelimiter[],
): { owner: Owner; depth: number } | null {
  for (let depth = state.cursor.path.length; depth > 0; depth--) {
    const owner = ownerOf(state, depth)!
    if (owner.atom.kind === 'group' && opens.includes(owner.atom.open)) return { owner, depth }
  }
  return null
}

// ")" or a closing "|": leave the enclosing group. Typed directly inside the
// group, anything after the cursor moves out with it, so "(x|+1" + ")" gives
// "(x)+1".
function closeGroup(opens: readonly GroupDelimiter[]): Command {
  return (current) => {
    // A selection stays inside the brackets being closed.
    const state = current.anchor ? collapseSelection(current, 'end') : current
    const found = enclosingGroup(state, opens)
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

const bracketsRound = (open: GroupDelimiter): Command =>
  wrapSelection((content) => group(content, open), 'after', 'body')

// "(": an empty group with the cursor inside, or brackets round the
// selection. Straight after a typed floor, ceil or ceiling, the name becomes
// the function's brackets instead: floor( gives ⌊‸⌋, as with <= giving ≤.
export const openParen: Command = (state) => {
  if (!selectionOf(state)) {
    const { path, offset } = state.cursor
    const found = bracketFunctionBefore(requireRow(state.root, path), offset)
    if (found) {
      return splice(state, path, found.start, offset - found.start, [group([], found.open)], {
        path: [...path, { atom: found.start, branch: 'body' }],
        offset: 0,
      })
    }
  }

  return bracketsRound('(')(state)
}

// "{" (or \units): units for the number just before the cursor, with the
// cursor inside to type their name: 0.25{mV}. At the end of a number that has
// units already, it opens them instead, their name selected, to change them.
// Elsewhere (no number before the cursor, or already in units), nothing.
export const insertUnits: Command = (state) => {
  if (inUnits(state.cursor)) return state
  const { path, offset } = state.cursor
  const row = requireRow(state.root, path)

  const before = row[offset - 1]
  if (!selectionOf(state) && before?.kind === 'units') {
    const inside = [...path, { atom: offset - 1, branch: 'units' as const }]
    return {
      root: state.root,
      cursor: { path: inside, offset: before.units.length },
      anchor: before.units.length ? { path: inside, offset: 0 } : null,
    }
  }

  const collapsed = clearSelection(state)
  const at = collapsed.cursor.offset
  const here = requireRow(collapsed.root, collapsed.cursor.path)
  const number = numberRuns(here.slice(0, at)).find((run) => run.end === at)
  if (!number) return state
  return insertStructure(unitsAtom(), 'units')(collapsed)
}

// A typed character: at the end of a number whose units are hidden, one that
// continues the number goes before the units (5{volt}, then 0, is 50{volt};
// then + goes after them).
export function typeSymbol(value: string): Command {
  return (current) => {
    const { path, offset } = current.cursor
    const row = requireRow(current.root, path)

    if (
      !selectionOf(current) &&
      isUnits(row[offset - 1]) &&
      continuesNumber(row, offset - 1, value)
    ) {
      return splice(current, path, offset - 1, 0, [symbol(value)], { path, offset: offset + 1 })
    }
    return insertSymbol(value)(current)
  }
}

// "}": leave the units atom the cursor is in (at any depth). Elsewhere,
// nothing.
export const closeUnits: Command = (current) => {
  const state = current.anchor ? collapseSelection(current, 'end') : current
  for (let depth = state.cursor.path.length; depth > 0; depth--) {
    const owner = ownerOf(state, depth)!
    if (owner.atom.kind === 'units') {
      return { root: state.root, cursor: { path: owner.rowPath, offset: owner.index + 1 } }
    }
  }
  return current
}

// \floor, \ceil: ⌊‸⌋ or ⌈‸⌉, or round the selection.
export const insertFloor: Command = bracketsRound('⌊')
export const insertCeiling: Command = bracketsRound('⌈')

// ")" closes the nearest brackets, floor or ceiling brackets included (the
// ")" of "floor(x)").
export const closeParen: Command = closeGroup(['(', '⌊', '⌈'])

// "|" closes the absolute value the cursor is directly inside, otherwise
// opens a new one; with a selection, puts |…| round it.
export const absBar: Command = (state) => {
  if (selectionOf(state)) return insertAbs(state)
  const owner = ownerOf(state)
  if (owner?.atom.kind === 'group' && owner.atom.open === '|') return closeGroup(['|'])(state)
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

interface FractionOwner extends Owner {
  atom: FractionAtom
}

// Backspace in an empty denominator undoes "/": the fraction goes and its
// numerator is left in the row, cursor after it. A numerator with an operator
// at its top level gets its brackets back, as "(x+1)/" dropped them and
// "2(x+1)" must not become "2x+1".
function dissolveFraction(state: EditorState, owner: FractionOwner): EditorState {
  const { num } = owner.atom
  const content = num.some(isOperator) ? [group(num, '(')] : num
  return splice(state, owner.rowPath, owner.index, 1, content, {
    path: owner.rowPath,
    offset: owner.index + content.length,
  })
}

// Backspace.
// - After a number's (hidden) units: the number's last digit (with the last
//   one, the units go too).
// - After a symbol: delete it.
// - After a function: remove its last letter ("sin" -> "si"), so a
//   recognised name can be undone letter by letter.
// - After a structure: step into it (its last row, at the end) — or delete it
//   if all its rows are empty.
// - At the start of a row inside a structure: delete the structure if it is
//   empty; in an empty denominator, remove the fraction and keep the
//   numerator (bracketed if it needs it); from a later row, move to the end
//   of the previous row; from the first row, remove the structure but keep
//   its content ("(x+1" -> "x+1").
// - At the start of the equation: nothing (returns the same state).
export const deleteBackward: Command = (state) => {
  if (selectionOf(state)) return clearSelection(state)
  const { path, offset } = state.cursor
  const current = requireRow(state.root, path)

  if (offset > 0) {
    const atom = current[offset - 1]
    const start = offset - 1

    // After a number's hidden units: the number's last digit, and with the
    // number's last digit, its units too.
    if (atom.kind === 'units') {
      if (current[start - 1]?.kind !== 'symbol') {
        return splice(state, path, start, 1, [], { path, offset: start })
      }
      const shorter = [...current.slice(0, start - 1), ...current.slice(start)]
      return followsNumber(shorter, start - 1)
        ? splice(state, path, start - 1, 1, [], { path, offset: start })
        : splice(state, path, start - 1, 2, [], { path, offset: start - 1 })
    }

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

  if (owner.atom.kind === 'piecewise') {
    const removed = deletePieceBackward(state, owner as PiecewiseOwner)
    if (removed) return removed
  }

  if (isEmptyStructure(owner.atom)) {
    return splice(state, owner.rowPath, owner.index, 1, [], {
      path: owner.rowPath,
      offset: owner.index,
    })
  }

  if (owner.atom.kind === 'fraction' && owner.branch === 'den' && owner.atom.den.length === 0) {
    return dissolveFraction(state, owner as FractionOwner)
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

  if (owner.atom.kind === 'piecewise') {
    const removed = deletePieceForward(state, owner as PiecewiseOwner)
    if (removed) return removed
  }

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

// A keyword part (bar, hat, 2plus, conc; see nameScripts.ts) put in its
// place in the name the caret is in or at the end of, or in the selection if
// that is exactly one name: q with bar is q_bar, x_i with bar is x_bar_i.
// The caret goes after the name, which is drawn decorated once the caret
// leaves it, as a Greek name is. Nothing happens (the same state) when there
// is no name there, or it can't take the keyword (Glc_conc with 2plus, a
// function's name, a name drawn as typed).
export function decorateName(keyword: string): Command {
  return (state) => {
    const selection = selectionOf(state)
    const path = selection ? selection.path : state.cursor.path
    const atoms = requireRow(state.root, path)
    const { offset } = state.cursor
    const run = nameRuns(atoms).find((run) =>
      selection
        ? run.start === selection.start && run.end === selection.end
        : run.start < offset && offset <= run.end,
    )
    if (!run) return state

    const decorated = withNameKeyword(atoms.slice(run.start, run.end), keyword)
    if (!decorated) return state
    return splice(state, path, run.start, run.end - run.start, decorated, {
      path,
      offset: run.start + decorated.length,
    })
  }
}

// The structures a "\name" makes, by name (the first is the usual one), and
// how the command list shows them.
interface StructureCommand {
  names: readonly string[]
  title: string
  latex: string
  command: Command
}

const STRUCTURE_COMMANDS: readonly StructureCommand[] = [
  {
    names: ['frac', 'fraction'],
    title: 'Fraction',
    latex: '\\frac{a}{b}',
    command: fractionOfSelection,
  },
  { names: ['sqrt'], title: 'Square root', latex: '\\sqrt{x}', command: insertSquareRoot },
  { names: ['root'], title: 'nth root', latex: '\\sqrt[n]{x}', command: insertNthRoot },
  { names: ['abs'], title: 'Absolute value', latex: '|x|', command: insertAbs },
  {
    names: ['dd', 'diff', 'derivative'],
    title: 'Derivative',
    latex: '\\frac{\\mathrm{d}y}{\\mathrm{d}x}',
    command: insertDerivative,
  },
  { names: ['pow', 'power'], title: 'Power', latex: 'x^{n}', command: insertSuperscript },
  {
    names: ['cases', 'piecewise'],
    title: 'Piecewise',
    latex: '\\left\\{\\begin{smallmatrix}a&p\\\\b&q\\end{smallmatrix}\\right.',
    command: insertPiecewise,
  },
  {
    names: ['otherwise'],
    title: "A piecewise's otherwise",
    latex: '\\text{otherwise}',
    command: addOtherwise,
  },
  {
    names: ['units'],
    title: "A number's units",
    latex: '2\\,\\{\\mathrm{mV}\\}',
    command: insertUnits,
  },
  { names: ['floor', 'lfloor'], title: 'Floor', latex: '\\lfloor x\\rfloor', command: insertFloor },
  {
    names: ['ceil', 'ceiling', 'lceil'],
    title: 'Ceiling',
    latex: '\\lceil x\\rceil',
    command: insertCeiling,
  },
  // Decorations of the name before the caret. Charges are toolbar buttons
  // only (toolbar.ts), not commands.
  ...(
    [
      ['bar', 'Bar', '\\bar{x}'],
      ['hat', 'Hat', '\\hat{x}'],
      ['tilde', 'Tilde', '\\tilde{x}'],
      ['check', 'Check', '\\check{x}'],
    ] as const
  ).map(([name, title, latex]) => ({
    names: [name],
    title: `${title} over the name before the caret`,
    latex,
    command: decorateName(name),
  })),
  {
    names: ['conc'],
    title: 'Concentration of the name before the caret',
    latex: '[x]',
    command: decorateName('conc'),
  },
]

const STRUCTURE_BY_NAME = new Map(
  STRUCTURE_COMMANDS.flatMap((structure) => structure.names.map((name) => [name, structure])),
)

// The command for "\name". A Greek letter's name inserts that letter
// ("\alpha" gives α); any other name is typed out as letters, so "\speed"
// gives the variable speed.
export function namedCommand(name: string): Command {
  const structure = STRUCTURE_BY_NAME.get(name)
  if (structure) return structure.command

  const operator = conditionOperatorForCommand(name)
  if (operator) return insertSymbol(operator.symbol)

  const constant = constantForCommand(name)
  if (constant) return insertSymbol(constant.symbol)

  const spelled = functionForSpelling(name)
  if (spelled) return insertFunction(spelled)

  return insertAtoms(GREEK_NAMES.has(name) ? [symbol(name)] : row(name))
}

// ---------------------------------------------------------------------------
// The command list: what "\…" can be, as it's typed
// ---------------------------------------------------------------------------

export interface CommandSuggestion {
  // What to type (and run with namedCommand): the shortest spelling that
  // starts with what has been typed.
  name: string
  title: string
  latex: string
}

interface CatalogueEntry {
  names: readonly string[]
  title: string
  latex: string
}

const OPERATOR_TITLES: Record<string, string> = {
  Less: 'Less than',
  Greater: 'Greater than',
  LessEqual: 'Less than or equal',
  GreaterEqual: 'Greater than or equal',
  NotEqual: 'Not equal',
  And: 'And',
  Or: 'Or',
  Xor: 'Exclusive or',
  Not: 'Not',
}

const CONSTANT_TITLES: Record<string, string> = {
  pi: 'Pi',
  exponentiale: "Euler's number e",
  infinity: 'Infinity',
  notanumber: 'Not a number',
  true: 'True',
  false: 'False',
}

// Every command, in the order namedCommand tries them, so a spelling two
// could claim (pi: the constant, not the Greek letter) is only the first's.
const CATALOGUE: readonly CatalogueEntry[] = (() => {
  const entries: CatalogueEntry[] = [
    ...STRUCTURE_COMMANDS,
    ...CONDITION_OPERATORS.map((op) => ({
      names: op.commands,
      title: OPERATOR_TITLES[op.type],
      latex: op.latex,
    })),
    ...CONSTANTS.map((constant) => ({
      names: constant.commands,
      title: CONSTANT_TITLES[constant.symbol] ?? constant.symbol,
      latex: constant.latex,
    })),
    ...Object.values(FUNCTION_REGISTRY).map((definition) => ({
      names: [definition.name, definition.latexName, ...(definition.aliases ?? [])],
      title: 'Function',
      latex: functionLatex(definition.name),
    })),
    ...[...GREEK_NAMES].map((name) => ({
      names: [name],
      title: 'Greek letter',
      latex: `\\${name}`,
    })),
  ]
  const claimed = new Set<string>()
  return entries.flatMap((entry) => {
    const names = [...new Set(entry.names)].filter((name) => !claimed.has(name))
    for (const name of names) claimed.add(name)
    return names.length ? [{ ...entry, names }] : []
  })
})()

// The commands "\prefix" may be the start of: the one it is exactly first,
// then the rest in catalogue order (structures, operators, constants,
// functions, Greek letters).
export function commandSuggestions(prefix: string, limit = 8): CommandSuggestion[] {
  const matches = CATALOGUE.flatMap((entry, order) => {
    const spellings = entry.names.filter((name) => name.startsWith(prefix))
    if (!spellings.length) return []
    const name = spellings.reduce((shortest, spelling) =>
      spelling.length < shortest.length ? spelling : shortest,
    )
    return [
      { name, title: entry.title, latex: entry.latex, exact: spellings.includes(prefix), order },
    ]
  })
  return matches
    .sort((a, b) => Number(b.exact) - Number(a.exact) || a.order - b.order)
    .slice(0, limit)
    .map(({ name, title, latex }) => ({ name, title, latex }))
}
