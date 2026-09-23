import katex from 'katex'
import { describe, expect, it } from 'vitest'

import { deserializeAtoms, rowToLatexSource, serializeAtoms } from '../src/editor/clipboard'
import { type EditorState, deleteBackward, namedCommand } from '../src/editor/commands'
import {
  type Cursor,
  allPositions,
  cursorAtStart,
  describeCursor,
  moveDown,
  moveRight,
  moveUp,
} from '../src/editor/cursor'
import {
  type Atom,
  type PiecewiseAtom,
  type Row,
  childRows,
  getRow,
  piecewise,
  piecewiseBranch,
  row,
  setChildRow,
} from '../src/editor/layout'
import {
  KATEX_EDITOR_OPTIONS,
  decodeRowPath,
  encodeRowPath,
  rowToLatex,
} from '../src/renderers/layoutLatex'
import { press, show, type } from './editorHelpers'

// y = { a : t<1; b : t≥1 ∧ t<2; 0.0 }
const sampleTree = () =>
  row(
    'y=',
    piecewise(
      [
        [row('a'), row('t<1')],
        [row('b'), row('t≥1')],
      ],
      row('0.0'),
    ),
  )

const at = (path: string, offset: number): Cursor => ({ path: decodeRowPath(path)!, offset })
const describe_ = (cursor: Cursor | null) => (cursor ? describeCursor(cursor) : null)

describe('the piecewise atom', () => {
  it('has rows value0, cond0, value1, cond1, …, otherwise, in reading order', () => {
    const atom = sampleTree()[2]
    expect(childRows(atom).map(([name]) => name)).toEqual([
      'value0',
      'cond0',
      'value1',
      'cond1',
      'otherwise',
    ])
    expect(childRows(piecewise()).map(([name]) => name)).toEqual(['value0', 'cond0'])
  })

  it('splits branch names', () => {
    expect(piecewiseBranch('cond12')).toEqual({ part: 'cond', piece: 12 })
    expect(piecewiseBranch('value0')).toEqual({ part: 'value', piece: 0 })
    expect(piecewiseBranch('otherwise')).toEqual({ part: 'otherwise' })
    expect(piecewiseBranch('num')).toBeNull()
  })

  it('replaces one row at a time', () => {
    const atom = sampleTree()[2] as PiecewiseAtom
    const next = setChildRow(atom, 'cond1', row('t>5'))
    expect(next.pieces[1].condition.map((a) => (a as { value: string }).value)).toEqual([
      't',
      '>',
      '5',
    ])
    expect(next.pieces[0]).toBe(atom.pieces[0])
    expect(setChildRow(atom, 'otherwise', []).otherwise).toEqual([])
    expect(atom.otherwise).toHaveLength(3)
  })

  it('round-trips indexed row paths', () => {
    const path = [
      { atom: 2, branch: 'cond1' as const },
      { atom: 0, branch: 'num' as const },
    ]
    expect(encodeRowPath(path)).toBe('r/2.cond1/0.num')
    expect(decodeRowPath('r/2.cond1/0.num')).toEqual(path)
    expect(getRow(sampleTree(), decodeRowPath('r/2.value1')!)).toHaveLength(1)
  })
})

describe('moving through a piecewise', () => {
  it('→ visits each value then its condition, then otherwise', () => {
    const stops = allPositions(sampleTree()).map(describeCursor)
    expect(stops).toEqual([
      'root @ 0',
      'root @ 1',
      'root @ 2',
      '2.value0 @ 0',
      '2.value0 @ 1',
      '2.cond0 @ 0',
      '2.cond0 @ 1',
      '2.cond0 @ 2',
      '2.cond0 @ 3',
      '2.value1 @ 0',
      '2.value1 @ 1',
      '2.cond1 @ 0',
      '2.cond1 @ 1',
      '2.cond1 @ 2',
      '2.cond1 @ 3',
      '2.otherwise @ 0',
      '2.otherwise @ 1',
      '2.otherwise @ 2',
      '2.otherwise @ 3',
      'root @ 3',
    ])
    expect(describe_(moveRight(sampleTree(), at('r/2.value0', 1)))).toBe('2.cond0 @ 0')
  })

  it('↑/↓ move between pieces in the same column', () => {
    const tree = sampleTree()
    expect(describe_(moveDown(tree, at('r/2.value0', 1)))).toBe('2.value1 @ 1')
    expect(describe_(moveDown(tree, at('r/2.value1', 0)))).toBe('2.otherwise @ 0')
    expect(describe_(moveDown(tree, at('r/2.cond0', 2)))).toBe('2.cond1 @ 2')
    expect(describe_(moveUp(tree, at('r/2.cond1', 3)))).toBe('2.cond0 @ 3')
    expect(describe_(moveUp(tree, at('r/2.otherwise', 2)))).toBe('2.value1 @ 1')
    expect(moveUp(tree, at('r/2.value0', 0))).toBeNull()
    expect(moveDown(tree, at('r/2.otherwise', 0))).toBeNull()
  })

  it('from the last condition ↓ goes to otherwise, the only row below it', () => {
    expect(describe_(moveDown(sampleTree(), at('r/2.cond1', 1)))).toBe('2.otherwise @ 1')
  })

  it('without otherwise, the last piece has nothing below it', () => {
    const tree = row(piecewise([[row('a'), row('b')]]))
    expect(moveDown(tree, at('r/0.value0', 0))).toBeNull()
    expect(moveDown(tree, at('r/0.cond0', 0))).toBeNull()
  })
})

