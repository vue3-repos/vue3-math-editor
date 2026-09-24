import katex from 'katex'
import { describe, expect, it } from 'vitest'

import {
  deserializeAtoms,
  latexToRow,
  rowToLatexSource,
  serializeAtoms,
} from '../src/editor/clipboard'
import { namedCommand } from '../src/editor/commands'
import { contentMathML } from '../src/editor/exports'
import { nameOccurrences, numberOccurrences } from '../src/editor/identifiers'
import { type Row, row, symbol, unitsAtom } from '../src/editor/layout'
import { parseRow } from '../src/editor/parse'
import { KATEX_EDITOR_OPTIONS, rowToLatex } from '../src/renderers/layoutLatex'
import { json, press, show, type } from './editorHelpers'

const typed = (keys: string) => type(keys).root
const shown = (atoms: Row) => show({ root: atoms, cursor: { path: [], offset: atoms.length } })
const ast = (keys: string) => parseRow(typed(keys)).ast

describe('typing a number’s units', () => {
  it('{ after a number opens its units; } or Space leaves them', () => {
    expect(show(type('0.25{'))).toBe('0.25{‸}')
    expect(show(type('0.25{mV}'))).toBe('0.25{mV}‸')
    expect(show(type('0.25{mV}/T'))).toBe('[0.25{mV}/T‸]')
    expect(show(press(type('0.25{per_s'), ' ', '+1'))).toBe('0.25{per_s}+1‸')
  })

  it('\\units does the same', () => {
    expect(show(namedCommand('units')(type('2')))).toBe('2{‸}')
  })

  it('} outside units does nothing', () => {
    const state = type('x')
    expect(press(state, '}')).toEqual(state)
  })

  it('Backspace at the start of the units steps out rather than turning the name into a variable', () => {
    const state = press(type('2{mV'), 'ArrowLeft', 'ArrowLeft', 'Backspace')
    expect(show(state)).toBe('2‸{mV}')
  })

  it('an empty units atom goes in one Backspace', () => {
    expect(show(press(type('2{'), 'Backspace'))).toBe('2‸')
  })
})

describe('parsing units', () => {
  it('gives the number its units', () => {
    expect(ast('0.25{mV}')).toEqual({ type: 'Number', value: 0.25, units: 'mV' })
    expect(ast('1e-3{per_s}')).toMatchObject({ value: 1e-3, units: 'per_s', scientific: {} })
    expect(ast('2')).toEqual({ type: 'Number', value: 2 })
  })

  it('works inside expressions', () => {
    expect(json(type('x=0.25{mV}/T'))).toEqual(['Equal', 'x', ['Divide', 0.25, 'T']])
    expect(parseRow(typed('x=2{mV}*y')).diagnostics).toEqual([])
  })

  it('reports units that are not after a number, empty or not a name', () => {
    const messages = (keys: string) => parseRow(typed(keys)).diagnostics.map((d) => d.message)
    expect(messages('x{mV}')).toEqual(['Units belong straight after a number'])
    expect(messages('2{}')).toEqual(['Missing units name'])
    expect(messages('2{m+V}')).toEqual(['"m+V" isn\'t a units name'])
  })

  it('the units name is not a variable', () => {
    const tree = typed('2{V}+V')
    expect(nameOccurrences(tree, 'V')).toHaveLength(1)
  })

  it('numberOccurrences reports each number with its units', () => {
    const found = numberOccurrences(typed('2{mV}+3'))
    expect(found.map(({ value, units, atomIds }) => [value, units, atomIds.length])).toEqual([
      [2, 'mV', 2],
      [3, null, 1],
    ])
  })
})

describe('exporting units', () => {
  it('CellML mode writes the number’s units, or dimensionless', () => {
    const mathml = contentMathML(typed('x=0.25{mV}+2'), { cellml: true })
    expect(mathml).toContain('<cn cellml:units="mV">0.25</cn>')
    expect(mathml).toContain('<cn cellml:units="dimensionless">2</cn>')
    expect(contentMathML(typed('1e-3{per_s}'), { cellml: true })).toContain(
      '<cn cellml:units="per_s" type="e-notation">1<sep/>-3</cn>',
    )
  })

  it('plain Content MathML has no units', () => {
    expect(contentMathML(typed('0.25{mV}'))).toContain('<cn>0.25</cn>')
  })

  it('LaTeX writes the units upright after a thin space, and pastes back', () => {
    const latex = rowToLatexSource(typed('x=0.25{mV}+2{per_s}'))
    expect(latex).toBe('x=0.25\\,\\mathrm{mV}+2\\,\\mathrm{per\\_s}')
    expect(shown(latexToRow(latex))).toBe('x=0.25{mV}+2{per_s}‸')
  })

  it('pasting plain text reads {mV} and CellML Text’s {units: mV}', () => {
    expect(shown(latexToRow('x = 0.25{mV}'))).toBe('x=0.25{mV}‸')
    expect(shown(latexToRow('0.25 {units: dimensionless} / T_vc'))).toBe(
      '[0.25{dimensionless}/T_vc]‸',
    )
    // Braces elsewhere are still just grouping.
    expect(shown(latexToRow('x^{2}'))).toBe('x^{2}‸')
  })

  it('round-trips the editor clipboard format', () => {
    const tree = typed('0.25{mV}')
    expect(shown(deserializeAtoms(serializeAtoms(tree))!)).toBe('0.25{mV}‸')
  })
})

describe('rendering units', () => {
  it('draws the name upright and grey after a thin space, and KaTeX accepts it', () => {
    const atoms = [...row('0.25'), unitsAtom([...row('per'), symbol('_'), ...row('s')])]
    const latex = rowToLatex(atoms)
    expect(latex).toContain('\\,\\htmlData{row=r/4.units}{\\htmlClass{me-units}{')
    expect(latex).toContain('{\\mathrm{p}}')
    expect(latex).toContain('{\\_}')
    for (const tree of [atoms, typed('2{'), typed('2{m+V^2')]) {
      expect(() =>
        katex.renderToString(rowToLatex(tree), { ...KATEX_EDITOR_OPTIONS, throwOnError: true }),
      ).not.toThrow()
    }
  })
})
