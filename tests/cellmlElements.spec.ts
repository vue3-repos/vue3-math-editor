import katex from 'katex'
import { describe, expect, it } from 'vitest'

import { latexToRow, rowToLatexSource } from '../src/editor/clipboard'
import { emptyState, namedCommand } from '../src/editor/commands'
import { CONSTANTS } from '../src/editor/constants'
import { contentMathML } from '../src/editor/exports'
import { nameOccurrences } from '../src/editor/identifiers'
import { type Row, row, superscript, symbol } from '../src/editor/layout'
import { parseRow } from '../src/editor/parse'
import { FUNCTION_REGISTRY } from '../src/registry/nodes'
import { KATEX_EDITOR_OPTIONS, rowToLatex } from '../src/renderers/layoutLatex'
import { json, press, type } from './editorHelpers'

const jsonOf = (atoms: Row) => json({ root: atoms, cursor: { path: [], offset: 0 } })
const constant = (name: string) => namedCommand(name)(emptyState()).root
const values = (atoms: Row) => atoms.map((a) => (a as { value?: string }).value ?? a.kind)

// The element names of CellML 2.0's MathML subset (CellML 2.0 spec, table 2.1),
// less the structural ones (apply, piece, …) and qualifiers (bvar, degree, …).
const CELLML_FUNCTIONS = [
  'root', 'abs', 'exp', 'ln', 'log', 'floor', 'ceiling', 'min', 'max', 'rem',
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh', 'sech', 'csch', 'coth',
  'arcsin', 'arccos', 'arctan', 'arcsec', 'arccsc', 'arccot', 'arcsinh', 'arccosh',
  'arctanh', 'arcsech', 'arccsch', 'arccoth',
] // prettier-ignore
const CELLML_CONSTANTS = ['pi', 'exponentiale', 'notanumber', 'infinity', 'true', 'false']

describe('constants', () => {
  it('covers every CellML constant', () => {
    expect(CONSTANTS.map((c) => c.mathml).sort()).toEqual([...CELLML_CONSTANTS].sort())
  })

  it('are inserted by \\ commands', () => {
    expect(values(constant('pi'))).toEqual(['pi'])
    expect(values(constant('e'))).toEqual(['exponentiale'])
    expect(values(constant('exponentiale'))).toEqual(['exponentiale'])
    expect(values(constant('inf'))).toEqual(['infinity'])
    expect(values(constant('infinity'))).toEqual(['infinity'])
    expect(values(constant('nan'))).toEqual(['notanumber'])
    expect(values(constant('true'))).toEqual(['true'])
  })

  it('parse as constants, not variables; a typed letter e is still a variable', () => {
    expect(parseRow(constant('pi')).ast).toEqual({ type: 'Constant', name: 'pi' })
    expect(jsonOf(row('2', symbol('pi'), 'r'))).toEqual(['Multiply', 2, 'Pi', 'r'])
    expect(jsonOf(row(symbol('exponentiale'), superscript(row('x'))))).toEqual([
      'Power',
      'ExponentialE',
      'x',
    ])
    expect(json(type('e'))).toEqual('e')
    expect(json(type('pi'))).toEqual('pi') // typed letters: a name
  })

  it('export to MathML elements and MathJSON', () => {
    const expected: Record<string, unknown> = {
      pi: 'Pi',
      exponentiale: 'ExponentialE',
      infinity: { num: '+Infinity' },
      notanumber: { num: 'NaN' },
      true: 'True',
      false: 'False',
    }
    for (const c of CONSTANTS) {
      expect(contentMathML([symbol(c.symbol)])).toContain(`<${c.mathml}/>`)
      expect(jsonOf([symbol(c.symbol)])).toEqual(expected[c.symbol])
    }
    expect(jsonOf(row('-', symbol('infinity')))).toEqual(['Negate', { num: '+Infinity' }])
  })

  it('need no units in CellML mode', () => {
    expect(contentMathML(row('2', symbol('pi')), { cellml: true })).toMatch(
      /<cn cellml:units="undefined">2<\/cn>\s*<pi\/>/,
    )
  })

  it('are not variable names', () => {
    expect(nameOccurrences(row(symbol('pi'), '+pi'), 'pi')).toHaveLength(1) // the typed name
  })

  it('draw as in print, and KaTeX accepts them', () => {
    for (const c of CONSTANTS) {
      const atom = symbol(c.symbol)
      const latex = rowToLatex([atom])
      expect(latex).toContain(`\\htmlData{atom=${atom.id}}{${c.latex}}`)
      expect(() =>
        katex.renderToString(latex, { ...KATEX_EDITOR_OPTIONS, throwOnError: true }),
      ).not.toThrow()
    }
  })

  it('copy as LaTeX and paste back', () => {
    const atoms = [
      ...row('2'),
      symbol('pi'),
      ...row('+'),
      symbol('exponentiale'),
      ...row('+'),
      symbol('infinity'),
      ...row('+'),
      symbol('notanumber'),
      symbol('∧'),
      symbol('true'),
    ]
    const latex = rowToLatexSource(atoms)
    expect(latex).toBe('2\\pi +\\mathrm{e}+\\infty +\\mathrm{NaN}\\land \\mathrm{true}')
    expect(values(latexToRow(latex))).toEqual(values(atoms))
  })

  it('pasting keeps the e of scientific notation apart from Euler’s number', () => {
    expect(jsonOf(latexToRow('1\\mathrm{e}{-08}'))).toEqual(1e-8)
    expect(jsonOf(latexToRow('2\\mathrm{e}^{x}'))).toEqual([
      'Multiply',
      2,
      ['Power', 'ExponentialE', 'x'],
    ])
    expect(jsonOf(latexToRow('\\pi r^2'))).toEqual(['Multiply', 'Pi', ['Power', 'r', 2]])
  })
})

