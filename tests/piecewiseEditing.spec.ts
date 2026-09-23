import { describe, expect, it } from 'vitest'

import { latexToRow, rowToLatexSource } from '../src/editor/clipboard'
import { type EditorState, namedCommand } from '../src/editor/commands'
import { describeCursor } from '../src/editor/cursor'
import { contentMathML } from '../src/editor/exports'
import { piecewise, row } from '../src/editor/layout'
import { parseRow } from '../src/editor/parse'
import { selectionOf } from '../src/editor/selection'
import { decodeRowPath } from '../src/renderers/layoutLatex'
import { json, press, show, type } from './editorHelpers'

// y = { … } typed with \cases: one empty piece, otherwise 0.0.
const started = () => namedCommand('cases')(type('y='))
const where = (state: EditorState) => describeCursor(state.cursor)
const inRow = (state: EditorState, path: string, offset: number): EditorState => ({
  root: state.root,
  cursor: { path: decodeRowPath(path)!, offset },
})
const jsonOf = (root: ReturnType<typeof row>) => json({ root, cursor: { path: [], offset: 0 } })

describe('adding pieces with Enter', () => {
  it('adds an empty piece below the current one, with the cursor in its value', () => {
    const state = press(started(), 'a', 'ArrowRight', 't<1', 'Enter')
    expect(show(state)).toBe('y={a : t<1; ‸ : ; 0.0}')
    expect(where(state)).toBe('2.value1 @ 0')
  })

  it('from a value, the new piece still goes below', () => {
    const state = press(started(), 'a', 'Enter', 'b')
    expect(show(state)).toBe('y={a : ; b‸ : ; 0.0}')
  })

  it('between pieces, it inserts in the middle', () => {
    let state = press(started(), 'a', 'Enter', 'c')
    state = press(inRow(state, 'r/2.value0', 1), 'Enter', 'b')
    expect(show(state)).toBe('y={a : ; b‸ : ; c : ; 0.0}')
  })

  it('from otherwise, the new piece goes last, above otherwise', () => {
    const state = press(inRow(press(started(), 'a'), 'r/2.otherwise', 3), 'Enter', 'b')
    expect(show(state)).toBe('y={a : ; b‸ : ; 0.0}')
  })

  it('works from deep inside a piece', () => {
    const state = press(started(), '1/T', 'Enter')
    expect(show(state)).toBe('y={[1/T] : ; ‸ : ; 0.0}')
  })

  it('does nothing outside a piecewise (the workbench then adds a line)', () => {
    const state = type('x+1')
    expect(press(state, 'Enter')).toBe(state)
  })
})

describe('removing pieces', () => {
  it('Backspace in an empty piece removes it and goes to the end of the piece above', () => {
    const state = press(started(), 'a', 'ArrowRight', 't<1', 'Enter', 'Backspace')
    expect(show(state)).toBe('y={a : t<1‸; 0.0}')
  })

  it('Backspace in the value of a non-empty piece goes to the row before instead', () => {
    const state = press(started(), 'a', 'ArrowRight', 'c', 'Enter', 'b', 'ArrowLeft', 'Backspace')
    expect(show(state)).toBe('y={a : c‸; b : ; 0.0}')
  })

  it('never removes the only piece; Backspace then steps out', () => {
    const state = press(started(), 'Backspace')
    expect(show(state)).toBe('y=‸{ : ; 0.0}')
  })

  it('Delete in an empty piece removes it and goes to the start of what followed', () => {
    let state = press(started(), 'a', 'Enter', 'Enter', 'c')
    state = press(inRow(state, 'r/2.value1', 0), 'Delete')
    expect(show(state)).toBe('y={a : ; ‸c : ; 0.0}')
  })

  it('Backspace in an empty otherwise removes it', () => {
    let state = press(started(), 'a', 'ArrowRight', 'b')
    state = press(inRow(state, 'r/2.otherwise', 3), 'Backspace', 'Backspace', 'Backspace')
    expect(show(state)).toBe('y={a : b; ‸}')
    state = press(state, 'Backspace')
    expect(show(state)).toBe('y={a : b‸}')
  })

  it('Delete in an empty otherwise removes it and steps out after', () => {
    let state = press(
      inRow(press(started(), 'a'), 'r/2.otherwise', 0),
      'Delete',
      'Delete',
      'Delete',
    )
    state = press(state, 'Delete')
    expect(show(state)).toBe('y={a : }‸')
  })

  it('an entirely empty piecewise goes in one Backspace, like other structures', () => {
    let state = press(inRow(started(), 'r/2.otherwise', 3), 'Backspace', 'Backspace', 'Backspace')
    state = press(state, 'Backspace') // removes the empty otherwise
    expect(show(state)).toBe('y={ : ‸}')
    state = press(state, 'Backspace') // every row empty: the whole piecewise goes
    expect(show(state)).toBe('y=‸')
  })
})

