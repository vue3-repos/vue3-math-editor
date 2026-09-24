// Cursor positions and movement over the layout tree (see layout.ts).
//
// A cursor is a gap in a row: `offset` k means "between atom k-1 and atom
// k", so a row of n atoms has positions 0..n and an empty row has exactly
// one. The end of the equation is simply { path: [], offset: root.length }.
//
// Horizontal movement follows one fixed traversal order, the same order
// `allPositions` enumerates:
//
//   → : if the atom after the cursor has child rows, enter its first child
//       row at offset 0; otherwise step over it. At the end of a row, go to
//       the start of the parent structure's next child row, or, after its
//       last one, exit to the gap just after the structure.
//   ← : the exact mirror.
//
// So pressing → from the start visits every position exactly once and ends
// at the end of the equation, and ← retraces the same sequence backwards.
//
// A number's units (a units atom) are hidden (see numberUnits.ts), so they
// are stepped over as one: neither their row nor the gap just before them is
// a position. → from the end of 5 goes past its units; ← from after them goes
// to before the 5's last digit. Once in them (with `{`), their row is moved
// through as any other, and leaving it either way lands after them.
// All functions are pure: they never mutate the tree or the cursor.

import {
  type Atom,
  type BranchName,
  type Row,
  type RowPath,
  childRows,
  getRow,
  piecewiseBranch,
  rowPathsEqual,
} from './layout'
import { isUnits, settleCursor } from './numberUnits'

export interface Cursor {
  path: RowPath
  offset: number
}

export function cursorAtStart(): Cursor {
  return { path: [], offset: 0 }
}

export function cursorAtEnd(root: Row): Cursor {
  return { path: [], offset: root.length }
}

export function cursorsEqual(a: Cursor, b: Cursor): boolean {
  return a.offset === b.offset && rowPathsEqual(a.path, b.path)
}

// Human-readable form of a cursor, e.g. "0.num › 0.den @ 1" (shown in the
// workbench, and asserted on by the e2e tests).
export function describeCursor(cursor: Cursor): string {
  const path = cursor.path.map((s) => `${s.atom}.${s.branch}`).join(' › ')
  return `${path || 'root'} @ ${cursor.offset}`
}

export function isValidCursor(root: Row, cursor: Cursor): boolean {
  const row = getRow(root, cursor.path)
  return (
    row !== null &&
    Number.isInteger(cursor.offset) &&
    cursor.offset >= 0 &&
    cursor.offset <= row.length
  )
}

// Every cursor position in traversal order. Written independently of
// moveLeft/moveRight so tests can use it as an oracle for them.
export function allPositions(root: Row): Cursor[] {
  const output: Cursor[] = []

  const visit = (row: Row, path: RowPath) => {
    for (let offset = 0; offset <= row.length; offset++) {
      if (isUnits(row[offset])) continue
      output.push({ path, offset })

      if (offset < row.length) {
        for (const [branch, child] of childRows(row[offset])) {
          visit(child, [...path, { atom: offset, branch }])
        }
      }
    }
  }

  visit(root, [])
  return output
}

// ---------------------------------------------------------------------------
// Horizontal movement
// ---------------------------------------------------------------------------

interface Parent {
  // Path of the row containing the structure atom.
  rowPath: RowPath
  row: Row
  atomIndex: number
  atom: Atom
  branch: BranchName
}

function parentOf(root: Row, path: RowPath): Parent | null {
  if (path.length === 0) {
    return null
  }

  const rowPath = path.slice(0, -1)
  const row = getRow(root, rowPath)
  const { atom: atomIndex, branch } = path[path.length - 1]

  if (!row || !row[atomIndex]) {
    throw new Error('Cursor path does not resolve')
  }

  return { rowPath, row, atomIndex, atom: row[atomIndex], branch }
}

function requireRow(root: Row, path: RowPath): Row {
  const row = getRow(root, path)

  if (!row) {
    throw new Error('Cursor path does not resolve')
  }

  return row
}

// One step right, or null at the end of the equation (the caller keeps the
// cursor where it is).
export function moveRight(root: Row, cursor: Cursor): Cursor | null {
  const row = requireRow(root, cursor.path)

  if (cursor.offset < row.length) {
    const atom = row[cursor.offset]
    const children = isUnits(atom) ? [] : childRows(atom)

    if (children.length > 0) {
      return { path: [...cursor.path, { atom: cursor.offset, branch: children[0][0] }], offset: 0 }
    }

    // Past the atom, and past the units after it.
    const offset = cursor.offset + (isUnits(row[cursor.offset + 1]) ? 2 : 1)
    return { path: cursor.path, offset }
  }

  const parent = parentOf(root, cursor.path)

  if (!parent) {
    return null
  }

  const siblings = childRows(parent.atom)
  const index = siblings.findIndex(([name]) => name === parent.branch)
  const next = siblings[index + 1]

  if (next) {
    return { path: [...parent.rowPath, { atom: parent.atomIndex, branch: next[0] }], offset: 0 }
  }

  return { path: parent.rowPath, offset: parent.atomIndex + 1 }
}

