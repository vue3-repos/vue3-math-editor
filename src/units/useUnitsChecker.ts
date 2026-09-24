// Units checking for a Vue app, using libcellml.js if the app provides it.
//
// The vue3-libcellml.js plugin provides the loaded library under
// '$libcellml' as a reactive { status, library }. Without the plugin there is
// no units checking: `available` is false and `issues` stays empty, and the
// equation editor works as it always does.
//
//   const { issues } = useUnitsChecker({ lines, sources, variableUnits })
//   <EquationWorkbench :issues="issues" :variable-units="variableUnits"
//     @equations-change="lines = $event" />

import {
  computed,
  inject,
  onScopeDispose,
  shallowRef,
  toRaw,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue'

import type { EquationLine, UnitsIssue, VariableUnits } from '../editor/units'
import { UnitsChecker, missingUnits } from './check'
import { NEW_UNITS_SOURCE, type UnitsDefinition, newUnitsFile } from './definitions'
import { standardUnitsNames, type LibCellML } from './libcellml'
import { UnitsLibrary, type UnitsSource } from './library'

export const LIBCELLML_KEY = '$libcellml'

// What vue3-libcellml.js provides.
export interface ProvidedLibCellML {
  status: string // 'loading' | 'ready'
  library: LibCellML | null
}

// No libcellml.js; libcellml.js loading; checking.
export type UnitsCheckerStatus = 'unavailable' | 'loading' | 'ready'

export interface UnitsCheckerOptions {
  // The workbench's lines, from its equations-change event.
  lines: MaybeRefOrGetter<readonly EquationLine[]>
  // The user's CellML units files. Replace the array to reload them.
  sources: MaybeRefOrGetter<readonly UnitsSource[]>
  // Each variable's units, by name.
  variableUnits: MaybeRefOrGetter<VariableUnits>
  // Units the user has defined (units panel), read as one more units file.
  newUnits?: MaybeRefOrGetter<readonly UnitsDefinition[]>
  // Whether to check (default: always). An application can wait until the
  // user has given some units, so that a user who isn't using units doesn't
  // see every variable reported as having none.
  enabled?: MaybeRefOrGetter<boolean>
  // How long after the last change to check, in ms.
  delay?: number
  // libcellml.js itself (loaded, or as the plugin provides it), instead of
  // injecting it from the plugin.
  libcellml?: LibCellML | ProvidedLibCellML | null
}

export function useUnitsChecker(options: UnitsCheckerOptions) {
  const provided =
    options.libcellml !== undefined
      ? options.libcellml
      : inject<LibCellML | ProvidedLibCellML | null>(LIBCELLML_KEY, null)
  const delay = options.delay ?? 300
  const enabled = computed(() => toValue(options.enabled) ?? true)

  const lc = computed(() => loaded(provided))
  // libcellml.js is there (it may still be loading).
  const available = computed(() => provided !== null)
  const ready = computed(() => lc.value !== null)
  const status = computed<UnitsCheckerStatus>(() =>
    ready.value ? 'ready' : available.value ? 'loading' : 'unavailable',
  )

  const library = shallowRef<UnitsLibrary | null>(null)
  const issues = shallowRef<UnitsIssue[]>([])
  let checker: UnitsChecker | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const check = () => {
    clearTimeout(timer)
    timer = undefined
    issues.value =
      checker && enabled.value
        ? checker.check(toValue(options.lines), toValue(options.variableUnits))
        : []
  }

  const close = () => {
    checker?.dispose()
    library.value?.dispose()
    checker = null
    library.value = null
  }

  // The new units as a units-only CellML file, for the host to keep.
  const newUnitsText = computed(() => {
    const definitions = toValue(options.newUnits) ?? []
    return definitions.length ? newUnitsFile(definitions) : ''
  })

  watch(
    [
      lc,
      () => [
        ...toValue(options.sources),
        ...(newUnitsText.value ? [{ name: NEW_UNITS_SOURCE, text: newUnitsText.value }] : []),
      ],
    ],
    ([lib, sources]) => {
      close()
      if (lib) {
        library.value = UnitsLibrary.load(lib, sources)
        checker = new UnitsChecker(lib, library.value)
      }
      check()
    },
    { immediate: true },
  )

  watch(enabled, () => check())

  watch([() => toValue(options.lines), () => toValue(options.variableUnits)], () => {
    clearTimeout(timer)
    timer = setTimeout(check, delay)
  })

  onScopeDispose(() => {
    clearTimeout(timer)
    close()
  })

  return {
    available,
    ready,
    status,
    // Ready, and enabled: issues are being reported.
    checking: computed(() => ready.value && enabled.value),
    issues,
    // The units files as read: each one's name and the units kept from it
    // (the new units last, as NEW_UNITS_SOURCE).
    files: computed(() => library.value?.sources ?? []),
    // Problems reading the units files (source NEW_UNITS_SOURCE for the new
    // units).
    problems: computed(() => library.value?.problems ?? []),
    // The new units as a CellML file holding only them ('' if there are none).
    newUnitsFile: newUnitsText,
    // Every units name the equations can use: built in, then the files'.
    unitsNames: computed(() =>
      lc.value && library.value ? [...standardUnitsNames(lc.value), ...library.value.names] : [],
    ),
    // Variables used in the lines that have no units yet.
    missing: computed(() => {
      const variableUnits = toValue(options.variableUnits)
      return [
        ...new Set(toValue(options.lines).flatMap((line) => missingUnits(line, variableUnits))),
      ]
    }),
    // Check now rather than after the delay.
    check,
  }
}

function loaded(provided: LibCellML | ProvidedLibCellML | null): LibCellML | null {
  if (!provided) return null
  if ('Parser' in provided) return toRaw(provided)
  // The plugin's state is reactive; the library needn't be.
  return provided.status === 'ready' && provided.library ? toRaw(provided.library) : null
}