describe('\\otherwise', () => {
  it('adds an otherwise of 0.0, selected so typing replaces it', () => {
    let state = press(started(), 'a', 'ArrowRight', 'b')
    state = press(
      inRow(state, 'r/2.otherwise', 3),
      'Backspace',
      'Backspace',
      'Backspace',
      'Backspace',
    )
    expect(show(state)).toBe('y={a : b‸}')

    state = namedCommand('otherwise')(state)
    expect(selectionOf(state)).toEqual({ path: decodeRowPath('r/2.otherwise'), start: 0, end: 3 })
    expect(show(press(state, '1'))).toBe('y={a : b; 1‸}')
  })

  it('moves to the existing otherwise', () => {
    const state = namedCommand('otherwise')(press(started(), 'a'))
    expect(where(state)).toBe('2.otherwise @ 3')
  })
})

describe('parsing and exporting', () => {
  const tree = () =>
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

  it('parses to a Piecewise node', () => {
    const { ast, diagnostics } = parseRow(tree())
    expect(diagnostics).toEqual([])
    expect(ast).toMatchObject({
      type: 'Equal',
      right: { type: 'Piecewise', pieces: [{ value: {}, condition: {} }, {}], otherwise: {} },
    })
  })

  it('is an expression like any other', () => {
    expect(jsonOf(row('2', piecewise([[row('a'), row('x<0')]]), '+1'))).toEqual([
      'Add',
      ['Multiply', 2, ['Which', ['Less', 'x', 0], 'a']],
      1,
    ])
  })

  it('MathJSON is Which, with True for otherwise', () => {
    expect(jsonOf(tree())).toEqual([
      'Equal',
      'y',
      ['Which', ['Less', 't', 1], 'a', ['GreaterEqual', 't', 1], 'b', 'True', 0],
    ])
  })

  it('Content MathML uses piecewise, piece and otherwise', () => {
    const mathml = contentMathML(tree())
    expect(mathml).toContain(
      [
        '  <piecewise>',
        '      <piece>',
        '        <ci>a</ci>',
        '        <apply>',
        '          <lt/>',
      ].join('\n'),
    )
    expect(mathml.match(/<piece>/g)).toHaveLength(2)
    expect(mathml).toMatch(/<otherwise>\s*<cn>0<\/cn>\s*<\/otherwise>/)
    expect(
      new DOMParser()
        .parseFromString(mathml, 'application/xml')
        .getElementsByTagName('parsererror'),
    ).toHaveLength(0)
  })

  it('an empty condition is a missing operand', () => {
    expect(jsonOf(row(piecewise([[row('a'), []]])))).toEqual(['Which', ['Missing'], 'a'])
  })
})

describe('pasting cases', () => {
  it('reads what copying writes', () => {
    const tree = row('y=', piecewise([[row('a'), row('t<1')]], row('0.0')))
    const back = latexToRow(rowToLatexSource(tree))
    expect(show({ root: back, cursor: { path: [], offset: back.length } })).toBe(
      'y={a : t<1; 0.0}‸',
    )
  })

  it('reads common LaTeX: \\text{if}, \\text{otherwise}, dcases, fractions', () => {
    const pasted = latexToRow(
      'f = \\begin{dcases} \\frac{1}{2} & \\text{if } x \\le 0 \\\\ x^2 & \\text{for } 0 < x \\\\ 1 & \\text{otherwise} \\end{dcases}',
    )
    expect(jsonOf(pasted)).toEqual([
      'Equal',
      'f',
      [
        'Which',
        ['LessEqual', 'x', 0],
        ['Divide', 1, 2],
        ['Less', 0, 'x'],
        ['Power', 'x', 2],
        'True',
        1,
      ],
    ])
  })

  it('without an otherwise line, has no otherwise; & stays a column separator', () => {
    const pasted = latexToRow('\\begin{cases} a & x>0 \\\\ b & x<0 \\end{cases} + c')
    expect(show({ root: pasted, cursor: { path: [], offset: pasted.length } })).toBe(
      '{a : x>0; b : x<0}+c‸',
    )
  })

  it('outside cases, & is still ∧', () => {
    expect(jsonOf(latexToRow('a & b'))).toEqual(['And', 'a', 'b'])
  })
})
