// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'

import { namedCommand, type EditorState } from '../src/editor/commands'
import { parseRow } from '../src/editor/parse'
import { equationLine, unitsIssueMarks, type VariableUnits } from '../src/editor/units'
import { UnitsChecker, missingUnits } from '../src/units/check'
import type { LibCellML } from '../src/units/libcellml'
import { UnitsLibrary } from '../src/units/library'
import { press, type } from './editorHelpers'
import { loadLibCellML, unitsFile } from './unitsLibcellml'

let lc: LibCellML
beforeAll(async () => {
  lc = await loadLibCellML()
})

const lineOf = (state: EditorState, id = 'line-1') =>
  equationLine(id, state.root, state.root.length ? parseRow(state.root) : null)
const line = (keys: string, id = 'line-1') => lineOf(type(keys), id)
const pi = (state: EditorState) => namedCommand('pi')(state)
// d(of)/d(by) = rest
const derivative = (of: string, by: string, ...rest: string[]) =>
  lineOf(press(namedCommand('dd')(type('')), of, 'Tab', by, 'ArrowRight', ...rest))

const PHYSIOLOGY = unitsFile({
  mV: [['volt', 'milli']],
  ms: [['second', 'milli']],
  per_ms: [['ms', undefined, -1]],
  mV_per_ms: [['mV'], ['per_ms']],
  metre_per_second: [['metre'], ['second', undefined, -1]],
})

describe('UnitsLibrary', () => {
  it('keeps only the units of a file', () => {
    const file = PHYSIOLOGY.replace(
      '</model>',
      '<component name="c"><variable name="x" units="mV"/></component></model>',
    )
    const library = UnitsLibrary.load(lc, [{ name: 'physiology.cellml', text: file }])
    expect(library.names).toEqual(['mV', 'ms', 'per_ms', 'mV_per_ms', 'metre_per_second'])
    expect(library.sources).toEqual([{ name: 'physiology.cellml', units: library.names }])
    expect(library.problems).toEqual([])
    expect(library.isKnown('mV')).toBe(true)
    expect(library.isKnown('volt')).toBe(true)
    expect(library.isKnown('furlong')).toBe(false)
    library.dispose()
  })

  it('reads CellML 1.1 files', () => {
    const library = UnitsLibrary.load(lc, [
      { name: 'old.cellml', text: unitsFile({ mV: [['volt', 'milli']] }, '1.1') },
    ])
    expect(library.names).toEqual(['mV'])
    expect(library.problems).toEqual([])
  })

  it('keeps the first definition of a name, and says when a later one differs', () => {
    const library = UnitsLibrary.load(lc, [
      { name: 'a.cellml', text: unitsFile({ mV: [['volt', 'milli']], ms: [['second', 'milli']] }) },
      { name: 'b.cellml', text: unitsFile({ mV: [['volt', 'milli']], ms: [['second']] }) },
    ])
    expect(library.names).toEqual(['mV', 'ms'])
    expect(library.sources[1].units).toEqual([])
    expect(library.problems).toEqual([
      {
        source: 'b.cellml',
        message: '"ms" is already defined differently in a.cellml; that definition is used',
      },
    ])
  })

  it('reports built-in names redefined, units made from undefined units, and unreadable files', () => {
    const library = UnitsLibrary.load(lc, [
      { name: 'a.cellml', text: unitsFile({ volt: [['ampere']], rate: [['per_hour']] }) },
      { name: 'b.cellml', text: 'not a CellML file' },
    ])
    expect(library.names).toEqual(['rate'])
    const messages = library.problems.map((p) => `${p.source}: ${p.message}`)
    expect(messages).toContain(
      'a.cellml: "volt" is a built-in units name, so this definition was skipped',
    )
    expect(messages).toContain('a.cellml: "rate" is made from "per_hour", which isn\'t defined')
    expect(messages.some((m) => m.startsWith('b.cellml: '))).toBe(true)
  })

  it('knows which definitions a units name needs', () => {
    const library = UnitsLibrary.load(lc, [{ name: 'p', text: PHYSIOLOGY }])
    expect(library.requiredBy(['mV_per_ms', 'second'])).toEqual(['mV_per_ms', 'mV', 'per_ms', 'ms'])
  })
})

