// A number's units, kept out of sight. The units of 5{volt} are a units atom
// straight after the number (layout.ts), which the Content MathML needs but
// the reader doesn't: they are drawn only while being edited (the cursor is
// in them) or when something is wrong with them, and otherwise shown on hover.
//
// So that hidden units never leave the caret somewhere it can't be seen:
// - the gap just before a units atom isn't a caret position (it is painted in
//   the same place as the gap after it); `settleState` moves the cursor on;
// - movement steps over units without entering them (cursor.ts);
// - at the end of a number with units, characters that continue the number
//   go before the units (5{volt} then 0 gives 50{volt}), and Backspace deletes
//   the number's last digit, and with the last one its units (commands.ts);
// - `{` there opens the units, their name selected, to change them;
// - units left empty are removed once the cursor leaves them, and units left
//   without a number (the number deleted some other way) straight away.

import type { Cursor } from './cursor'
import { continuesName } from './identifiers'
import { type Atom, type Row, type RowPath, childRows, getRow, setChildRow } from './layout'

export const isUnits = (atom: Atom | undefined): boolean => atom?.kind === 'units'

// The cursor is inside a units atom (typing its name).
export const inUnits = (cursor: Cursor): boolean =>
  cursor.path.some((segment) => segment.branch === 'units')

// The id of the units atom the cursor is in, if any.
export function openUnitsId(root: Row, cursor: Cursor): string | null {
  let row: Row | null = root
  for (const segment of cursor.path) {
    const atom: Atom | undefined = row?.[segment.atom]
    if (!atom) return null
    if (atom.kind === 'units') return atom.id
    row = childRows(atom).find(([branch]) => branch === segment.branch)?.[1] ?? null
  }
  return null
}

const symbolValue = (atom: Atom | undefined) => (atom?.kind === 'symbol' ? atom.value : null)
const isDigit = (value: string | null) => value !== null && value >= '0' && value <= '9'

// The number written just before `end` in `row`, as far as it goes (digits, a
// point, an exponent and its sign): "", or null when what's there is a name
// ending in digits (x2).
function numberTextBefore(row: Row, end: number): string | null {
  let start = end
  while (start > 0) {
    const value = symbolValue(row[start - 1])
    const sign =
      (value === '+' || value === '-') && /^[eE]$/.test(symbolValue(row[start - 2]) ?? '')
    if (!(isDigit(value) || value === '.' || value === 'e' || value === 'E' || sign)) break
    start--
  }
  if (start > 0 && continuesName(row[start - 1])) return null
  return row
    .slice(start, end)
    .map((atom) => symbolValue(atom))
    .join('')
}

// Written as far as a number can be: 12, 1.5, .5, 1e, 1e-, 1e-3.
const NUMBER_SO_FAR = /^(\d+\.?\d*|\.\d*)([eE][+-]?\d*)?$/

// A units atom follows a number, or one being typed (1e- on the way to 1e-3).
export function followsNumber(row: Row, index: number): boolean {
  const before = numberTextBefore(row, index)
  return !!before && NUMBER_SO_FAR.test(before)
}

// Whether typing `text` at the end of the number before the units atom at
// `unitsIndex` continues that number.
export function continuesNumber(row: Row, unitsIndex: number, text: string): boolean {
  const before = numberTextBefore(row, unitsIndex)
  return before !== null && NUMBER_SO_FAR.test(before + text)
}

// A cursor in the gap just before a units atom, moved to the gap after it.
export function settleCursor(root: Row, cursor: Cursor): Cursor {
  const row = getRow(root, cursor.path)
  return row && isUnits(row[cursor.offset]) ? { ...cursor, offset: cursor.offset + 1 } : cursor
}

interface EditorLike {
  root: Row
  cursor: Cursor
  anchor?: Cursor | null
}

// The state with no cursor before hidden units, and without the units that
// are no longer wanted: those left empty (unless the cursor is in them, typing
// their name), and those left without a number. Returns the same state when
// nothing changes.
export function settleState<S extends EditorLike>(state: S): S {
  const cursor = settleCursor(state.root, state.cursor)
  const anchor = state.anchor ? settleCursor(state.root, state.anchor) : state.anchor
  const moved = cursor !== state.cursor || anchor !== state.anchor

  const removed = new Map<string, number[]>()
  const root = tidyRow(state.root, [], cursor, removed)

  if (removed.size === 0) return moved ? { ...state, cursor, anchor } : state

  return {
    ...state,
    root,
    cursor: shifted(cursor, removed)!,
    anchor: anchor ? shifted(anchor, removed) : anchor,
  }
}

const key = (path: RowPath) => path.map((s) => `${s.atom}.${s.branch}`).join('/')

function tidyRow(row: Row, path: RowPath, cursor: Cursor, removed: Map<string, number[]>): Row {
  const here = key(path)
  const gone: number[] = []
  let changed = false

  const kept = row.flatMap((atom, index): Atom[] => {
    if (atom.kind === 'units') {
      const inside =
        cursor.path.length > path.length &&
        key(cursor.path.slice(0, path.length)) === here &&
        cursor.path[path.length].atom === index
      const unwanted = atom.units.length === 0 ? !inside : !followsNumber(row, index) && !inside

      if (unwanted) {
        gone.push(index)
        return []
      }
      return [atom]
    }

    let next = atom
    for (const [branch, child] of childRows(atom)) {
      const tidied = tidyRow(child, [...path, { atom: index, branch }], cursor, removed)
      if (tidied !== child) next = setChildRow(next, branch, tidied)
    }
    if (next !== atom) changed = true
    return [next]
  })

  if (gone.length) removed.set(here, gone)
  return gone.length || changed ? kept : row
}

// A cursor with the removed atoms taken out of its path and offset; null if
// it was inside one of them.
function shifted(cursor: Cursor, removed: Map<string, number[]>): Cursor | null {
  const path: RowPath = []
  const before = (list: number[] | undefined, index: number) =>
    (list ?? []).filter((i) => i < index).length

  for (let depth = 0; depth < cursor.path.length; depth++) {
    const list = removed.get(key(cursor.path.slice(0, depth)))
    const segment = cursor.path[depth]
    if (list?.includes(segment.atom)) return null
    path.push({ ...segment, atom: segment.atom - before(list, segment.atom) })
  }

  const list = removed.get(key(cursor.path))
  return { path, offset: cursor.offset - before(list, cursor.offset) }
}
