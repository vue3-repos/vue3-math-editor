import { describe, expect, it } from 'vitest'

import {
  type EditorState,
  insertAbs,
  insertDerivative,
  insertFunction,
  insertNthRoot,
  insertSquareRoot,
  namedCommand,
} from '../src/editor/commands'
import { type Cursor, allPositions } from '../src/editor/cursor'
import { fraction, row } from '../src/editor/layout'
import {
  describeSelection,
  selectBetween,
  selectedAtoms,
  selectionOf,
} from '../src/editor/selection'
import { json, press, show, type } from './editorHelpers'

// "x+" then Shift+← twice from the end: selects the last two atoms.
const selectLast = (state: EditorState, count: number) =>
  press(state, ...Array(count).fill('Shift+ArrowLeft'))

describe('what is selected', () => {
  it('is nothing without an anchor, or when the anchor is the cursor', () => {
    const state = type('x+1')
    expect(selectionOf(state)).toBeNull()
    expect(selectionOf({ ...state, anchor: state.cursor })).toBeNull()
  })

  it('is the atoms between anchor and cursor in the same row, either way round', () => {
    const tree = row('a+b+c')
    const at = (offset: number): Cursor => ({ path: [], offset })
    const forward = { root: tree, anchor: at(1), cursor: at(4) }
    const backward = { root: tree, anchor: at(4), cursor: at(1) }
    expect(selectionOf(forward)).toEqual({ path: [], start: 1, end: 4 })
    expect(selectionOf(backward)).toEqual({ path: [], start: 1, end: 4 })
    expect(show({ ...forward })).toBe('a«+b+»c')
  })

  it('widens to the whole structure when the ends are in different rows', () => {
    // x + [1/2]: anchor in the numerator, cursor in the denominator.
    const tree = row('x+', fraction(row('1'), row('2')))
    const state = {
      root: tree,
      anchor: { path: [{ atom: 2, branch: 'num' as const }], offset: 0 },
      cursor: { path: [{ atom: 2, branch: 'den' as const }], offset: 1 },
    }
    expect(selectionOf(state)).toEqual({ path: [], start: 2, end: 3 })
  })

  it('takes a whole structure when one end is outside it', () => {
    const tree = row('x+', fraction(row('1'), row('2')))
    const state = {
      root: tree,
      anchor: { path: [], offset: 0 },
      cursor: { path: [{ atom: 2, branch: 'num' as const }], offset: 1 },
    }
    expect(show(state)).toBe('«x+[1/2]»')
  })

  it('is always a valid range for any pair of positions', () => {
    const tree = type('sin(x)^2 +1/(x+1', ' ', ' ', '=|y|').root
    const positions = allPositions(tree)

    for (const anchor of positions) {
      for (const cursor of positions) {
        const selection = selectionOf({ root: tree, anchor, cursor })
        if (!selection) continue
        expect(selection.start).toBeLessThan(selection.end)
        expect(selectedAtoms({ root: tree, anchor, cursor }).length).toBe(
          selection.end - selection.start,
        )
      }
    }
  })

  it('has a readable description', () => {
    const state = selectLast(type('a+b'), 2)
    expect(describeSelection(selectionOf(state)!)).toBe('root 1–3')
  })
})

describe('Shift+arrows', () => {
  it('extend one atom at a time', () => {
    let state = type('a+b')
    state = press(state, 'Shift+ArrowLeft')
    expect(show(state)).toBe('a+«b»')
    state = press(state, 'Shift+ArrowLeft')
    expect(show(state)).toBe('a«+b»')
  })

  it('take a fraction whole instead of entering it', () => {
    const state = press(type('x+1/2', ' '), 'Shift+ArrowLeft')
    expect(show(state)).toBe('x+«[1/2]»')
  })

  it('from inside a structure, grow to take the whole structure', () => {
    // Cursor at the end of the denominator.
    const state = press(type('x+1/23'), 'Shift+ArrowLeft', 'Shift+ArrowLeft')
    expect(show(state)).toBe('x+[1/«23»]')
    expect(show(press(state, 'Shift+ArrowLeft'))).toBe('x+«[1/23]»')
  })

  it('shrink back, and clear the selection when it becomes empty', () => {
    const state = press(type('a+b'), 'Shift+ArrowLeft', 'Shift+ArrowLeft', 'Shift+ArrowRight')
    expect(show(state)).toBe('a+«b»')
    const cleared = press(state, 'Shift+ArrowRight')
    expect(show(cleared)).toBe('a+b‸')
    expect(cleared.anchor).toBeNull()
  })

  it('Shift+Home / Shift+End and select all', () => {
    expect(show(press(type('a+b'), 'ArrowLeft', 'Shift+Home'))).toBe('«a+»b')
    expect(show(press(type('a+b'), 'ArrowLeft', 'ArrowLeft', 'Shift+End'))).toBe('a«+b»')
    expect(show(press(type('1/x', ' ', '+y'), 'SelectAll'))).toBe('«[1/x]+y»')
  })

  it('plain arrows collapse to the start or end of the selection, Escape where the cursor is', () => {
    const selected = selectLast(type('a+b+c'), 3)
    expect(show(selected)).toBe('a+«b+c»')
    expect(show(press(selected, 'ArrowLeft'))).toBe('a+‸b+c')
    expect(show(press(selected, 'ArrowRight'))).toBe('a+b+c‸')
    expect(show(press(selected, 'Escape'))).toBe('a+‸b+c')
  })
})