// One step left, or null at the start of the equation.
export function moveLeft(root: Row, cursor: Cursor): Cursor | null {
  const row = requireRow(root, cursor.path)

  if (cursor.offset > 0) {
    const atomIndex = cursor.offset - 1
    // Over the units, and on over the atom before them.
    if (isUnits(row[atomIndex])) return moveLeft(root, { path: cursor.path, offset: atomIndex })
    const children = childRows(row[atomIndex])

    if (children.length > 0) {
      const [branch, child] = children[children.length - 1]
      return { path: [...cursor.path, { atom: atomIndex, branch }], offset: child.length }
    }

    return { path: cursor.path, offset: atomIndex }
  }

  const parent = parentOf(root, cursor.path)

  if (!parent) {
    return null
  }

  const siblings = childRows(parent.atom)
  const index = siblings.findIndex(([name]) => name === parent.branch)
  const previous = siblings[index - 1]

  if (previous) {
    const [branch, child] = previous
    return { path: [...parent.rowPath, { atom: parent.atomIndex, branch }], offset: child.length }
  }

  // Out of a number's units: after them (the gap before them isn't a position).
  if (isUnits(parent.atom)) return { path: parent.rowPath, offset: parent.atomIndex + 1 }

  return { path: parent.rowPath, offset: parent.atomIndex }
}

// ---------------------------------------------------------------------------
// Vertical movement
// ---------------------------------------------------------------------------

// Child rows stacked vertically within one structure, top to bottom. A
// superscript has a single row and no vertical partner; leaving it is done
// with ← / →.
const VERTICAL_STACKS: Partial<Record<Atom['kind'], BranchName[]>> = {
  fraction: ['num', 'den'],
  derivative: ['expr', 'variable'],
  root: ['index', 'body'],
}

// The stack of rows `branch` belongs to, top to bottom. A piecewise has two
// columns: the values (with otherwise at the bottom) and the conditions,
// whose last one goes down to otherwise too, the only row below it.
function verticalStack(atom: Atom, branch: BranchName): BranchName[] | null {
  if (atom.kind !== 'piecewise') return VERTICAL_STACKS[atom.kind] ?? null

  const where = piecewiseBranch(branch)
  if (!where) return null
  const part = where.part === 'otherwise' ? 'value' : where.part
  const column = atom.pieces.map((_, i): BranchName => `${part}${i}`)

  return atom.otherwise ? [...column, 'otherwise'] : column
}

// Chooses the offset to land on in the target row. The default keeps the
// same offset, clamped to the row. The renderer can pass one that matches
// the caret's x coordinate instead.
export type PickOffset = (target: Row, targetPath: RowPath, from: Cursor) => number

const clampOffset: PickOffset = (target, _path, from) => Math.min(from.offset, target.length)

function moveVertical(
  root: Row,
  cursor: Cursor,
  direction: 1 | -1,
  pickOffset: PickOffset,
): Cursor | null {
  // Walk outwards from the innermost row until a structure has a row above
  // (or below) the one the cursor is in, e.g. from a denominator nested in a
  // numerator, ↓ goes to the outer denominator.
  for (let depth = cursor.path.length; depth > 0; depth--) {
    const parent = parentOf(root, cursor.path.slice(0, depth))!
    const stack = verticalStack(parent.atom, parent.branch)

    if (!stack) {
      continue
    }

    const available = childRows(parent.atom).map(([name]) => name)
    const present = stack.filter((name) => available.includes(name))
    const index = present.indexOf(parent.branch)
    const targetBranch = present[index + direction]

    if (index < 0 || !targetBranch) {
      continue
    }

    const targetPath = [...parent.rowPath, { atom: parent.atomIndex, branch: targetBranch }]
    const target = requireRow(root, targetPath)
    const offset = Math.max(0, Math.min(target.length, pickOffset(target, targetPath, cursor)))

    return settleCursor(root, { path: targetPath, offset })
  }

  return null
}

// Move to the row above within the nearest enclosing vertical structure, or
// null if there is none (the caller may then move to the previous equation).
export function moveUp(
  root: Row,
  cursor: Cursor,
  pickOffset: PickOffset = clampOffset,
): Cursor | null {
  return moveVertical(root, cursor, -1, pickOffset)
}

export function moveDown(
  root: Row,
  cursor: Cursor,
  pickOffset: PickOffset = clampOffset,
): Cursor | null {
  return moveVertical(root, cursor, 1, pickOffset)
}