describe('UnitsChecker', () => {
  let library: UnitsLibrary
  let checker: UnitsChecker
  beforeAll(() => {
    library = UnitsLibrary.load(lc, [{ name: 'physiology.cellml', text: PHYSIOLOGY }])
    checker = new UnitsChecker(lc, library)
  })

  const check = (keys: string, variableUnits: VariableUnits) =>
    checker.checkLine(line(keys), variableUnits)

  it('finds nothing wrong with consistent units, including library units', () => {
    const units = { x: 'metre', t: 'second', v: 'metre_per_second' }
    expect(checker.checkLine(derivative('x', 't', '=v'), units)).toEqual([])
    const membrane = derivative('V', 't', '=I/C', 'ArrowRight', '+0.5{mV_per_ms}')
    expect(checker.checkLine(membrane, { V: 'mV', t: 'ms', I: 'mV', C: 'ms' })).toEqual([])
    // Typed without leaving the denominator, it's I/(C+0.5), which is wrong.
    const denominator = derivative('V', 't', '=I/C+0.5{mV_per_ms}')
    expect(checker.checkLine(denominator, { V: 'mV', t: 'ms', I: 'mV', C: 'ms' })[0].message).toBe(
      "Units don't match in C+0.5: C is in ms, 0.5 is in mV_per_ms",
    )
    const wave = lineOf(press(pi(type('y=2{second}*sin(')), '*t/1{second}'))
    expect(checker.checkLine(wave, { y: 'second', t: 'second' })).toEqual([])
  })

  it('reports a mismatch against the variables at fault', () => {
    const velocity = derivative('x', 't', '=v')
    expect(checker.checkLine(velocity, { x: 'metre', t: 'second', v: 'metre' })).toEqual([
      {
        lineId: 'line-1',
        message: "Units don't match in dx/dt = v: dx/dt is in metre x second^-1, v is in metre",
        variables: ['x', 't', 'v'],
      },
    ])
  })

  it('tells apart units that differ only in scale', () => {
    const [issue] = check('V=2{volt}', { V: 'mV' })
    expect(issue.message).toBe("Units don't match in V = 2.0: V is in mV, 2.0 is in volt")
    expect(issue).toMatchObject({ variables: ['V'], numbers: [2] })
    expect(check('V=W*1000', { V: 'mV', W: 'volt' })).toHaveLength(1) // a scale factor is still dimensionless
    expect(check('V=2{mV}', { V: 'mV' })).toEqual([])
  })

  it('reports scale differences anywhere in an equation', () => {
    const units = { V: 'mV', W: 'volt', X: 'mV', t: 'ms' }
    const messages = (keys: string) => check(keys, units).map((issue) => issue.message)
    expect(messages('V=W+X')).toEqual(["Units don't match in W+X: W is in volt, X is in mV"])
    expect(messages('V=X+W+X')).toHaveLength(1)
    const maximum = lineOf(press(namedCommand('max')(type('V=')), 'W,X'))
    expect(checker.checkLine(maximum, units).map((issue) => issue.message)).toEqual([
      "Units don't match in max(W, X): W is in volt, X is in mV",
    ])
    // In a piecewise's condition.
    const started = namedCommand('cases')(type('V='))
    const condition = lineOf(press(started, 'X', 'ArrowRight', 't<1{second}'))
    expect(checker.checkLine(condition, units).map((issue) => issue.message)).toEqual([
      "Units don't match in t < 1.0: t is in ms, 1.0 is in second",
    ])
  })

  it('reports numbers at fault by value', () => {
    expect(check('y=t+2', { y: 'second', t: 'second' })).toEqual([
      {
        lineId: 'line-1',
        message: "Units don't match in t+2.0: t is in second, 2.0 is dimensionless",
        variables: ['t'],
        numbers: [2],
      },
    ])
  })

  it('reports an argument that should be dimensionless', () => {
    const [issue] = check('y=exp(t)', { y: 'dimensionless', t: 'second' })
    expect(issue.message).toBe('t in exp(t) must be dimensionless, but is in second')
    expect(issue.variables).toEqual(['t'])
  })

  it('reports a piecewise whose pieces disagree', () => {
    const units = { y: 'second', t: 'second' }
    const started = namedCommand('cases')(type('y='))
    expect(checker.checkLine(lineOf(started), units)).toEqual([]) // incomplete: not checked
    // The default otherwise, 0.0, has no units of its own; with a first piece
    // that isn't a number with units, it is dimensionless.
    const piecewise = lineOf(press(started, 't', 'ArrowRight', 't<1{second}'))
    expect(piecewise.complete).toBe(true)
    expect(checker.checkLine(piecewise, units)[0].message).toMatch(
      /^The parts of .* have different units$/,
    )
  })

  it('takes the default otherwise value’s units from a first piece that is a number', () => {
    const started = namedCommand('cases')(type('V='))
    const piecewise = lineOf(press(started, '5{mV}', 'ArrowRight', 't<1{ms}'))
    expect(checker.checkLine(piecewise, { V: 'mV', t: 'ms' })).toEqual([])
    const scaled = lineOf(
      press(
        started,
        '5{mV}',
        'ArrowRight',
        't<1{ms}',
        'ArrowRight',
        'ArrowRight',
        'ArrowRight',
        'ArrowRight',
        '{volt}',
      ),
    )
    expect(checker.checkLine(scaled, { V: 'mV', t: 'ms' })[0].message).toMatch(
      /^The parts of .* have different units$/,
    )
  })

  it('reports variables without units instead of checking', () => {
    expect(missingUnits(line('x=a*b'), { a: 'metre' })).toEqual(['x', 'b'])
    expect(check('x=a*b', { a: 'metre' })).toEqual([
      { lineId: 'line-1', message: 'x has no units', variables: ['x'] },
      { lineId: 'line-1', message: 'b has no units', variables: ['b'] },
    ])
  })

  it('reports units names that aren’t defined, for variables and numbers', () => {
    const issues = check('x=a+2{furlong}', { x: 'furlong', a: 'fortnight' })
    expect(issues).toEqual([
      {
        lineId: 'line-1',
        message: 'No units called furlong are defined',
        variables: ['x'],
        units: ['furlong'],
      },
      {
        lineId: 'line-1',
        message: 'No units called fortnight are defined',
        variables: ['a'],
        units: [],
      },
    ])
    // Numbers are underlined by their units.
    const root = type('x=a+2{furlong}').root
    const marks = unitsIssueMarks(root, issues)
    expect(marks.map((m) => m.atomIds.length)).toEqual([1, 2, 1]) // x; 2 and its units; a
  })

  it('reports missing and undefined units together', () => {
    expect(check('x=a*b', { x: 'metre', a: 'furlong' }).map((issue) => issue.message)).toEqual([
      'b has no units',
      'No units called furlong are defined',
    ])
  })

  it('checks every complete line, each under its own id', () => {
    const units = { x: 'metre', t: 'second' }
    const issues = checker.check(
      [line('x=t', 'line-1'), line('x=', 'line-2'), line('x=t', 'line-3')],
      units,
    )
    expect(issues.map((issue) => issue.lineId)).toEqual(['line-1', 'line-3'])
  })

  it('checks Greek names and constants', () => {
    const angle = lineOf(press(pi(type('alpha=2*')), '*beta'))
    expect(angle.variables).toEqual(['alpha', 'beta'])
    expect(checker.checkLine(angle, { alpha: 'radian', beta: 'radian' })).toEqual([])
    const shifted = lineOf(pi(type('alpha=beta+')))
    expect(checker.checkLine(shifted, { alpha: 'second', beta: 'second' })[0].variables).toEqual([
      'beta',
    ])
  })

  it('is quick once a line has been checked', () => {
    const units = { x: 'metre', t: 'second', v: 'metre_per_second' }
    const edited = line('dx/dt=v+1{metre_per_second}')
    const first = checker.checkLine(edited, units)
    const start = performance.now()
    for (let i = 0; i < 100; i++) expect(checker.checkLine(edited, units)).toEqual(first)
    expect(performance.now() - start).toBeLessThan(50)
  })
})
