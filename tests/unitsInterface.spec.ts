import { describe, expect, it } from 'vitest'

import { namedCommand } from '../src/editor/commands'
import { contentMathML } from '../src/editor/exports'
import { parseRow } from '../src/editor/parse'
import { equationLine, unitsHintMarks, unitsIssueMarks } from '../src/editor/units'
import { press, type } from './editorHelpers'

const typed = (keys: string) => type(keys).root
const line = (keys: string, id = 'line-1') => {
  const root = typed(keys)
  return equationLine(id, root, root.length ? parseRow(root) : null)
}

describe('equationLine', () => {
  it('reports the CellML-mode MathML, the variables and the units used', () => {
    const result = line('dVm_dt=(I_stim-g*Vm)/Cm+0.5{mV_per_ms}')
    expect(result.id).toBe('line-1')
    expect(result.variables).toEqual(['dVm_dt', 'I_stim', 'g', 'Vm', 'Cm'])
    expect(result.units).toEqual(['mV_per_ms'])
    expect(result.complete).toBe(true)
    expect(result.mathml).toContain('xmlns:cellml="http://www.cellml.org/cellml/2.0#"')
    expect(result.mathml).toContain('<cn cellml:units="mV_per_ms">0.5</cn>')
  })

  it('finds variables everywhere: fractions, functions, brackets', () => {
    expect(line('y=sin(a/b)+|c|').variables).toEqual(['y', 'a', 'b', 'c'])
  })

  it('is incomplete with an empty slot or a parse problem, or when empty', () => {
    expect(line('x+').complete).toBe(false)
    expect(line('x=2{').complete).toBe(false) // units still being typed
    expect(line('x=1,2').complete).toBe(false)
    expect(line('')).toEqual({
      id: 'line-1',
      mathml: '',
      variables: [],
      units: [],
      complete: false,
    })
  })
})

describe('unitsIssueMarks', () => {
  it('underlines every occurrence of the named variables', () => {
    const root = typed('x=v+t*v')
    const marks = unitsIssueMarks(root, [
      {
        lineId: 'line-1',
        message: "'v' is in 'metre_per_second' while 't' is in 'second'",
        variables: ['v', 't'],
      },
    ])
    expect(marks).toHaveLength(3)
    expect(marks.every((m) => m.kind === 'units')).toBe(true)
    expect(marks[0].message).toContain('metre_per_second')
  })

  it('underlines numbers by value or by units, the number only: its units stay hidden', () => {
    const root = typed('x=t+2{mV}+3')
    const [byValue] = unitsIssueMarks(root, [{ lineId: 'line-1', message: 'm', numbers: [2] }])
    expect(byValue.atomIds).toHaveLength(1) // the digit
    const [byUnits] = unitsIssueMarks(root, [{ lineId: 'line-1', message: 'm', units: ['mV'] }])
    expect(byUnits.atomIds).toEqual(byValue.atomIds)
  })

  it('underlines nothing for names that are not in the line', () => {
    expect(
      unitsIssueMarks(typed('x=1'), [{ lineId: 'l', message: 'm', variables: ['q'] }]),
    ).toEqual([])
  })
})

describe('unitsHintMarks', () => {
  it('explains numbers with units even without variable units', () => {
    expect(unitsHintMarks(typed('x=2{mV}+3'), null).map((m) => m.message)).toEqual(['2: mV'])
  })

  it('explains each variable’s units and each number’s units on hover', () => {
    const marks = unitsHintMarks(typed('Vm=2*Vm+0.5{mV}'), { Vm: 'millivolt' })
    expect(marks.map((m) => m.message)).toEqual([
      'Vm: millivolt',
      'Vm: millivolt',
      '2: dimensionless',
      '0.5: mV',
    ])
    expect(marks.every((m) => m.kind === 'hint')).toBe(true)
  })
})

describe('a default otherwise value', () => {
  // y = { value if t < 1 ; otherwise 0.0 }, then `keys` typed in the otherwise.
  const piecewise = (value: string, ...otherwise: string[]) => {
    let state = press(namedCommand('cases')(type('y=')), value, 'ArrowRight', 't<1', 'ArrowRight')
    // Keys typed at the end of the 0.0.
    if (otherwise.length)
      state = press(state, 'ArrowRight', 'ArrowRight', 'ArrowRight', ...otherwise)
    return state.root
  }
  const otherwiseMathML = (root: ReturnType<typeof piecewise>) =>
    /<otherwise>\s*(.*?)\s*<\/otherwise>/s.exec(contentMathML(root, { cellml: true }))?.[1]

  it('is in the first piece’s units while it is still 0.0', () => {
    expect(otherwiseMathML(piecewise('5{mV}'))).toBe('<cn cellml:units="mV">0</cn>')
    expect(otherwiseMathML(piecewise('-5{mV}'))).toBe('<cn cellml:units="mV">0</cn>')
    expect(equationLine('line-1', piecewise('5{mV}'), parseRow(piecewise('5{mV}'))).units).toEqual([
      'mV',
    ])
  })

  it('shows where its units come from on hover', () => {
    const messages = unitsHintMarks(piecewise('5{mV}'), {}).map((m) => m.message)
    expect(messages).toEqual(['5: mV', '1: dimensionless', '0: mV, as in the first piece'])
  })

  it('keeps its own units, or none, once edited', () => {
    expect(otherwiseMathML(piecewise('5{mV}', '{V}'))).toBe('<cn cellml:units="V">0</cn>')
    expect(otherwiseMathML(piecewise('5{mV}', 'Backspace', '1'))).toBe(
      '<cn cellml:units="dimensionless">0.1</cn>', // 0.0 edited to 0.1
    )
  })

  it('stays dimensionless when the first piece isn’t just a number with units', () => {
    expect(otherwiseMathML(piecewise('5'))).toBe('<cn cellml:units="dimensionless">0</cn>')
    expect(otherwiseMathML(piecewise('2*t'))).toBe('<cn cellml:units="dimensionless">0</cn>')
    expect(otherwiseMathML(piecewise('5{mV}+t'))).toBe('<cn cellml:units="dimensionless">0</cn>')
  })
})
