import { describe, expect, it } from 'vitest'

import {
  type EditorState,
  deleteBackward,
  emptyState,
  insertFraction,
  insertFunction,
  namedCommand,
} from '../src/editor/commands'
import { type Cursor, isValidCursor, moveLeft, moveRight } from '../src/editor/cursor'
import { commandForKey } from '../src/editor/keymap'
import { type Row, type RowPath, childRows, rowPathsEqual } from '../src/editor/layout'
import { parseRow } from '../src/editor/parse'
import { getFunctionDefinition } from '../src/registry/nodes'
import { astToMathJson } from '../src/renderers/mathjson'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Press keys. Each argument is either a named key ("Backspace", "Tab",
// "Shift+Tab", "ArrowLeft", "ArrowRight") or text typed one character at a
// time.
function press(state: EditorState, ...parts: string[]): EditorState {
  for (const part of parts) {
    const named = /^(Shift\+)?[A-Z][a-z]+([A-Z][a-z]+)?$/.test(part) && part.length > 1
    const keys = named ? [part] : Array.from(part)

    for (const key of keys) {
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const move = key === 'ArrowLeft' ? moveLeft : moveRight
        state = { ...state, cursor: move(state.root, state.cursor) ?? state.cursor }
        continue
      }

      const shiftKey = key.startsWith('Shift+')
      const command = commandForKey({ key: shiftKey ? key.slice(6) : key, shiftKey })
      if (!command) throw new Error(`No command for key "${key}"`)
      state = command(state)
      expect(isValidCursor(state.root, state.cursor), `cursor valid after "${key}"`).toBe(true)
    }
  }

  return state
}

function type(...parts: string[]): EditorState {
  return press(emptyState(), ...parts)
}

// A compact text form of the tree with the caret shown as ‸:
//   fraction [num/den], superscript ^{…}, brackets (…) and |…|,
//   roots √{…} and √[index]{…}, derivative d{…}/d{…}, functions by name.
function show(state: EditorState): string {
  const render = (r: Row, path: RowPath): string => {
    const here = rowPathsEqual(path, state.cursor.path)
    let out = ''

    for (let i = 0; i <= r.length; i++) {
      if (here && i === state.cursor.offset) out += '‸'
      if (i === r.length) break

      const atom = r[i]
      const child = (branch: string) =>
        render(childRows(atom).find(([name]) => name === branch)![1], [
          ...path,
          { atom: i, branch: branch as RowPath[number]['branch'] },
        ])

      switch (atom.kind) {
        case 'symbol':
          out += atom.value
          break
        case 'function':
          out += getFunctionDefinition(atom.name)?.latexName ?? atom.name
          break
        case 'fraction':
          out += `[${child('num')}/${child('den')}]`
          break
        case 'superscript':
          out += `^{${child('sup')}}`
          break
        case 'group':
          out += atom.open === '|' ? `|${child('body')}|` : `(${child('body')})`
          break
        case 'root':
          out += atom.index ? `√[${child('index')}]{${child('body')}}` : `√{${child('body')}}`
          break
        case 'derivative':
          out += `d{${child('expr')}}/d{${child('variable')}}`
          break
      }
    }

    return out
  }

  return render(state.root, [])
}

function json(state: EditorState): unknown {
  return astToMathJson(parseRow(state.root).ast)
}

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
  it('turns typed letters into a function', () => {
    const state = type('sin(x)')
    expect(show(state)).toBe('sin(x)‸')
    expect(json(state)).toEqual(['Sin', 'x'])
  })

  it('recognises a name after other letters', () => {
    expect(show(type('xsin'))).toBe('xsin‸')
    expect(json(type('xsin(t)'))).toEqual(['Multiply', 'x', ['Sin', 't']])
  })

  it('extends a function to a longer name', () => {
    expect(json(type('cosh(x)'))).toEqual(['Cosh', 'x'])
  })

  it('prefers the longest spelling', () => {
    expect(json(type('arcsin(x)'))).toEqual(['Arcsin', 'x'])
  })

  it('backspace takes a function back to letters', () => {
    const state = press(type('sin'), 'Backspace')
    expect(show(state)).toBe('si‸')
    expect(json(state)).toEqual(['Multiply', 's', 'i'])
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

  it('takes a function back to letters from the front', () => {
    expect(show(press(type('sin'), 'ArrowLeft', 'Delete'))).toBe('‸in')
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

  it('other names insert a named symbol', () => {
    expect(json(run('alpha'))).toEqual('alpha')
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