describe('typing and deleting with a selection', () => {
  it('typing replaces the selection', () => {
    const state = press(selectLast(type('a+b+c'), 3), 'x')
    expect(show(state)).toBe('a+x‸')
  })

  it('Backspace and Delete remove the selection', () => {
    expect(show(press(selectLast(type('a+b+c'), 2), 'Backspace'))).toBe('a+b‸')
    expect(show(press(selectLast(type('a+b+c'), 2), 'Delete'))).toBe('a+b‸')
  })

  it('Space collapses to the end of the selection', () => {
    expect(show(press(selectLast(type('a+b'), 1), ' '))).toBe('a+b‸')
  })

  it(') collapses the selection and leaves the group', () => {
    expect(show(press(type('(a+b'), 'Shift+ArrowLeft', ')'))).toBe('(a+b)‸')
  })
})

describe('wrapping the selection', () => {
  const selected = () => selectLast(type('y=a+b'), 3) // y=«a+b»

  it('/ makes it the numerator', () => {
    const state = press(selected(), '/')
    expect(show(state)).toBe('y=[a+b/‸]')
    expect(json(press(state, '2'))).toEqual(['Equal', 'y', ['Divide', ['Add', 'a', 'b'], 2]])
  })

  it('/ on a bracketed selection drops the brackets', () => {
    expect(show(press(type('(a+b)'), 'Shift+ArrowLeft', '/'))).toBe('[a+b/‸]')
  })

  it('\\frac does the same as /', () => {
    expect(show(namedCommand('frac')(selected()))).toBe('y=[a+b/‸]')
  })

  it('( and | bracket it', () => {
    expect(show(press(selected(), '('))).toBe('y=(a+b)‸')
    expect(show(press(selected(), '|'))).toBe('y=|a+b|‸')
    expect(show(insertAbs(selected()))).toBe('y=|a+b|‸')
  })

  it('^ gives one atom an exponent, and brackets several first', () => {
    expect(show(press(type('ab'), 'ArrowLeft', 'Shift+ArrowLeft', '^'))).toBe('a^{‸}b')
    const state = press(selected(), '^')
    expect(show(state)).toBe('y=(a+b)^{‸}')
    expect(json(press(state, '2'))).toEqual(['Equal', 'y', ['Power', ['Add', 'a', 'b'], 2]])
  })

  it('\\sqrt makes it the radicand, cursor after the root', () => {
    expect(show(insertSquareRoot(selected()))).toBe('y=√{a+b}‸')
    expect(show(namedCommand('sqrt')(selected()))).toBe('y=√{a+b}‸')
  })

  it('\\root makes it the radicand, cursor in the index', () => {
    expect(show(insertNthRoot(selected()))).toBe('y=√[‸]{a+b}')
  })

  it('a function takes it as the argument', () => {
    const state = insertFunction('sin')(selected())
    expect(show(state)).toBe('y=sin(a+b)‸')
    expect(json(state)).toEqual(['Equal', 'y', ['Sin', ['Add', 'a', 'b']]])
    expect(show(namedCommand('cos')(selected()))).toBe('y=cos(a+b)‸')
  })

  it('\\dd makes it the expression, cursor in the variable', () => {
    expect(show(insertDerivative(selected()))).toBe('y=d{a+b}/d{‸}')
  })

  it('wraps a selection inside a structure, in place', () => {
    // Select "x+1" in the denominator of 1/(x+1).
    const state = selectLast(type('1/x+1'), 3)
    expect(show(state)).toBe('[1/«x+1»]')
    expect(show(insertSquareRoot(state))).toBe('[1/√{x+1}‸]')
  })

  it('commands never mutate the state they are given', () => {
    const state = selected()
    const frozen = JSON.stringify(state)
    for (const key of ['/', '^', '(', '|', 'x', 'Backspace', 'Delete', ' ', ')']) {
      press(state, key)
    }
    insertSquareRoot(state)
    insertFunction('sin')(state)
    expect(JSON.stringify(state)).toBe(frozen)
  })
})

describe('mouse selection', () => {
  it('selects between the drag start and the pointer', () => {
    const state = type('a+b+c')
    const dragged = selectBetween(state, { path: [], offset: 4 }, { path: [], offset: 1 })
    expect(show(dragged)).toBe('a«+b+»c')
    expect(selectBetween(state, { path: [], offset: 2 }, { path: [], offset: 2 }).anchor).toBeNull()
  })
})
