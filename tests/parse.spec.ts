import { describe, expect, it } from 'vitest'

import {
  type Atom,
  type Row,
  derivative,
  fraction,
  func,
  group,
  root,
  row,
  superscript,
  symbol,
} from '../src/editor/layout'
import { parseRow } from '../src/editor/parse'
import { astToMathJson } from '../src/renderers/mathjson'
import type { AstNode } from '../src/types/ast'

const n = (value: number): AstNode => ({ type: 'Number', value })
const id = (name: string): AstNode => ({ type: 'Identifier', name })
const ph: AstNode = { type: 'Placeholder' }
const add = (...children: AstNode[]): AstNode => ({ type: 'Add', children })
const mul = (...children: AstNode[]): AstNode => ({ type: 'Multiply', children })
const sub = (minuend: AstNode, subtrahend: AstNode): AstNode => ({
  type: 'Subtract',
  minuend,
  subtrahend,
})
const neg = (value: AstNode): AstNode => ({ type: 'Negate', value })
const pow = (base: AstNode, exponent: AstNode): AstNode => ({ type: 'Power', base, exponent })
const eq = (left: AstNode, right: AstNode): AstNode => ({ type: 'Equal', left, right })
const div = (numerator: AstNode, denominator: AstNode): AstNode => ({
  type: 'Divide',
  numerator,
  denominator,
})
const grp = (value: AstNode): AstNode => ({ type: 'Group', value })
const call = (name: string, ...args: AstNode[]): AstNode => ({ type: 'FunctionCall', name, args })

function parse(...items: Array<string | Atom>): AstNode {
  return parseRow(row(...items)).ast
}

describe('numbers and identifiers', () => {
  it('groups consecutive digits and a decimal point into one number', () => {
    expect(parse('12.5')).toEqual(n(12.5))
    expect(parse('.5')).toEqual(n(0.5))
    expect(parse('3.')).toEqual(n(3))
  })

  it('treats each typed letter as its own identifier (xy is x·y)', () => {
    expect(parse('xy')).toEqual(mul(id('x'), id('y')))
  })

  it('treats a whole-word symbol as one identifier', () => {
    expect(parseRow([symbol('alpha')]).ast).toEqual(id('alpha'))
  })

  it('does not guess function names from letters', () => {
    expect(parse('cos')).toEqual(mul(id('c'), id('o'), id('s')))
  })
})

describe('operator precedence', () => {
  it('4t-3 subtracts from the whole product', () => {
    expect(parse('4t-3')).toEqual(sub(mul(n(4), id('t')), n(3)))
  })

  it('2+3*4 keeps the product together', () => {
    expect(parse('2+3*4')).toEqual(add(n(2), mul(n(3), n(4))))
    expect(parse('2+3·4')).toEqual(add(n(2), mul(n(3), n(4))))
  })

  it('flattens repeated addition and multiplication', () => {
    expect(parse('a+b+c')).toEqual(add(id('a'), id('b'), id('c')))
    expect(parse('2*x*y')).toEqual(mul(n(2), id('x'), id('y')))
  })

  it('subtraction is a left-associative binary chain', () => {
    expect(parse('a-b-c')).toEqual(sub(sub(id('a'), id('b')), id('c')))
    expect(parse('a+b-c')).toEqual(sub(add(id('a'), id('b')), id('c')))
    expect(parse('a-b+c')).toEqual(add(sub(id('a'), id('b')), id('c')))
  })

  it('a leading minus negates the whole term', () => {
    expect(parse('-2x')).toEqual(neg(mul(n(2), id('x'))))
    expect(parse('-x', superscript(row('2')))).toEqual(neg(pow(id('x'), n(2))))
    expect(parse('a--b')).toEqual(sub(id('a'), neg(id('b'))))
  })

  it('= binds loosest', () => {
    expect(parse('y=2x+1')).toEqual(eq(id('y'), add(mul(n(2), id('x')), n(1))))
  })
})

describe('structures', () => {
  it('superscripts attach to the factor before them', () => {
    expect(parse('x', superscript(row('2')), '+1')).toEqual(add(pow(id('x'), n(2)), n(1)))
    expect(parse('2x', superscript(row('2')))).toEqual(mul(n(2), pow(id('x'), n(2))))
    expect(parse(group(row('x+1')), superscript(row('2')))).toEqual(
      pow(grp(add(id('x'), n(1))), n(2)),
    )
  })

  it('fractions parse each row independently', () => {
    expect(parse(fraction(row('1'), row('x+3')))).toEqual(div(n(1), add(id('x'), n(3))))
    expect(parse('x+', fraction(row('1'), row('2')), '+3')).toEqual(
      add(id('x'), div(n(1), n(2)), n(3)),
    )
  })

  it('brackets become Group, |…| becomes Abs, and multiply implicitly', () => {
    expect(parse('2', group(row('x+1')))).toEqual(mul(n(2), grp(add(id('x'), n(1)))))
    expect(parse(group(row('x'), '|'))).toEqual({ type: 'Abs', value: id('x') })
  })

  it('square and nth roots', () => {
    expect(parse(root(row('x')))).toEqual({ type: 'Root', radicand: id('x'), degree: null })
    expect(parse(root(row('x'), row('3')))).toEqual({
      type: 'Root',
      radicand: id('x'),
      degree: n(3),
    })
  })

  it('derivatives', () => {
    expect(parse(derivative(row('y'), row('t')))).toEqual({
      type: 'Derivative',
      expression: id('y'),
      variable: id('t'),
    })
  })
})

