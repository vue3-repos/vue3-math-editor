// Selection: an anchor plus the cursor (see docs/design.md).
//
// The anchor and cursor can be in different rows (e.g. a drag that starts in
// a numerator and ends outside the fraction). The selection is always a range
// of whole atoms in one row: the innermost row that contains both ends. An
// end that lies inside an atom of that row takes the whole atom, so dragging
// from a numerator out into the main row selects the whole fraction.
//
// All functions are pure and take/return the editor state shape
// { root, cursor, anchor }.

import { isUnits } from './numberUnits'
import {
  type Cursor,
  cursorAtEnd,
  cursorAtStart,
  cursorsEqual,
  moveDown,
  moveLeft,
  moveRight,
  moveUp,
  type PickOffset,
} from './cursor'
import { type Row, type RowPath, getRow } from './layout'

export interface SelectableState {
  root: Row
  cursor: Cursor
  // Where the selection started; null or absent when nothing is selected.
  anchor?: Cursor | null
}

// A non-empty range [start, end) of atoms in the row at `path`.
export interface Selection {
  path: RowPath
  start: number
  end: number
}

export function selectionOf(state: SelectableState): Selection | null {
  const { anchor, cursor } = state
  if (!anchor || cursorsEqual(anchor, cursor)) return null

  // Depth of the innermost row containing both ends: the longest common
  // prefix of their paths (same atom *and* same branch).
  let depth = 0
  while (
    depth < anchor.path.length &&
    depth < cursor.path.length &&
    anchor.path[depth].atom === cursor.path[depth].atom &&
    anchor.path[depth].branch === cursor.path[depth].branch
  ) {
    depth++
  }

  const path = cursor.path.slice(0, depth)

  // The part of the row an end covers: a gap covers nothing ([k, k]); a
  // position inside atom i covers that atom ([i, i + 1]).
  const cover = (end: Cursor): [number, number] =>
    end.path.length === depth
      ? [end.offset, end.offset]
      : [end.path[depth].atom, end.path[depth].atom + 1]

  const [a0, a1] = cover(anchor)
  const [c0, c1] = cover(cursor)
  const start = Math.min(a0, c0)
  const end = Math.max(a1, c1)

  return start < end ? { path, start, end } : null
}

// The selected atoms, or [] when nothing is selected.
export function selectedAtoms(state: SelectableState): Row {
  const selection = selectionOf(state)
  if (!selection) return []
  return getRow(state.root, selection.path)!.slice(selection.start, selection.end)
}

// Human-readable form, e.g. "root 1–3" or "0.num 0–2" (shown in the workbench,
// asserted on by the e2e tests).
export function describeSelection(selection: Selection): string {
  const path = selection.path.map((s) => `${s.atom}.${s.branch}`).join(' › ')
  return `${path || 'root'} ${selection.start}–${selection.end}`
}

function withCursor<S extends SelectableState>(state: S, cursor: Cursor, anchor: Cursor | null): S {
  const next = { ...state, cursor, anchor }
  // Drop an anchor that selects nothing, so "is anything selected" is simply
  // "is there an anchor".
  return selectionOf(next) ? next : { ...state, cursor, anchor: null }
}

// ---------------------------------------------------------------------------
// Extending (Shift+arrows, Shift+Home/End, select all)
// ---------------------------------------------------------------------------

// Shift+← / Shift+→: move the cursor one whole atom along its row (a fraction
// or root is taken in one step, never entered); at the end of a row, take the
// whole enclosing structure.
export function extendSelection<S extends SelectableState>(
  state: S,
  direction: 'forward' | 'backward',
): S {
  const anchor = state.anchor ?? state.cursor
  const { path, offset } = state.cursor
  const row = getRow(state.root, path)!
  let cursor: Cursor

  if (direction === 'forward' ? offset < row.length : offset > 0) {
    // A number's hidden units go with the atom before them.
    const step = direction === 'forward' ? 1 : -1
    let next = offset + step
    if (direction === 'backward' && isUnits(row[offset - 1])) next = Math.max(0, offset - 2)
    if (direction === 'forward' && isUnits(row[next])) next++
    cursor = { path, offset: next }
  } else if (path.length > 0) {
    const owner = path[path.length - 1]
    cursor = {
      path: path.slice(0, -1),
      offset: direction === 'forward' ? owner.atom + 1 : owner.atom,
    }
  } else {
    return state
  }

  return withCursor(state, cursor, anchor)
}

// Shift+Home / Shift+End.
export function extendSelectionTo<S extends SelectableState>(state: S, edge: 'start' | 'end'): S {
  const anchor = state.anchor ?? state.cursor
  const cursor = edge === 'start' ? cursorAtStart() : cursorAtEnd(state.root)
  return withCursor(state, cursor, anchor)
}

// Ctrl/Cmd+A.
export function selectAll<S extends SelectableState>(state: S): S {
  return withCursor(state, cursorAtEnd(state.root), cursorAtStart())
}

// A selection made with the mouse: from where the drag started to where the
// pointer is now.
export function selectBetween<S extends SelectableState>(
  state: S,
  anchor: Cursor,
  cursor: Cursor,
): S {
  return withCursor(state, cursor, anchor)
}

// ---------------------------------------------------------------------------
// Collapsing
// ---------------------------------------------------------------------------

// Clear the selection, leaving the cursor at the selection's start or end
// (plain ←/→), or where it is (Escape, a click).
export function collapseSelection<S extends SelectableState>(
  state: S,
  to: 'start' | 'end' | 'cursor' = 'cursor',
): S {
  const selection = selectionOf(state)
  if (!selection || to === 'cursor') return { ...state, anchor: null }

  return {
    ...state,
    cursor: { path: selection.path, offset: to === 'start' ? selection.start : selection.end },
    anchor: null,
  }
}

// ---------------------------------------------------------------------------
// Plain navigation, selection-aware
// ---------------------------------------------------------------------------

// ←/→ collapse a selection to its start/end; otherwise move one step. Returns
// null when there is nowhere to go (the caller leaves the state alone).
export function navigateHorizontal<S extends SelectableState>(
  state: S,
  direction: 'forward' | 'backward',
): S | null {
  if (selectionOf(state)) {
    return collapseSelection(state, direction === 'forward' ? 'end' : 'start')
  }

  const move = direction === 'forward' ? moveRight : moveLeft
  const cursor = move(state.root, state.cursor)
  return cursor ? { ...state, cursor, anchor: null } : null
}

// ↑/↓ drop any selection and move between stacked rows. Returns null when
// there is no row above/below (the caller may move to another line).
export function navigateVertical<S extends SelectableState>(
  state: S,
  direction: 'up' | 'down',
  pickOffset?: PickOffset,
): S | null {
  const move = direction === 'up' ? moveUp : moveDown
  const cursor = move(state.root, state.cursor, pickOffset)
  return cursor ? { ...state, cursor, anchor: null } : null
}
