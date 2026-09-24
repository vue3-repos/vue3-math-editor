# Component interface

How an application uses the equation editor, and how a units checker connects to it.
The editor is an equation editor first: it knows no more about units than the equations
themselves say (each number's units). Units checking is done outside it, by the host
application or a separate checker, and connects only through the props and event below.
Nothing here needs libCellML.

## `EquationWorkbench`

```vue
<EquationWorkbench
  cellml
  :issues="issues"
  :variable-units="variableUnits"
  @equations-change="lines = $event"
/>
```

### Props

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `cellml` | `boolean` | `false` | CellML mode for the Content MathML the user sees and copies: the CellML namespace is declared on `<math>`, and every number carries `cellml:units`. |
| `issues` | `UnitsIssue[]` | `[]` | Units problems to show. Each is underlined in amber on its line and listed under the equations when that line is active; the message shows on hover. |
| `variableUnits` | `Record<string, string>` | none | Each variable's units by name, shown on hover ("Vm: millivolt"). When given, numbers also show their units on hover ("0.25: dimensionless"). |

### Event

`equations-change` is emitted with every line whenever the content of any line changes
(not when only the cursor moves), and once when the workbench is created.

```ts
interface EquationLine {
  id: string          // stable for the line's lifetime: "line-1", "line-2", …
  mathml: string      // Content MathML in CellML mode, whatever the `cellml` prop
  variables: string[] // variable names used, in order of first use
  units: string[]     // units names given to numbers (dimensionless is not listed)
  complete: boolean   // not empty, no parse problems, no empty slots: ready to check
}
```

The MathML is always in CellML mode here, because that is what a units checker needs:
every number has `cellml:units`, its own if the user gave it units (`0.25{mV}`), otherwise
`dimensionless`. A line that isn't `complete` should not be sent for checking; its MathML
may contain empty slots (`<ci>_</ci>`).

### Issues

```ts
interface UnitsIssue {
  lineId: string                // the EquationLine id
  message: string               // shown on hover and in the list
  variables?: readonly string[] // underline every occurrence of these names in the line
  numbers?: readonly number[]   // underline these numbers (matched by value)
  units?: readonly string[]     // underline the numbers given these units (0.25{mV})
}
```

Issues are matched to lines by id, so they stay on the right line when lines are added or
removed above them. An issue naming nothing that appears in the line is listed but not
underlined.

The types are exported from `src/editor/units.ts`.

## Number units

Numbers are dimensionless unless the user gives them units, typed in braces straight after
the number: `0.25{mV}`, `1e-3{per_s}`. The units name is shown upright and grey after the
number. See [Writing equations](writing-equations.md).

## Connecting a units checker

A checker's job:

1. Keep the units definitions and each variable's units (from the user's CellML units
   files, or the host's own model).
2. On `equations-change`, check each `complete` line's MathML against them.
3. Pass the problems back as `issues`, and the variables' units as `variableUnits`.

`src/units/` is such a checker, using libCellML. It is optional and separate from the
editor: nothing in it imports libcellml.js, which the host provides.

### With the vue3-libcellml.js plugin

```ts
// main.ts
import libcellmlPlugin from 'vue3-libcellml.js'
app.use(libcellmlPlugin)
```

```vue
<script setup lang="ts">
import { ref } from 'vue'
import EquationWorkbench from './components/EquationWorkbench.vue'
import type { EquationLine, VariableUnits } from './editor/units'
import type { UnitsSource } from './units/library'
import { useUnitsChecker } from './units/useUnitsChecker'

const lines = ref<EquationLine[]>([])
const sources = ref<UnitsSource[]>([]) // { name, text } of each CellML units file
const variableUnits = ref<VariableUnits>({})

const { issues, problems, missing, unitsNames, available, ready } = useUnitsChecker({
  lines,
  sources,
  variableUnits,
})
</script>

<template>
  <EquationWorkbench
    cellml
    :issues="issues"
    :variable-units="variableUnits"
    @equations-change="lines = $event"
  />
</template>
```

`useUnitsChecker` injects `$libcellml` from the plugin. Without the plugin, `available`
is false and `issues` stays empty; nothing else changes. With it, checking starts once
libcellml.js has loaded (`ready`), and runs again 300 ms (`delay`) after the lines or
the variables' units change, or at once when the units files change (replace the
`sources` array to reload them). A line's result is cached by its MathML and its
variables' units, so only edited lines are analysed again.

| Returned | Meaning |
|---|---|
| `issues` | For the workbench's `issues` prop |
| `problems` | `{ source, message }[]`: problems reading the units files (unreadable, a name defined twice differently, units made from undefined units, imports) |
| `missing` | Variables used in the equations that have no units yet |
| `unitsNames` | Every units name the equations can use: built in, then the files' |
| `available`, `ready` | libcellml.js is provided; it has loaded |
| `check()` | Check now rather than after the delay |

To pass libcellml.js in directly instead of injecting it, give the loaded module as the
`libcellml` option.

### Without Vue

```ts
import { UnitsLibrary } from './units/library'
import { UnitsChecker } from './units/check'

const library = UnitsLibrary.load(libcellml, sources)
const checker = new UnitsChecker(libcellml, library)
const issues = checker.check(lines, variableUnits)
// When done with them: checker.dispose(); library.dispose()
```

The issues the checker reports:

| Problem | Message (example) | Underlined |
|---|---|---|
| A variable without units | `x has no units` | the variable |
| An undefined units name | `No units called furlong are defined` | variables and numbers using it |
| Units that don't match | `Units don't match in t+2.0: t is in second, 2.0 is in dimensionless` | the variables at fault, or the numbers where there are none |
| An argument that must be dimensionless | `t in exp(t) must be dimensionless, but is in second` | the variable |

Units that differ only in scale (`mV` and `volt`) don't match. Lines that aren't
`complete` aren't checked. See *Units checking* in [the design](design.md) for how it
works.
