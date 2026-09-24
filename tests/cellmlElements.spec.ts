import katex from 'katex'
import { describe, expect, it } from 'vitest'

import { latexToRow, rowToLatexSource } from '../src/editor/clipboard'
import { emptyState, namedCommand } from '../src/editor/commands'
import { deserializeAtoms, serializeAtoms } from '../src/editor/clipboard'
import { CONSTANTS } from '../src/editor/constants'
import { contentMathML } from '../src/editor/exports'
import { nameOccurrences } from '../src/editor/identifiers'
import { type Row, row, superscript, symbol } from '../src/editor/layout'
import { parseRow } from '../src/editor/parse'
import { FUNCTION_REGISTRY } from '../src/registry/nodes'
import { KATEX_EDITOR_OPTIONS, rowToLatex } from '../src/renderers/layoutLatex'
import { json, press, show, type } from './editorHelpers'

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
      '\\operatorname{arcsinh}\\left(x\\right)+\\left\\lfloor y\\right\\rfloor +\\max \\left(a,b\\right)',
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

describe('floor and ceiling brackets', () => {
  it('typing floor( or ceil( turns the name into the brackets; ) leaves them', () => {
    expect(show(type('floor('))).toBe('⌊‸⌋')
    expect(show(type('floor(x)+1'))).toBe('⌊x⌋+1‸')
    expect(show(type('ceil(x)'))).toBe('⌈x⌉‸')
    expect(show(type('y=2ceiling(t/2)'))).toBe('y=2⌈[t/2]⌉‸')
  })

  it('only a whole name is converted', () => {
    expect(show(type('myfloor(x)'))).toBe('myfloor(x)‸')
    expect(show(type('floors(x)'))).toBe('floors(x)‸')
  })

  it('\\floor and \\ceil insert them, or put them round the selection', () => {
    expect(show(namedCommand('floor')(emptyState()))).toBe('⌊‸⌋')
    expect(show(namedCommand('lceil')(emptyState()))).toBe('⌈‸⌉')
    const selected = press(type('x+1'), 'SelectAll')
    expect(show(namedCommand('floor')(selected))).toBe('⌊x+1⌋‸')
  })

  it('parse as the floor and ceiling functions', () => {
    expect(json(type('floor(x/2)'))).toEqual(['Floor', ['Divide', 'x', 2]])
    expect(json(type('ceil(x)-floor(x)'))).toEqual(['Subtract', ['Ceil', 'x'], ['Floor', 'x']])
    expect(contentMathML(type('floor(x)').root)).toMatch(/<floor\/>\s*<ci>x<\/ci>/)
  })

  it('are drawn as brackets, and KaTeX accepts them', () => {
    const latex = rowToLatex(type('floor(x)+ceil(y)').root)
    expect(latex).toContain('\\left\\lfloor')
    expect(latex).toContain('\\right\\rceil')
    expect(() =>
      katex.renderToString(latex, { ...KATEX_EDITOR_OPTIONS, throwOnError: true }),
    ).not.toThrow()
  })

  it('copy as LaTeX and paste back, and paste from common forms', () => {
    const tree = type('floor(x)+ceil(y)').root
    const latex = rowToLatexSource(tree)
    expect(latex).toBe('\\left\\lfloor x\\right\\rfloor +\\left\\lceil y\\right\\rceil')
    const pasted = (text: string) =>
      show({ root: latexToRow(text), cursor: { path: [], offset: 0 } })
    expect(pasted(latex)).toBe('‸⌊x⌋+⌈y⌉')
    expect(pasted('\\lfloor x \\rfloor')).toBe('‸⌊x⌋')
    expect(pasted('floor(x) + ceiling(y)')).toBe('‸⌊x⌋+⌈y⌉')
    expect(pasted('\\operatorname{floor}\\left(x\\right)')).toBe('‸⌊x⌋')
  })

  it('survive the editor clipboard format', () => {
    const tree = type('floor(x)').root
    const copy = deserializeAtoms(serializeAtoms(tree))!
    expect(show({ root: copy, cursor: { path: [], offset: 0 } })).toBe('‸⌊x⌋')
  })
})
