// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp, effectScope, nextTick, reactive, ref } from 'vue'

import { parseRow } from '../src/editor/parse'
import { equationLine, type EquationLine, type VariableUnits } from '../src/editor/units'
import type { LibCellML } from '../src/units/libcellml'
import { NEW_UNITS_SOURCE, type UnitsDefinition } from '../src/units/definitions'
import type { UnitsSource } from '../src/units/library'
import {
  LIBCELLML_KEY,
  useUnitsChecker,
  type ProvidedLibCellML,
  type UnitsCheckerOptions,
} from '../src/units/useUnitsChecker'
import { type } from './editorHelpers'
import { loadLibCellML, unitsFile } from './unitsLibcellml'

let lc: LibCellML
beforeAll(async () => {
  lc = await loadLibCellML()
})

const line = (keys: string, id = 'line-1'): EquationLine => {
  const root = type(keys).root
  return equationLine(id, root, parseRow(root))
}

const settled = async () => {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 5))
}

// Run the composable as a component's setup would, with `provided` as what
// the vue3-libcellml.js plugin provides (none if undefined).
function setup(options: Omit<UnitsCheckerOptions, 'delay'>, provided?: unknown) {
  const app = createApp({})
  if (provided !== undefined) app.provide(LIBCELLML_KEY, provided)
  const scope = effectScope()
  const checker = app.runWithContext(
    () => scope.run(() => useUnitsChecker({ ...options, delay: 0 }))!,
  )
  return { ...checker, stop: () => scope.stop() }
}

describe('useUnitsChecker', () => {
  const sources = ref<UnitsSource[]>([
    { name: 'units.cellml', text: unitsFile({ mV: [['volt', 'milli']] }) },
  ])

  it('does nothing without the libcellml.js plugin', async () => {
    const checker = setup({
      lines: [line('x=t')],
      sources,
      variableUnits: { x: 'metre', t: 'second' },
    })
    await settled()
    expect(checker.available.value).toBe(false)
    expect(checker.ready.value).toBe(false)
    expect(checker.issues.value).toEqual([])
    // Missing units need no libCellML.
    expect(checker.missing.value).toEqual([])
    checker.stop()
  })

  it('waits for the plugin to load libcellml.js, then checks', async () => {
    const plugin = reactive<ProvidedLibCellML>({ status: 'loading', library: null })
    const checker = setup(
      { lines: [line('x=t')], sources, variableUnits: { x: 'metre', t: 'second' } },
      plugin,
    )
    expect(checker.available.value).toBe(true)
    expect(checker.ready.value).toBe(false)

    plugin.library = lc
    plugin.status = 'ready'
    await settled()
    expect(checker.ready.value).toBe(true)
    expect(checker.issues.value.map((issue) => issue.message)).toEqual([
      "Units don't match in x = t: x is in metre, t is in second",
    ])
    expect(checker.unitsNames.value).toContain('mV')
    expect(checker.unitsNames.value).toContain('volt')
    checker.stop()
  })

  it('checks again when the lines, the variables’ units or the units files change', async () => {
    const lines = ref([line('V=W')])
    const variableUnits = ref<VariableUnits>({ V: 'mV' })
    const checker = setup({ lines, sources, variableUnits }, lc)
    await settled()
    expect(checker.missing.value).toEqual(['W'])
    expect(checker.issues.value.map((issue) => issue.message)).toEqual(['W has no units'])

    variableUnits.value = { V: 'mV', W: 'millivolt' }
    await settled()
    expect(checker.issues.value.map((issue) => issue.message)).toEqual([
      'No units called millivolt are defined',
    ])

    sources.value = [
      ...sources.value,
      { name: 'more.cellml', text: unitsFile({ millivolt: [['volt', 'milli']] }) },
    ]
    await settled()
    expect(checker.issues.value).toEqual([])

    lines.value = [line('V=W+1')]
    await settled()
    expect(checker.issues.value).toHaveLength(1)
    expect(checker.issues.value[0]).toMatchObject({ lineId: 'line-1', numbers: [1] })
    checker.stop()
  })

  it('reports nothing until enabled', async () => {
    const enabled = ref(false)
    const checker = setup({ lines: [line('x=t')], sources, variableUnits: {}, enabled }, lc)
    await settled()
    expect(checker.checking.value).toBe(false)
    expect(checker.issues.value).toEqual([])

    enabled.value = true
    await settled()
    expect(checker.checking.value).toBe(true)
    expect(checker.issues.value.map((issue) => issue.message)).toEqual([
      'x has no units',
      't has no units',
    ])
    checker.stop()
  })

  it('reads the new units as one more units file, which it hands back', async () => {
    const newUnits = ref<UnitsDefinition[]>([])
    const checker = setup(
      {
        lines: [line('x=v*t')],
        sources,
        variableUnits: { x: 'km', v: 'km_per_h', t: 'hour' },
        newUnits,
      },
      lc,
    )
    await settled()
    expect(checker.newUnitsFile.value).toBe('')
    expect(checker.issues.value.map((issue) => issue.message)).toEqual([
      'No units called km are defined',
      'No units called km_per_h are defined',
      'No units called hour are defined',
    ])

    newUnits.value = [
      { name: 'km', parts: [{ prefix: 'kilo', units: 'metre' }] },
      { name: 'hour', parts: [{ units: 'second', multiplier: 3600 }] },
      { name: 'km_per_h', parts: [{ units: 'km' }, { units: 'hour', exponent: -1 }] },
    ]
    await settled()
    expect(checker.issues.value).toEqual([])
    expect(checker.unitsNames.value).toEqual(expect.arrayContaining(['km', 'hour', 'km_per_h']))
    expect(checker.files.value.at(-1)).toEqual({
      name: NEW_UNITS_SOURCE,
      units: ['km', 'hour', 'km_per_h'],
    })
    expect(checker.newUnitsFile.value).toContain('<units name="km_per_h">')
    checker.stop()
  })

  it('reports problems with the units files', async () => {
    const broken = ref([{ name: 'broken.cellml', text: unitsFile({ rate: [['per_hour']] }) }])
    const checker = setup({ lines: [], sources: broken, variableUnits: {} }, lc)
    await settled()
    expect(checker.problems.value).toEqual([
      { source: 'broken.cellml', message: '"rate" is made from "per_hour", which isn\'t defined' },
    ])
    checker.stop()
  })
})
