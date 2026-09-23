import katex from 'katex'
import { describe, expect, it } from 'vitest'

import { latexToRow, rowToLatexSource } from '../src/editor/clipboard'
import { emptyState, namedCommand } from '../src/editor/commands'
import { contentMathML } from '../src/editor/exports'
import { undoGroup } from '../src/editor/history'
import type { Row } from '../src/editor/layout'
import { CONDITION_OPERATORS } from '../src/editor/operators'
import { parseRow } from '../src/editor/parse'
import { KATEX_EDITOR_OPTIONS, rowToLatex } from '../src/renderers/layoutLatex'
import { json, press, type } from './editorHelpers'

const typed = (keys: string) => type(keys).root
const values = (atoms: Row) => atoms.map((a) => (a as { value?: string }).value ?? a.kind).join('')
const jsonOf = (atoms: Row) => json({ root: atoms, cursor: { path: [], offset: 0 } })

describe('typing comparisons and logic', () => {
  it('types < > directly, and & as ∧, ! as ¬', () => {
    expect(values(typed('x<1'))).toBe('x<1')
    expect(values(typed('x>1'))).toBe('x>1')
    expect(values(typed('a&b'))).toBe('a∧b')
    expect(values(typed('!a'))).toBe('¬a')
  })

  it('combines <= >= != into one symbol', () => {
    expect(values(typed('x<=1'))).toBe('x≤1')
    expect(values(typed('x>=1'))).toBe('x≥1')
    expect(values(typed('x!=1'))).toBe('x≠1')
    expect(typed('x<=1')).toHaveLength(3)
    // Only straight after the symbol: an equals elsewhere is an equals.
    expect(values(typed('y=x'))).toBe('y=x')
  })

  it('has \\ commands for each operator', () => {
    for (const op of CONDITION_OPERATORS) {
      for (const name of op.commands) {
        expect(values(namedCommand(name)(emptyState()).root), name).toBe(op.symbol)
      }
    }
  })

  it('treats each operator as an operator for undo steps', () => {
    for (const op of CONDITION_OPERATORS) {
      expect(undoGroup(0, { kind: 'type', text: op.symbol }).fresh, op.symbol).toBe(true)
    }
  })
})

describe('parsing conditions', () => {
  it('reads each comparison', () => {
    expect(json(type('x<1'))).toEqual(['Less', 'x', 1])
    expect(json(type('x>1'))).toEqual(['Greater', 'x', 1])
    expect(json(type('x<=1'))).toEqual(['LessEqual', 'x', 1])
    expect(json(type('x>=1'))).toEqual(['GreaterEqual', 'x', 1])
    expect(json(type('x!=1'))).toEqual(['NotEqual', 'x', 1])
    expect(json(type('x=1'))).toEqual(['Equal', 'x', 1])
  })

  it('binds comparisons tighter than logic, and arithmetic tighter than both', () => {
    expect(json(type('x+1>0&y<2'))).toEqual([
      'And',
      ['Greater', ['Add', 'x', 1], 0],
      ['Less', 'y', 2],
    ])
    expect(json(type('x=0&y>1'))).toEqual(['And', ['Equal', 'x', 0], ['Greater', 'y', 1]])
  })

  it('binds ¬ tightest, then ∧, then ⊻, then ∨', () => {
    const tree = press(emptyState(), 'a')
    const or = namedCommand('or')
    const xor = namedCommand('xor')
    let state = or(tree)
    state = press(state, 'b&c')
    state = xor(state)
    state = press(state, '!d')
    expect(json(state)).toEqual(['Or', 'a', ['Xor', ['And', 'b', 'c'], ['Not', 'd']]])
  })

  it('applies ¬ to the whole comparison after it', () => {
    expect(json(type('!x>0'))).toEqual(['Not', ['Greater', 'x', 0]])
    expect(json(type('!(x>0)&y'))).toEqual(['And', ['Not', ['Greater', 'x', 0]], 'y'])
  })

  it('keeps ∧ and ∨ flat', () => {
    expect(json(type('a&b&c'))).toEqual(['And', 'a', 'b', 'c'])
  })

  it('leaves equations as they were', () => {
    expect(json(type('y=2x+1'))).toEqual(['Equal', 'y', ['Add', ['Multiply', 2, 'x'], 1]])
    expect(parseRow(typed('y=2x+1')).diagnostics).toEqual([])
  })

  it('reports a chained comparison at its second operator', () => {
    const atoms = typed('0<x<1')
    const result = parseRow(atoms)
    expect(result.diagnostics).toEqual([
      { message: "Comparisons can't be chained: join them with ∧", atomIds: [atoms[3].id] },
    ])
    expect(parseRow(typed('0<x&x<1')).diagnostics).toEqual([])
  })

  it('fills a missing operand with a placeholder', () => {
    expect(json(type('x<'))).toEqual(['Less', 'x', ['Missing']])
    expect(json(type('a&'))).toEqual(['And', 'a', ['Missing']])
    expect(json(type('!'))).toEqual(['Not', ['Missing']])
  })
})

describe('exporting conditions', () => {
  it('Content MathML uses the relational and logical elements', () => {
    const mathml = contentMathML(typed('x>=0&y!=1'))
    for (const tag of ['<and/>', '<geq/>', '<neq/>']) expect(mathml).toContain(tag)
    expect(contentMathML(typed('!x<1'))).toMatch(/<not\/>\s*<apply>\s*<lt\/>/)
  })

  it('LaTeX uses the symbols and pastes back', () => {
    const latex = rowToLatexSource(typed('x<=1&!y!=2'))
    expect(latex).toBe('x\\leq 1\\land \\lnot y\\neq 2')
    expect(values(latexToRow(latex))).toBe('x≤1∧¬y≠2')
  })

  it('pasting reads LaTeX commands and plain-text operators', () => {
    expect(values(latexToRow('x \\le 1 \\wedge y \\ge 2 \\lor \\neg z'))).toBe('x≤1∧y≥2∨¬z')
    expect(values(latexToRow('a \\not= b'))).toBe('a≠b')
    expect(values(latexToRow('x <= 1 && y != 2 & z == 3'))).toBe('x≤1∧y≠2∧z=3')
    expect(jsonOf(latexToRow('t >= 0 && t < 1'))).toEqual([
      'And',
      ['GreaterEqual', 't', 0],
      ['Less', 't', 1],
    ])
  })
})

describe('rendering conditions', () => {
  it('gives comparisons relation spacing and logic binary spacing', () => {
    const atoms = typed('x<=1&!y')
    const latex = rowToLatex(atoms)
    expect(latex).toContain(`\\mathrel{\\htmlData{atom=${atoms[1].id}}{\\leq}}`)
    expect(latex).toContain(`\\mathbin{\\htmlData{atom=${atoms[3].id}}{\\land}}`)
    expect(latex).toContain(`\\htmlData{atom=${atoms[4].id}}{\\lnot}`)
    expect(() =>
      katex.renderToString(latex, { ...KATEX_EDITOR_OPTIONS, throwOnError: true }),
    ).not.toThrow()
  })
})