describe('functions', () => {
  it('covers every CellML function (root and abs are structures)', () => {
    const tags = Object.values(FUNCTION_REGISTRY).map((f) => f.mathMlTag)
    expect([...tags, 'root', 'abs'].sort()).toEqual([...CELLML_FUNCTIONS].sort())
  })

  it('each is typed by its name and exports to its MathML element', () => {
    for (const f of Object.values(FUNCTION_REGISTRY)) {
      const state = type(`${f.latexName}(x)`)
      const { ast } = parseRow(state.root)
      expect(ast, f.name).toEqual({
        type: 'FunctionCall',
        name: f.name,
        args: [{ type: 'Identifier', name: 'x' }],
      })
      expect(contentMathML(state.root), f.name).toContain(`<${f.mathMlTag}/>`)
      expect(json(state), f.name).toEqual([f.mathJson, 'x'])
    }
  })

  it('has aliases and multiple arguments', () => {
    expect(json(type('ceil(x)'))).toEqual(['Ceil', 'x'])
    expect(json(type('max(a,b,c)'))).toEqual(['Max', 'a', 'b', 'c'])
    expect(json(type('rem(n,2)'))).toEqual(['Remainder', 'n', 2])
    expect(contentMathML(type('min(a,b)').root)).toMatch(/<min\/>\s*<ci>a<\/ci>\s*<ci>b<\/ci>/)
  })

  it('copy as LaTeX, with \\operatorname where LaTeX has no command, and paste back', () => {
    const state = press(emptyState(), 'arcsinh(x)+floor(y)+max(a,b)')
    const latex = rowToLatexSource(state.root)
    expect(latex).toBe(
      '\\operatorname{arcsinh}\\left(x\\right)+\\operatorname{floor}\\left(y\\right)+\\max \\left(a,b\\right)',
    )
    expect(jsonOf(latexToRow(latex))).toEqual([
      'Add',
      ['Arsinh', 'x'],
      ['Floor', 'y'],
      ['Max', 'a', 'b'],
    ])
  })

  it('render upright, and KaTeX accepts every one', () => {
    for (const f of Object.values(FUNCTION_REGISTRY)) {
      const latex = rowToLatex(type(`${f.latexName}(x)`).root)
      expect(() =>
        katex.renderToString(latex, { ...KATEX_EDITOR_OPTIONS, throwOnError: true }),
      ).not.toThrow()
    }
  })
})