describe('inserting a piecewise', () => {
  it('\\cases inserts one piece and otherwise 0.0, with the cursor in the value', () => {
    const inserted = namedCommand('cases')(type('y='))
    expect(show(inserted)).toBe('y={‸ : ; 0.0}')
    expect(describeCursor(inserted.cursor)).toBe('2.value0 @ 0')
  })

  it('typing goes into the value, → moves to the condition', () => {
    const state = press(namedCommand('piecewise')(type('y=')), '1', 'ArrowRight', 't<1')
    expect(show(state)).toBe('y={1 : t<1‸; 0.0}')
  })

  it('wraps a selection as the first value, then goes to its condition', () => {
    const selected = press(type('y=a+b'), 'Shift+ArrowLeft', 'Shift+ArrowLeft', 'Shift+ArrowLeft')
    const state = namedCommand('cases')(selected)
    expect(show(state)).toBe('y={a+b : ‸; 0.0}')
  })

  it('Backspace at the start steps out before it rather than dissolving it', () => {
    const inside: EditorState = { root: sampleTree(), cursor: at('r/2.value0', 0) }
    const next = deleteBackward(inside)
    expect(next.root).toBe(inside.root)
    expect(describeCursor(next.cursor)).toBe('root @ 2')
  })
})

describe('rendering a piecewise', () => {
  it('is a cases environment with every row tagged once, and KaTeX accepts it', () => {
    const tree = sampleTree()
    const latex = rowToLatex(tree, { activeRow: [] })
    expect(latex).toContain('\\begin{cases}')
    expect(latex).toContain('\\text{otherwise}')
    for (const cursor of allPositions(tree)) {
      expect(latex).toContain(`{row=${encodeRowPath(cursor.path)}}`)
    }
    expect(() =>
      katex.renderToString(latex, { ...KATEX_EDITOR_OPTIONS, throwOnError: true }),
    ).not.toThrow()
  })

  it('draws empty rows as placeholders', () => {
    const latex = rowToLatex(row(piecewise()), { activeRow: [] })
    expect(latex.match(/me-ph/g)).toHaveLength(2)
  })
})

describe('copying a piecewise', () => {
  it('round-trips through the editor clipboard format with fresh ids', () => {
    const tree = sampleTree()
    const copy = deserializeAtoms(serializeAtoms(tree))!
    expect(show({ root: copy, cursor: cursorAtStart() })).toBe(
      show({ root: tree, cursor: cursorAtStart() }),
    )
    const ids = (atoms: Row): string[] =>
      atoms.flatMap((a: Atom) => [a.id, ...childRows(a).flatMap(([, r]) => ids(r))])
    expect(ids(copy).some((id) => ids(tree).includes(id))).toBe(false)
  })

  it('rejects a malformed piecewise', () => {
    const bad = JSON.stringify({ version: 1, atoms: [{ kind: 'piecewise', id: 'x', pieces: [] }] })
    expect(deserializeAtoms(bad)).toBeNull()
  })

  it('copies as LaTeX cases', () => {
    expect(rowToLatexSource(sampleTree())).toBe(
      'y=\\begin{cases}a & t<1 \\\\ b & t\\geq 1 \\\\ 0.0 & \\text{otherwise}\\end{cases}',
    )
  })
})
