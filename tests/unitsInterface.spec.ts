import { describe, expect, it } from 'vitest'

import { parseRow } from '../src/editor/parse'
import { equationLine, unitsHintMarks, unitsIssueMarks } from '../src/editor/units'
import { type } from './editorHelpers'

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

  it('underlines numbers by value, with their units', () => {
    const root = typed('x=t+2{mV}+3')
    const [mark] = unitsIssueMarks(root, [{ lineId: 'line-1', message: 'm', numbers: [2] }])
    expect(mark.atomIds).toHaveLength(2) // the digit and its units atom
  })

  it('underlines nothing for names that are not in the line', () => {
    expect(
      unitsIssueMarks(typed('x=1'), [{ lineId: 'l', message: 'm', variables: ['q'] }]),
    ).toEqual([])
  })
})

describe('unitsHintMarks', () => {
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