describe('functions', () => {
  it('pairs a function with the bracket group after it', () => {
    expect(parse(func('sin'), group(row('x+1')))).toEqual(call('sin', add(id('x'), n(1))))
  })

  it('an operator after the brackets applies outside the call', () => {
    expect(parse(func('sin'), group(row('x')), '+1')).toEqual(add(call('sin', id('x')), n(1)))
  })

  it('splits arguments at commas', () => {
    expect(parse(func('log'), group(row('x,2')))).toEqual(call('log', id('x'), n(2)))
  })

  it('takes the next factor as the argument without brackets', () => {
    expect(parse(func('sin'), 'x')).toEqual(call('sin', id('x')))
  })

  it('sin^2(x) is (sin x)^2, and a superscript after the call powers the call', () => {
    expect(parse(func('sin'), superscript(row('2')), group(row('x')))).toEqual(
      pow(call('sin', id('x')), n(2)),
    )
    expect(parse(func('sin'), group(row('x')), superscript(row('2')), '=y')).toEqual(
      eq(pow(call('sin', id('x')), n(2)), id('y')),
    )
  })

  it('a function with no argument gets a placeholder', () => {
    expect(parse(func('sin'))).toEqual(call('sin', ph))
  })

  it('multiplies implicitly with a preceding coefficient', () => {
    expect(parse('2', func('cos'), group(row('t')))).toEqual(mul(n(2), call('cos', id('t'))))
  })
})

describe('incomplete input becomes placeholders', () => {
  it('an empty row', () => {
    expect(parseRow([]).ast).toEqual(ph)
  })

  it('missing operands', () => {
    expect(parse('x+')).toEqual(add(id('x'), ph))
    expect(parse('+x')).toEqual(add(ph, id('x')))
    expect(parse('x=')).toEqual(eq(id('x'), ph))
    expect(parse('*x')).toEqual(mul(ph, id('x')))
  })

  it('empty child rows', () => {
    expect(parse(fraction())).toEqual(div(ph, ph))
    expect(parse(superscript(row('2')))).toEqual(pow(ph, n(2)))
    expect(parse(func('sin'), group())).toEqual(call('sin', ph))
  })
})

describe('diagnostics', () => {
  it('reports and skips stray glyphs without losing the rest of the row', () => {
    const atoms = row('x?+1')
    const result = parseRow(atoms)
    expect(result.ast).toEqual(add(id('x'), n(1)))
    expect(result.diagnostics).toEqual([{ message: 'Unexpected "?"', atomId: atoms[1].id }])
  })

  it('reports a comma outside function brackets', () => {
    const result = parseRow(row(group(row('1,2'))))
    expect(result.diagnostics.map((d) => d.message)).toEqual(['Unexpected ","'])
  })

  it('reports malformed numbers', () => {
    const result = parseRow(row('1.2.3'))
    expect(result.ast).toEqual(n(1.2))
    expect(result.diagnostics.map((d) => d.message)).toEqual(['Malformed number "1.2.3"'])
  })

  it('clean input has no diagnostics', () => {
    expect(parseRow(row('y=', fraction(row('1'), row('x')))).diagnostics).toEqual([])
  })
})

describe('integration with the exporters', () => {
  it('produces MathJSON through the existing renderer', () => {
    expect(astToMathJson(parse('4t-3'))).toEqual(['Subtract', ['Multiply', 4, 't'], 3])
    expect(astToMathJson(parse(func('sin'), group(row('x')), superscript(row('2'))))).toEqual([
      'Power',
      ['Sin', 'x'],
      2,
    ])
  })
})

// ---------------------------------------------------------------------------
// Totality: any layout tree parses without throwing
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomRow(rand: () => number, depth: number): Row {
  const length = Math.floor(rand() * 6)
  const atoms: Atom[] = []
  const child = () => randomRow(rand, depth - 1)

  for (let i = 0; i < length; i++) {
    const pick = depth > 0 ? Math.floor(rand() * 10) : 0

    switch (pick) {
      case 1:
        atoms.push(fraction(child(), child()))
        break
      case 2:
        atoms.push(superscript(child()))
        break
      case 3:
        atoms.push(root(child(), rand() < 0.5 ? child() : null))
        break
      case 4:
        atoms.push(group(child(), rand() < 0.5 ? '(' : '|'))
        break
      case 5:
        atoms.push(derivative(child(), child()))
        break
      case 6:
        atoms.push(func('sin'))
        break
      default:
        atoms.push(symbol('xy2.+-=*,?'[Math.floor(rand() * 10)]))
    }
  }

  return atoms
}

describe('totality', () => {
  it('never throws and always yields an AST the exporters accept', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const tree = randomRow(mulberry32(seed), 3)
      const { ast } = parseRow(tree)
      expect(() => astToMathJson(ast)).not.toThrow()
    }
  })
})
