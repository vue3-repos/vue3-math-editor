import { describe, expect, it } from 'vitest'

import { type EditorState, namedCommand } from '../src/editor/commands'
import { contentMathML } from '../src/editor/exports'
import type { Row } from '../src/editor/layout'
import { importContentMathML, looksLikeContentMathML } from '../src/editor/mathmlImport'
import { parseRow } from '../src/editor/parse'
import { json, press, show, type } from './editorHelpers'

const cellml = (root: Row) => contentMathML(root, { cellml: true })
const shown = (root: Row) =>
  show({ root, cursor: { path: [], offset: root.length } }).replace('‸', '')
const imported = (text: string) => importContentMathML(text)!
const only = (text: string) => {
  const result = imported(text)
  expect(result.equations).toHaveLength(1)
  return result.equations[0]
}
const math = (body: string) =>
  `<math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">${body}</math>`

// Equations typed as the user would, including every kind of structure.
const run = (name: string) => (state: EditorState) => namedCommand(name)(state)
const TYPED: Array<[string, () => EditorState]> = [
  ['sum and product', () => type('y=a+b*c-d')],
  ['brackets', () => type('y=(a+b)*(c-d)')],
  ['negation', () => type('y=-a*b+-c')],
  ['fraction', () => press(type('y=1/(x+1)'), ' ', '+2')],
  ['power', () => type('y=(x+1)^2')],
  ['power of a fraction', () => press(type('y=(1/x'), ' ', ')^2')],
  ['function power', () => type('y=sin(x)^2')],
  ['functions', () => type('y=exp(-t)+ln(x)+log(x,2)+min(a,b,c)+rem(a,b)')],
  ['floor and ceiling', () => type('y=floor(x)+ceil(x)')],
  ['abs', () => type('y=|x-1|')],
  ['numbers with units', () => type('V=0.25{mV}*x+1e-3{volt}')],
  ['scientific', () => type('k=1.5e-08')],
  ['greek', () => type('alpha=2*beta')],
  [
    'roots',
    () => press(run('root')(press(run('sqrt')(type('y=')), 'x', ' ', '+')), '3', 'ArrowRight', 'y'),
  ],
  [
    'derivative',
    () => press(run('dd')(type('')), 'V', 'Tab', 't', 'ArrowRight', '=-(I_ion-I_stim)/C_m'),
  ],
  ['piecewise', () => press(run('cases')(type('y=')), '5{mV}', 'ArrowRight', 't<1{ms}&t>0')],
  ['logic', () => type('b=(x<1)')],
  ['constants', () => press(run('pi')(type('y=2*')), '*r+', 'x')],
]

