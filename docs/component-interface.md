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

libCellML's analyser does step 2 (see *Units checking* in [the design](design.md)). With a
checker in place the editor behaves as before; without one, it is a plain equation editor.
