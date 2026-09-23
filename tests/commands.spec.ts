import { describe, expect, it } from 'vitest'

import {
  deleteBackward,
  emptyState,
  insertFraction,
  insertFunction,
  namedCommand,
} from '../src/editor/commands'
import { type Cursor, isValidCursor, moveRight } from '../src/editor/cursor'
import { commandForKey } from '../src/editor/keymap'
import { parseRow } from '../src/editor/parse'
import { json, press, show, type } from './editorHelpers'

// ---------------------------------------------------------------------------
// Typing
// ---------------------------------------------------------------------------

describe('typing symbols', () => {
  it('inserts at the cursor and moves past it', () => {
    const state = type('2x+1')
    expect(show(state)).toBe('2x+1‸')
    expect(json(state)).toEqual(['Add', ['Multiply', 2, 'x'], 1])
  })

  it('inserts in the middle of the equation', () => {
    const state = press(type('x+1'), 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', '2')
    expect(show(state)).toBe('2‸x+1')
  })

  it('stores * as a centred dot', () => {
    expect(show(type('3*4'))).toBe('3·4‸')
  })
})

describe('function names', () => {
  it('reads typed letters that spell a function as the function', () => {
    const state = type('sin(x)')
    expect(show(state)).toBe('sin(x)‸')
    expect(json(state)).toEqual(['Sin', 'x'])
  })

  it('never converts letters as they are typed, so longer names keep their spelling', () => {
    expect(json(type('cost'))).toEqual('cost')
    expect(json(type('Vm_init'))).toEqual('Vm_init')
    expect(json(type('xsin(t)'))).toEqual(['Multiply', 'xsin', 't'])
    expect(json(type('x*sin(t)'))).toEqual(['Multiply', 'x', ['Sin', 't']])
  })

  it('extends a function to a longer name', () => {
    expect(json(type('cosh(x)'))).toEqual(['Cosh', 'x'])
  })

  it('prefers the longest spelling', () => {
    expect(json(type('arcsin(x)'))).toEqual(['Arcsin', 'x'])
  })

  it('Backspace removes one letter of a typed name', () => {
    const state = press(type('sin'), 'Backspace')
    expect(show(state)).toBe('si‸')
    expect(json(state)).toEqual('si')
  })

  it('Backspace takes a function inserted by \\sin back to letters', () => {
    const state = press(namedCommand('sin')(emptyState()), 'ArrowLeft', 'Backspace')
    expect(show(state)).toBe('si‸()')
  })
})

describe('fractions', () => {
  it('takes the operand before the cursor as the numerator', () => {
    const state = type('2x/')
    expect(show(state)).toBe('[2x/‸]')
  })

  it('stops the numerator at the previous operator', () => {
    expect(show(type('y=x+1/'))).toBe('y=x+[1/‸]')
  })

  it('drops the brackets of a bracketed numerator', () => {
    expect(show(type('(x+1)/2'))).toBe('[x+1/2‸]')
    expect(json(type('(x+1)/2'))).toEqual(['Divide', ['Add', 'x', 1], 2])
  })

  it('starts in the numerator when there is nothing before the cursor', () => {
    expect(show(type('/'))).toBe('[‸/]')
    expect(show(type('x=/'))).toBe('x=[‸/]')
  })

  it('→ leaves the denominator so typing continues outside', () => {
    const state = type('1/x', 'ArrowRight', '+1')
    expect(show(state)).toBe('[1/x]+1‸')
    expect(json(state)).toEqual(['Add', ['Divide', 1, 'x'], 1])
  })
})

describe('superscripts', () => {
  it('opens a superscript and space leaves it', () => {
    const state = type('x^2', ' ', '+1')
    expect(show(state)).toBe('x^{2}+1‸')
    expect(json(state)).toEqual(['Add', ['Power', 'x', 2], 1])
  })

  it('re-enters an existing superscript instead of adding another', () => {
    expect(show(press(type('x^2', 'ArrowRight'), '^'))).toBe('x^{2‸}')
    expect(show(press(type('x^2', 'ArrowRight', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft'), '^'))).toBe(
      'x^{‸2}',
    )
  })

  it('applies to a bracket group', () => {
    expect(json(type('(x+1)^2'))).toEqual(['Power', ['Add', 'x', 1], 2])
  })
})

describe('brackets', () => {
  it('( opens a group with the cursor inside, ) leaves it', () => {
    expect(show(type('('))).toBe('(‸)')
    expect(show(type('(x)'))).toBe('(x)‸')
  })

  it(') typed mid-group moves the rest out of the group', () => {
    const state = press(type('(x+1'), 'ArrowLeft', 'ArrowLeft', ')')
    expect(show(state)).toBe('(x)‸+1')
  })

  it(') inside a nested structure just leaves the group', () => {
    expect(show(type('(1/x)'))).toBe('([1/x])‸')
  })

  it(') with no open group does nothing', () => {
    const before = type('x')
    expect(press(before, ')')).toBe(before)
  })

  it('| opens and closes an absolute value', () => {
    const state = type('|x|+1')
    expect(show(state)).toBe('|x|+1‸')
    expect(json(state)).toEqual(['Add', ['Abs', 'x'], 1])
  })

  it('a function followed by ( takes its argument', () => {
    expect(json(type('log(x,2)'))).toEqual(['Log', 'x', 2])
  })
})

describe('space', () => {
  it('steps out of the innermost structure', () => {
    expect(show(type('1/x', ' '))).toBe('[1/x]‸')
    expect(show(type('(1/x', ' '))).toBe('([1/x]‸)')
  })

  it('does nothing at the top level', () => {
    const before = type('x')
    expect(press(before, ' ')).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

describe('Backspace', () => {
  it('deletes the symbol before the cursor', () => {
    expect(show(type('12', 'Backspace'))).toBe('1‸')
  })

  it('does nothing at the start of the equation (same state)', () => {
    const empty = emptyState()
    expect(deleteBackward(empty)).toBe(empty)
    const start = press(type('x'), 'ArrowLeft')
    expect(deleteBackward(start)).toBe(start)
  })

  it('steps into a structure before deleting inside it', () => {
    expect(show(type('1/x', ' ', 'Backspace'))).toBe('[1/x‸]')
  })

  it('deletes an empty structure in one press', () => {
    expect(show(type('x+/', 'Backspace'))).toBe('x+‸')
    expect(show(type('x+(', 'Backspace'))).toBe('x+‸')
    expect(show(type('x^', 'Backspace'))).toBe('x‸')
  })

  it('from the start of a later row, moves to the end of the previous row', () => {
    expect(show(type('1/x', 'Backspace', 'Backspace'))).toBe('[1‸/]')
  })

  it('from the start of the first row, removes the structure but keeps the content', () => {
    expect(show(type('(x+1', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'Backspace'))).toBe('‸x+1')
    expect(show(type('x^2', 'ArrowLeft', 'Backspace'))).toBe('x‸2')
  })

  it('clears a whole fraction step by step', () => {
    let state = type('1/2')
    for (let i = 0; i < 4; i++) state = press(state, 'Backspace')
    expect(show(state)).toBe('‸')
    expect(state.root).toEqual([])
  })
})

describe('Delete', () => {
  it('deletes the symbol after the cursor', () => {
    expect(show(press(type('12'), 'ArrowLeft', 'ArrowLeft', 'Delete'))).toBe('‸2')
  })

  it('steps into a structure, then removes it from the end of its last row', () => {
    const start = press(
      type('1/x', ' '),
      'ArrowLeft',
      'ArrowLeft',
      'ArrowLeft',
      'ArrowLeft',
      'ArrowLeft',
    )
    expect(show(start)).toBe('‸[1/x]')
    const inside = press(start, 'Delete')
    expect(show(inside)).toBe('[‸1/x]')
    expect(show(press(type('(x', 'Delete')))).toBe('x‸')
  })

  it('takes a function inserted by \\sin back to letters from the front', () => {
    const state = press(namedCommand('sin')(emptyState()), 'ArrowLeft', 'ArrowLeft', 'Delete')
    expect(show(state)).toBe('‸in()')
  })
})

// ---------------------------------------------------------------------------
// Placeholders and named commands
// ---------------------------------------------------------------------------

describe('Tab', () => {
  it('jumps to the next empty row, wrapping around', () => {
    let state = type('/', 'ArrowRight', 'ArrowRight', '+/')
    expect(show(state)).toBe('[/]+[‸/]')
    state = press(state, 'Tab')
    expect(show(state)).toBe('[/]+[/‸]')
    state = press(state, 'Tab')
    expect(show(state)).toBe('[‸/]+[/]')
    state = press(state, 'Shift+Tab')
    expect(show(state)).toBe('[/]+[/‸]')
  })

  it('returns the same state when there is nowhere else to go', () => {
    const state = type('x+1')
    expect(press(state, 'Tab')).toBe(state)
  })
})

describe('named commands', () => {
  const run = (name: string, state = emptyState()) => namedCommand(name)(state)

  it('\\frac inserts an empty fraction', () => {
    expect(show(run('frac'))).toBe('[‸/]')
  })

  it('\\sqrt and \\root', () => {
    expect(show(run('sqrt'))).toBe('√{‸}')
    expect(show(run('root'))).toBe('√[‸]{}')
    expect(json(press(run('sqrt'), 'x'))).toEqual(['Sqrt', 'x'])
  })

  it('\\dd inserts a derivative', () => {
    expect(json(press(run('dd'), 'y', 'Tab', 't'))).toEqual(['Derivative', 'y', 't'])
  })

  it('\\sin inserts the function with brackets', () => {
    expect(show(run('sin'))).toBe('sin(‸)')
    expect(show(insertFunction('cos')(emptyState()))).toBe('cos(‸)')
  })

  it('Greek names insert the letter; other names are typed out', () => {
    expect(json(run('alpha'))).toEqual('alpha')
    expect(show(run('alpha'))).toBe('alpha‸')
    expect(json(run('speed'))).toEqual('speed')
    expect(show(run('speed'))).toBe('speed‸')
  })
})

describe('invariants', () => {
  it('every command leaves a valid cursor, from every position of a varied equation', () => {
    const base = type('sin(x)^2 + 1/(x+1', ' ', ' ', '= |y|')
    const positions: Cursor[] = []
    let cursor: Cursor | null = { path: [], offset: 0 }
    while (cursor) {
      positions.push(cursor)
      cursor = moveRight(base.root, cursor)
    }

    const keys = ['x', '+', '/', '^', '(', ')', '|', ' ', 'Backspace', 'Delete', 'Tab']
    for (const position of positions) {
      for (const key of keys) {
        const next = commandForKey({ key })!({ root: base.root, cursor: position })
        expect(isValidCursor(next.root, next.cursor), `${key} at ${JSON.stringify(position)}`).toBe(
          true,
        )
        expect(() => parseRow(next.root)).not.toThrow()
      }
    }
  })

  it('commands never mutate the state they are given', () => {
    const state = type('1/x+y^2')
    const frozen = JSON.stringify(state)
    insertFraction(state)
    press(state, 'Backspace', 'Delete', '(', ')', 'Tab', ' ')
    expect(JSON.stringify(state)).toBe(frozen)
  })
})
