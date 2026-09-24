// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'

import { parseRow } from '../src/editor/parse'
import { equationLine } from '../src/editor/units'
import { UnitsChecker } from '../src/units/check'
import {
  NEW_UNITS_SOURCE,
  type UnitsDefinition,
  definitionProblems,
  describeDefinition,
  newUnitsFile,
  usedBy,
} from '../src/units/definitions'
import type { LibCellML } from '../src/units/libcellml'
import { UnitsLibrary } from '../src/units/library'
import { type } from './editorHelpers'

const mV: UnitsDefinition = { name: 'mV', parts: [{ prefix: 'milli', units: 'volt' }] }
const ms: UnitsDefinition = { name: 'ms', parts: [{ prefix: 'milli', units: 'second' }] }
const mVPerMs: UnitsDefinition = {
  name: 'mV_per_ms',
  parts: [{ units: 'mV' }, { units: 'ms', exponent: -1 }],
}

describe('definitionProblems', () => {
  const known = ['second', 'volt', 'metre', 'mV']

  it('accepts a good definition', () => {
    expect(definitionProblems(ms, [mV], known)).toEqual([])
    expect(definitionProblems(mVPerMs, [mV, ms], known)).toEqual([])
  })

  it('wants a CellML name that isn’t taken', () => {
    expect(definitionProblems({ ...ms, name: '' }, [], known)).toEqual(['Give the units a name'])
    expect(definitionProblems({ ...ms, name: '2ms' }, [], known)[0]).toMatch(/isn't a units name/)
    expect(definitionProblems({ ...ms, name: 'volt' }, [], known)).toEqual([
      'There are units called volt already',
    ])
    expect(definitionProblems(ms, [ms], known)).toEqual(['There are units called ms already'])
  })

  it('wants parts made of known units, with numbers for exponent and multiplier', () => {
    expect(definitionProblems({ name: 'x', parts: [] }, [], known)).toEqual([
      'Add what the units are made of',
    ])
    expect(definitionProblems({ name: 'x', parts: [{ units: 'furlong' }] }, [], known)).toEqual([
      'no units called furlong are defined',
    ])
    expect(
      definitionProblems(
        { name: 'x', parts: [{ units: 'second' }, { units: 'metre', exponent: NaN }] },
        [],
        known,
      ),
    ).toEqual(['Part 2: the exponent must be a number'])
    // Without libCellML the names can't be checked.
    expect(definitionProblems({ name: 'x', parts: [{ units: 'furlong' }] }, [], null)).toEqual([])
  })

  it('refuses units made of themselves, directly or through others', () => {
    expect(definitionProblems({ name: 'x', parts: [{ units: 'x' }] }, [], known)).toEqual([
      "units can't be made of themselves",
    ])
    const a = { name: 'a', parts: [{ units: 'b' }] }
    const b = { name: 'b', parts: [{ units: 'second' }] }
    expect(
      definitionProblems({ name: 'b', parts: [{ units: 'a' }] }, [a], [...known, 'a']),
    ).toEqual(['b would be made of itself, through other new units'])
    expect(usedBy('b', [a, b])).toEqual(['a'])
  })
})

describe('describeDefinition', () => {
  it('reads as the units are made', () => {
    expect(describeDefinition(mV)).toBe('milli volt')
    expect(describeDefinition(mVPerMs)).toBe('mV · ms^-1')
    expect(
      describeDefinition({ name: 'x', parts: [{ prefix: 'centi', units: 'metre', exponent: -2 }] }),
    ).toBe('(centi metre)^-2')
    expect(describeDefinition({ name: 'min', parts: [{ units: 'second', multiplier: 60 }] })).toBe(
      '60 second',
    )
  })
})

describe('newUnitsFile', () => {
  it('writes a CellML 2.0 file of just the units, those used by others first', () => {
    const text = newUnitsFile([mVPerMs, mV, ms])
    expect(text).toContain('<model xmlns="http://www.cellml.org/cellml/2.0#" name="new_units">')
    expect(text.indexOf('name="mV"')).toBeLessThan(text.indexOf('name="mV_per_ms"'))
    expect(text).toContain('<unit prefix="milli" units="volt"/>')
    expect(text).toContain('<unit units="ms" exponent="-1"/>')
    expect(text).not.toContain('<component')
  })

  describe('read by libCellML', () => {
    let lc: LibCellML
    beforeAll(async () => {
      const { loadLibCellML } = await import('./unitsLibcellml')
      lc = await loadLibCellML()
    })

    it('loads as a units file with no problems, and checks equations', () => {
      const text = newUnitsFile([
        mVPerMs,
        mV,
        ms,
        { name: 'min', parts: [{ units: 'second', multiplier: 60 }] },
      ])
      const library = UnitsLibrary.load(lc, [{ name: NEW_UNITS_SOURCE, text }])
      expect(library.problems).toEqual([])
      expect(library.names).toEqual(['mV', 'ms', 'mV_per_ms', 'min'])

      const checker = new UnitsChecker(lc, library)
      const line = (keys: string) => {
        const root = type(keys).root
        return equationLine('line-1', root, parseRow(root))
      }
      expect(checker.checkLine(line('r=V/t'), { r: 'mV_per_ms', V: 'mV', t: 'ms' })).toEqual([])
      expect(checker.checkLine(line('r=V/t'), { r: 'mV_per_ms', V: 'mV', t: 'min' })).toHaveLength(
        1,
      )
      library.dispose()
    })
  })
})
