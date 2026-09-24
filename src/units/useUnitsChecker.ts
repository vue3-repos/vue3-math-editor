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
import { standardUnitsNames, type LibCellML } from './libcellml'
import { UnitsLibrary, type UnitsSource } from './library'

export const LIBCELLML_KEY = '$libcellml'

// What vue3-libcellml.js provides.
export interface ProvidedLibCellML {
  status: string // 'loading' | 'ready'
  library: LibCellML | null
}

export interface UnitsCheckerOptions {
  // The workbench's lines, from its equations-change event.
  lines: MaybeRefOrGetter<readonly EquationLine[]>
  // The user's CellML units files. Replace the array to reload them.
  sources: MaybeRefOrGetter<readonly UnitsSource[]>
  // Each variable's units, by name.
  variableUnits: MaybeRefOrGetter<VariableUnits>
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

  const lc = computed(() => loaded(provided))
  // libcellml.js is there (it may still be loading).
  const available = computed(() => provided !== null)
  const ready = computed(() => lc.value !== null)

  const library = shallowRef<UnitsLibrary | null>(null)
  const issues = shallowRef<UnitsIssue[]>([])
  let checker: UnitsChecker | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const check = () => {
    clearTimeout(timer)
    timer = undefined
    issues.value = checker
      ? checker.check(toValue(options.lines), toValue(options.variableUnits))
      : []
  }

  const close = () => {
    checker?.dispose()
    library.value?.dispose()
    checker = null
    library.value = null
  }

  watch(
    [lc, () => toValue(options.sources)],
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
    issues,
    // Problems reading the units files.
    problems: computed(() => library.value?.problems ?? []),
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
