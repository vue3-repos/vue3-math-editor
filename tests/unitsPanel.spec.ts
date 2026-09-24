import { describe, expect, it } from 'vitest'

import { parseRow } from '../src/editor/parse'
import { equationLine } from '../src/editor/units'
import { variableRows, withSources, withUnits } from '../src/units/panel'
import { type } from './editorHelpers'

const line = (keys: string, id = 'line-1') => {
  const root = type(keys).root
  return equationLine(id, root, parseRow(root))
}

describe('variableRows', () => {
  const lines = [line('V=I*R'), line('P=V*I', 'line-2')]

  it('lists the variables in order of first use, then others with units', () => {
    const rows = variableRows(lines, { R: 'ohm', V: 'volt', old: 'metre' }, null)
    expect(rows.map((row) => [row.name, row.units, row.used, row.state])).toEqual([
      ['V', 'volt', true, 'ok'],
      ['I', '', true, 'missing'],
      ['R', 'ohm', true, 'ok'],
      ['P', '', true, 'missing'],
      ['old', 'metre', false, 'ok'],
    ])
  })

  it('knows unknown units only once the units names are known', () => {
    expect(variableRows(lines, { V: 'furlong' }, null)[0].state).toBe('ok')
    expect(variableRows(lines, { V: 'furlong' }, ['volt'])[0].state).toBe('unknown')
    expect(variableRows(lines, { V: 'volt' }, ['volt'])[0].state).toBe('ok')
  })
})

describe('edits', () => {
  it('sets, trims and removes a variable’s units', () => {
    expect(withUnits({ a: 'metre' }, 'b', ' second ')).toEqual({ a: 'metre', b: 'second' })
    expect(withUnits({ a: 'metre' }, 'a', '')).toEqual({})
  })

  it('adds units files, replacing one of the same name in place', () => {
    const a = { name: 'a.cellml', text: 'A' }
    const b = { name: 'b.cellml', text: 'B' }
    expect(
      withSources(
        [a, b],
        [
          { name: 'a.cellml', text: 'A2' },
          { name: 'c', text: 'C' },
        ],
      ),
    ).toEqual([{ name: 'a.cellml', text: 'A2' }, b, { name: 'c', text: 'C' }])
  })
})