describe('importContentMathML', () => {
  it.each(TYPED)('reads back what the editor exports: %s', (_, make) => {
    const root = make().root
    const exported = cellml(root)
    const back = only(exported)
    expect(cellml(back)).toBe(exported)
    expect(imported(exported).problems).toEqual([])
  })

  it('writes what the user would have typed, brackets only where needed', () => {
    const read = (body: string) => shown(only(math(body)))
    expect(
      read(
        '<apply><eq/><ci>y</ci><apply><times/><apply><plus/><ci>a</ci><ci>b</ci></apply><ci>c</ci></apply></apply>',
      ),
    ).toBe('y=(a+b)·c')
    expect(
      read('<apply><minus/><ci>a</ci><apply><minus/><ci>b</ci><ci>c</ci></apply></apply>'),
    ).toBe('a-(b-c)')
    expect(
      read('<apply><minus/><apply><minus/><ci>a</ci><ci>b</ci></apply><ci>c</ci></apply>'),
    ).toBe('a-b-c')
    expect(read('<apply><times/><ci>a</ci><apply><minus/><ci>b</ci></apply></apply>')).toBe(
      'a·(-b)',
    )
    expect(read('<apply><times/><cn>-2</cn><ci>a</ci></apply>')).toBe('-2·a')
    expect(read('<apply><power/><apply><minus/><ci>x</ci></apply><cn>2</cn></apply>')).toBe(
      '(-x)^{2}',
    )
    expect(
      read('<apply><divide/><apply><plus/><ci>a</ci><ci>b</ci></apply><ci>c</ci></apply>'),
    ).toBe('[a+b/c]')
  })

  it('gives numbers their cellml:units, leaving dimensionless off', () => {
    const root = only(
      math(
        '<apply><eq/><ci>V</ci><apply><plus/><cn cellml:units="mV">-65</cn><cn cellml:units="dimensionless">2</cn></apply></apply>',
      ),
    )
    expect(shown(root)).toBe('V=-65{mV}+2')
    expect(json({ root, cursor: { path: [], offset: 0 } })).toEqual([
      'Equal',
      'V',
      ['Add', ['Negate', 65], 2],
    ])
  })

  it('reads e-notation', () => {
    expect(shown(only(math('<cn cellml:units="per_s" type="e-notation">1.5<sep/>-3</cn>')))).toBe(
      '1.5e-3{per_s}',
    )
  })

  it('reads every equation of a CellML component’s maths, CellML 1.1 included', () => {
    const text = `<?xml version="1.0"?>
      <math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/1.1#">
        <!-- membrane -->
        <apply><eq/>
          <apply><diff/><bvar><ci>time</ci></bvar><ci>V</ci></apply>
          <apply><divide/>
            <apply><minus/><apply><plus/><ci>i_Na</ci><ci>i_K</ci><ci>i_L</ci></apply></apply>
            <ci>Cm</ci>
          </apply>
        </apply>
        <apply><eq/><ci>E_R</ci><cn cellml:units="millivolt">-75</cn></apply>
        <apply><eq/><ci>alpha_m</ci>
          <apply><divide/>
            <apply><times/><cn cellml:units="per_millivolt_millisecond">-0.1</cn><apply><plus/><ci>V</ci><cn cellml:units="millivolt">50</cn></apply></apply>
            <apply><minus/><apply><exp/><apply><divide/><apply><minus/><apply><plus/><ci>V</ci><cn cellml:units="millivolt">50</cn></apply></apply><cn cellml:units="millivolt">10</cn></apply></apply><cn cellml:units="dimensionless">1</cn></apply>
          </apply>
        </apply>
      </math>`
    const result = imported(text)
    expect(result.problems).toEqual([])
    expect(result.equations.map(shown)).toEqual([
      'd{V}/d{time}=[-(i_Na+i_K+i_L)/Cm]',
      'E_R=-75{millivolt}',
      'alpha_m=[-0.1{per_millivolt_millisecond}·(V+50{millivolt})/exp([-(V+50{millivolt})/10{millivolt}])-1]',
    ])
    for (const root of result.equations) expect(parseRow(root).diagnostics).toEqual([])
    // -75 is written as the editor would: minus applied to 75.
    expect(cellml(result.equations[1])).toContain('<cn cellml:units="millivolt">75</cn>')
  })

  it('reads fragments: a bare <apply>, and cellml:units without the namespace declared', () => {
    expect(shown(only('<apply><eq/><ci>x</ci><cn cellml:units="metre">2</cn></apply>'))).toBe(
      'x=2{metre}',
    )
  })

  it('leaves what it can’t write as an empty slot, and says so', () => {
    const result = imported(
      math('<apply><eq/><ci>y</ci><apply><factorial/><ci>n</ci></apply></apply>'),
    )
    expect(shown(result.equations[0])).toBe('y=()')
    expect(result.problems).toEqual(["<factorial> isn't supported; it was left as an empty slot"])
    const second = imported(
      math(
        '<apply><eq/><ci>y</ci><apply><diff/><bvar><ci>t</ci><degree><cn>2</cn></degree></bvar><ci>x</ci></apply></apply>',
      ),
    )
    expect(second.problems[0]).toMatch(/order other than 1/)
  })

  it('warns about variable names the editor would read otherwise', () => {
    const result = imported(math('<apply><eq/><ci>max</ci><ci>x</ci></apply>'))
    expect(result.problems).toEqual([
      'The variable max has the name of a function, so it reads as one here',
    ])
  })

  it('is null for text that isn’t XML', () => {
    expect(importContentMathML('<math><apply>')).toBeNull()
  })
})

describe('looksLikeContentMathML', () => {
  it('tells MathML from LaTeX and plain text', () => {
    expect(looksLikeContentMathML('<math xmlns="…"><ci>x</ci></math>')).toBe(true)
    expect(looksLikeContentMathML('  <?xml version="1.0"?>\n<math>')).toBe(true)
    expect(looksLikeContentMathML('<apply><eq/></apply>')).toBe(true)
    expect(looksLikeContentMathML('<mathml:math>')).toBe(true)
    expect(looksLikeContentMathML('x<1')).toBe(false)
    expect(looksLikeContentMathML('\\frac{1}{2}')).toBe(false)
  })
})
