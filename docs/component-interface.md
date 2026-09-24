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
| `variableUnits` | `Record<string, string>` | none | Each variable's units by name, shown on hover ("Vm: millivolt"). When given, numbers without units also show theirs on hover ("2: dimensionless"); numbers with units always do ("0.25: mV"). |

### Slot

`side` is shown beside the equation editor, on the right, and stays in view as the page
scrolls: the place for a units panel (see below). With it, the outputs (Content MathML,
MathJSON, LaTeX and the AST, in tabs, Content MathML first) go under the editor; without
it, they go beside it. On a narrow screen everything stacks: editor, side, outputs. Keys
typed in the side content are left alone by the workbench, so `\` and Ctrl+Z work there
as in any input.

### Event

`equations-change` is emitted with every line whenever the content of any line changes
(not when only the cursor moves), and once when the workbench is created.

```ts
interface EquationLine {
  id: string          // stable for the line's lifetime: "line-1", "line-2", …
  mathml: string      // Content MathML in CellML mode, whatever the `cellml` prop
  variables: string[] // variable names used, in order of first use
  units: string[]     // units names given to numbers (dimensionless is not listed)
  complete: boolean   // not empty, no parse problems, no empty slots, no units being typed
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
the number: `0.25{mV}`, `1e-3{per_s}`. The units show (light blue) while being typed, then
are hidden, leaving a very small light-blue triangle on the number: pointing at it shows
them ("0.25: mV"), and they are always in the line's MathML.
Units an issue names (`units` in a `UnitsIssue`) are shown, underlined; an issue naming a
number by value underlines only the number. See [Writing equations](writing-equations.md).

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
import type { UnitsDefinition } from './units/definitions'
import type { UnitsSource } from './units/library'
import { useUnitsChecker } from './units/useUnitsChecker'

const lines = ref<EquationLine[]>([])
const sources = ref<UnitsSource[]>([]) // { name, text } of each CellML units file
const variableUnits = ref<VariableUnits>({})
const newUnits = ref<UnitsDefinition[]>([]) // units the user defines

const { issues, problems, missing, unitsNames, status, newUnitsFile } = useUnitsChecker({
  lines,
  sources,
  variableUnits,
  newUnits,
  // Optional: only report once the user has given some units.
  enabled: () => sources.value.length > 0 || Object.keys(variableUnits.value).length > 0,
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
| `files` | Each units file as read: its name and the units kept from it (the new units last, as `'new units'`) |
| `newUnitsFile` | The new units as a CellML 2.0 file holding only them (`''` if there are none) |
| `status` | `'unavailable'` (no libcellml.js), `'loading'` or `'ready'` |
| `available`, `ready` | libcellml.js is provided; it has loaded |
| `checking` | Ready and `enabled`: issues are being reported |
| `check()` | Check now rather than after the delay |

To pass libcellml.js in directly instead of injecting it, give the loaded module as the
`libcellml` option.

`newUnits` (optional) are units the user has defined, as plain data; the checker reads
them as one more units file, generated from them (`newUnitsFile` in
`src/units/definitions.ts`), so equations can use them straight away.

`enabled` (default: always) lets an application hold off until units are in use. Without
it, a user who writes equations without units sees every variable reported as having
none; the demo checks once a units file is loaded or any variable has units.

### The units panel

`UnitsPanel` (`src/units/UnitsPanel.vue`) is a ready-made panel for all this, meant for
the workbench's `side` slot. It shows the checker's status, loads units files
(any CellML file; only its units are kept), lists each file's units and problems, and
lets the user define new units, and lists the variables the equations use, with an
input for each one's units (suggesting the known units names, and marking missing and
unknown units). It takes the checker's
results as props and hands edits back through `v-model`; like the rest of `src/units/`,
it never imports libcellml.js, and without it still lets the user give units, which the
workbench then shows on hover.

```vue
<EquationWorkbench :issues="issues" :variable-units="variableUnits" @equations-change="lines = $event">
  <template #side>
    <UnitsPanel
      v-model:sources="sources"
      v-model:variable-units="variableUnits"
      v-model:new-units="newUnits"
      :lines="lines"
      :status="status"
      :checking="checking"
      :files="files"
      :problems="problems"
      :units-names="unitsNames"
      :issues="issues"
    >
      <!-- optional: more buttons beside "Load units files" -->
      <template #actions>…</template>
      <!-- optional: beside "Define units", e.g. to save the new units file -->
      <template #new-units-actions="{ definitions }">…</template>
    </UnitsPanel>
  </template>
</EquationWorkbench>
```

A units input's value is taken when it changes (Enter, or leaving the input), so a
half-typed name isn't checked.

### New units

Units the user defines are kept apart from the units files they loaded, which are never
changed. The panel's **Define units** form takes a name and what the units are made of:
parts, each a units name with an optional prefix (milli, micro, …), exponent and
multiplier, as a CellML `<unit>`. It checks the name is a CellML name that isn't taken,
that the parts are known units, and that no units end up made of themselves. New units
can be changed (a rename follows through the other new units) and removed (unless other
new units are made of them).

```ts
interface UnitsDefinition {
  name: string
  parts: { units: string; prefix?: string; exponent?: number; multiplier?: number }[]
}
```

The definitions are the host's (`v-model:new-units`), to keep with its own data. To
retrieve them as CellML, `newUnitsFile(definitions)` (or the checker's `newUnitsFile`)
writes a CellML 2.0 model holding only them, units used by others first:

```xml
<model xmlns="http://www.cellml.org/cellml/2.0#" name="new_units">
  <units name="mV_per_ms">
    <unit prefix="milli" units="volt"/>
    <unit prefix="milli" units="second" exponent="-1"/>
  </units>
</model>
```

That file loads again as a units file like any other. The demo saves it with a Download
button (`new-units.cellml`) in the `new-units-actions` slot. Writing and checking the
definitions doesn't need libCellML; without it, only the names used can't be checked.

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
| Units that don't match | `Units don't match in t+2.0: t is in second, 2.0 is dimensionless` | the variables at fault, or the numbers where there are none |
| An argument that must be dimensionless | `t in exp(t) must be dimensionless, but is in second` | the variable |

Variables without units are reported first, then undefined units names; a line with
either isn't analysed further. Units that differ only in scale (`mV` and `volt`) don't
match. Lines that aren't
`complete` aren't checked. See *Units checking* in [the design](design.md) for how it
works.
