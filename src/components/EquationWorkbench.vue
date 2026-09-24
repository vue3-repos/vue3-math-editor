<script setup lang="ts">
// The equation workbench: a list of equation lines, each a MathField, plus a
// toolbar, undo/redo, "\" command mode and live output panels.
//
// State is one EditorState ({ root, cursor }) per line. MathField runs the
// per-key editing commands and emits the new state; the workbench records
// undo history (editor/history.ts: consecutive typing is one step) and
// handles what spans lines (Enter, ↑/↓ between lines, removing an empty
// line) and command mode. The semantic AST shown in the output panels is
// parsed from the active line's layout tree.
//
// Interface (see docs/component-interface.md):
// - `cellml` prop: CellML mode. The Content MathML (output panel and "Copy
//   as") declares the CellML namespace on <math> and gives every number
//   cellml:units (its own, or dimensionless). Off by default, so other
//   consumers get plain Content MathML.
// - `equations-change` event: every line (a stable id, its CellML-mode
//   Content MathML, the variables it uses, whether it's complete), whenever
//   any line's content changes. For a units checker outside the editor.
// - `issues` prop: units issues to underline, by line id and variable names.
// - `variableUnits` prop: each variable's units, shown on hover; with it,
//   numbers show their units on hover too.
import { computed, nextTick, ref, toRaw, watch } from 'vue'
import katex from 'katex'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Divider from 'primevue/divider'
import Menu from 'primevue/menu'
import Tab from 'primevue/tab'
import TabList from 'primevue/tablist'
import TabPanel from 'primevue/tabpanel'
import TabPanels from 'primevue/tabpanels'
import Tabs from 'primevue/tabs'
import Tag from 'primevue/tag'

import MathField, { type Mark, type NavigationState } from './MathField.vue'
import {
  type Command,
  type EditorState,
  emptyState,
  insertAbs,
  insertAtoms,
  insertCeiling,
  insertFloor,
  insertDerivative,
  insertPiecewise,
  insertFraction,
  insertFunction,
  insertNthRoot,
  insertSquareRoot,
  insertSuperscript,
  insertSymbol,
  namedCommand,
} from '../editor/commands'
import { cursorAtEnd, describeCursor } from '../editor/cursor'
import { EXPORT_FORMATS, type ExportFormat, contentMathML, exportRow } from '../editor/exports'
import { type EditInfo, History, OTHER_EDIT, undoGroup } from '../editor/history'
import {
  type EquationLine,
  type UnitsIssue,
  type VariableUnits,
  equationLine,
  unitsHintMarks,
  unitsIssueMarks,
} from '../editor/units'
import type { Row } from '../editor/layout'
import type { MathMLImport } from '../editor/mathmlImport'
import { settleState } from '../editor/numberUnits'
import { parseRow } from '../editor/parse'
import { describeSelection, selectedAtoms, selectionOf } from '../editor/selection'
import { renderMathJson } from '../renderers/mathjson'

const props = withDefaults(
  defineProps<{
    cellml?: boolean
    issues?: readonly UnitsIssue[]
    variableUnits?: VariableUnits
  }>(),
  { cellml: false, issues: () => [], variableUnits: undefined },
)

const emit = defineEmits<{
  'equations-change': [lines: EquationLine[]]
}>()

const exportOptions = computed(() => ({ cellml: props.cellml }))

const equations = ref<EditorState[]>([emptyState()])
// Each line's id, parallel to `equations`: stable while the line exists, so a
// host's issues stay on the right line when lines are added or removed.
let lineCount = 0
const newLineId = () => `line-${++lineCount}`
const lineIds = ref<string[]>([newLineId()])
const activeIndex = ref(0)
const fieldRefs = ref<Array<InstanceType<typeof MathField> | null>>([])

// Non-null while a "\..." command is being typed (Mathfield-style).
const commandBuffer = ref<string | null>(null)

function active(): EditorState {
  return equations.value[activeIndex.value]
}

// Every state is settled first: no cursor before a number's hidden units, and
// units no longer wanted removed (editor/numberUnits.ts).
function setEquation(index: number, state: EditorState) {
  equations.value[index] = settleState(state)
}

function focusActive() {
  void nextTick(() => fieldRefs.value[activeIndex.value]?.focus())
}

// ---------------------------------------------------------------------------
// History (undo/redo)
// ---------------------------------------------------------------------------

interface Snapshot {
  equations: EditorState[]
  lineIds: string[]
  active: number
}

const history = new History<Snapshot>()
// History isn't reactive; bumped whenever it changes, for canUndo/canRedo.
const historyVersion = ref(0)

function takeSnapshot(): Snapshot {
  return JSON.parse(
    JSON.stringify({
      equations: equations.value,
      lineIds: lineIds.value,
      active: activeIndex.value,
    }),
  ) as Snapshot
}

// Record the state before an edit to line `line` (default: a step of its own).
function pushHistory(line = activeIndex.value, info: EditInfo = OTHER_EDIT) {
  history.checkpoint(takeSnapshot, undoGroup(line, info))
  historyVersion.value++
}

function restore(snapshot: Snapshot | null) {
  if (!snapshot) return
  equations.value = snapshot.equations
  lineIds.value = snapshot.lineIds
  activeIndex.value = Math.min(snapshot.active, snapshot.equations.length - 1)
  historyVersion.value++
  focusActive()
}

const undo = () => restore(history.undo(takeSnapshot()))
const redo = () => restore(history.redo(takeSnapshot()))

const canUndo = computed(() => historyVersion.value >= 0 && history.canUndo)
const canRedo = computed(() => historyVersion.value >= 0 && history.canRedo)

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

function handleEdit(index: number, next: EditorState, info: EditInfo) {
  // A command that only moved the cursor (Space out of a fraction, Tab to
  // the next slot) is navigation, not an undo step.
  if (toRaw(next.root) === toRaw(equations.value[index].root)) {
    handleNavigate(index, { cursor: next.cursor, anchor: next.anchor ?? null })
    return
  }

  pushHistory(index, info)
  setEquation(index, next)
}

// Cursor moves and selection changes: not recorded in undo history, but the
// next edit starts a new undo step.
function handleNavigate(index: number, { cursor, anchor }: NavigationState) {
  history.breakGroup()
  setEquation(index, { ...equations.value[index], cursor, anchor })
}

// Pasted Content MathML: one equation (or expression) goes in at the caret,
// like any paste; several replace every line, one line each, as opening them
// would. Either way it is one undo step, and what couldn't be read is listed.
const importNotice = ref<{ message: string; problems: string[] } | null>(null)

function handleImport(index: number, result: MathMLImport) {
  const count = result.equations.length

  if (count === 1) {
    handleEdit(index, insertAtoms(result.equations[0])(equations.value[index]), OTHER_EDIT)
  } else if (count > 1) {
    pushHistory(index)
    equations.value = result.equations.map((root) =>
      settleState({ root, cursor: cursorAtEnd(root), anchor: null }),
    )
    lineIds.value = result.equations.map(() => newLineId())
    activeIndex.value = 0
    focusActive()
  }

  importNotice.value =
    count > 1 || result.problems.length
      ? {
          message:
            count > 1
              ? `Imported ${count} equations from Content MathML, replacing the lines there were.`
              : count === 1
                ? 'Imported the equation from Content MathML.'
                : 'Nothing was imported.',
          problems: result.problems,
        }
      : null
}

// Run a command on the active line (toolbar buttons, command mode).
function run(command: Command) {
  const state = active()
  const next = command(state)

  if (next !== state) {
    pushHistory()
    setEquation(activeIndex.value, next)
  }

  focusActive()
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

function addLineAfterActive() {
  pushHistory()
  const index = activeIndex.value + 1
  equations.value.splice(index, 0, emptyState())
  lineIds.value.splice(index, 0, newLineId())
  activeIndex.value = index
  focusActive()
}

function moveToLine(index: number) {
  if (index < 0 || index >= equations.value.length) return
  history.breakGroup()
  activeIndex.value = index
  focusActive()
}

function removeActiveLine() {
  if (equations.value.length <= 1) return

  pushHistory()
  equations.value.splice(activeIndex.value, 1)
  lineIds.value.splice(activeIndex.value, 1)
  activeIndex.value = Math.max(0, activeIndex.value - 1)
  // Continue at the end of the line above.
  const state = active()
  setEquation(activeIndex.value, { ...state, cursor: cursorAtEnd(state.root), anchor: null })
  focusActive()
}

// ---------------------------------------------------------------------------
// Keyboard: command mode and shortcuts (capture phase, before MathField)
// ---------------------------------------------------------------------------

function commitCommand() {
  const name = (commandBuffer.value ?? '').trim()
  commandBuffer.value = null
  if (name) run(namedCommand(name))
}

function handleCommandModeKey(event: KeyboardEvent) {
  if (/^[a-zA-Z0-9]$/.test(event.key)) {
    commandBuffer.value += event.key
  } else if (event.key === 'Backspace') {
    commandBuffer.value = commandBuffer.value ? commandBuffer.value.slice(0, -1) : null
  } else if (['Enter', ' ', 'Tab', '('].includes(event.key)) {
    commitCommand()
  } else if (event.key === 'Escape') {
    commandBuffer.value = null
  } else {
    return
  }

  event.preventDefault()
  event.stopPropagation()
}

function handleCaptureKeydown(event: KeyboardEvent) {
  // Keys in the host's side content (its own inputs) are its own.
  if ((event.target as Element | null)?.closest?.('[data-role="side"]')) return

  if (commandBuffer.value !== null) {
    handleCommandModeKey(event)
    return
  }

  if ((event.ctrlKey || event.metaKey) && !event.altKey) {
    const key = event.key.toLowerCase()

    if (key === 'z' || key === 'y') {
      event.preventDefault()
      event.stopPropagation()
      if (key === 'y' || event.shiftKey) redo()
      else undo()
    }

    return
  }

  if (event.key === '\\' && !event.altKey) {
    event.preventDefault()
    event.stopPropagation()
    commandBuffer.value = ''
  }
}

// ---------------------------------------------------------------------------
// Keyboard: keys MathField didn't use (bubble phase)
// ---------------------------------------------------------------------------

function handleUnusedKey(event: KeyboardEvent) {
  if (event.defaultPrevented) return

  switch (event.key) {
    case 'Enter':
      event.preventDefault()
      addLineAfterActive()
      return
    case 'ArrowUp':
      event.preventDefault()
      moveToLine(activeIndex.value - 1)
      return
    case 'ArrowDown':
      event.preventDefault()
      moveToLine(activeIndex.value + 1)
      return
    case 'Backspace':
      // Only reaches here when there is nothing left to delete on the line.
      if (active().root.length === 0) {
        event.preventDefault()
        removeActiveLine()
      }
      return
  }
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

interface ToolButton {
  latex: string
  title: string
  command: Command
}

const structureButtons: ToolButton[] = [
  { latex: '\\frac{a}{b}', title: 'Fraction  ( / )', command: insertFraction },
  { latex: 'x^{n}', title: 'Power  ( ^ )', command: insertSuperscript },
  { latex: '\\sqrt{x}', title: 'Square root  ( \\sqrt )', command: insertSquareRoot },
  { latex: '\\sqrt[n]{x}', title: 'nth root  ( \\root )', command: insertNthRoot },
  { latex: '|x|', title: 'Absolute value  ( | )', command: insertAbs },
  { latex: '\\lfloor x\\rfloor', title: 'Floor  ( floor( or \\floor )', command: insertFloor },
  { latex: '\\lceil x\\rceil', title: 'Ceiling  ( ceil( or \\ceil )', command: insertCeiling },
  {
    latex: '\\frac{\\mathrm{d}y}{\\mathrm{d}x}',
    title: 'Derivative  ( \\dd )',
    command: insertDerivative,
  },
  { latex: '\\sin', title: 'Sine  ( sin or \\sin )', command: insertFunction('sin') },
  {
    latex: '\\begin{cases}a&p\\\\b&q\\end{cases}',
    title: 'Piecewise  ( \\cases )',
    command: insertPiecewise,
  },
]

const operatorButtons: ToolButton[] = [
  { latex: '+', title: 'Add  ( + )', command: insertSymbol('+') },
  { latex: '-', title: 'Subtract  ( - )', command: insertSymbol('-') },
  { latex: '\\times', title: 'Multiply  ( * )', command: insertSymbol('·') },
  { latex: '=', title: 'Equals  ( = )', command: insertSymbol('=') },
]

// Constants (CellML's <pi/>, <exponentiale/>, <infinity/>).
const constantButtons: ToolButton[] = [
  { latex: '\\pi', title: 'Pi  ( \\pi )', command: insertSymbol('pi') },
  {
    latex: '\\mathrm{e}',
    title: "Euler's number e  ( \\e )",
    command: insertSymbol('exponentiale'),
  },
  { latex: '\\infty', title: 'Infinity  ( \\inf )', command: insertSymbol('infinity') },
]

// Comparisons and logic, for conditions.
const conditionButtons: ToolButton[] = [
  { latex: '<', title: 'Less than  ( < )', command: insertSymbol('<') },
  { latex: '\\leq', title: 'Less than or equal  ( <= or \\le )', command: insertSymbol('≤') },
  { latex: '>', title: 'Greater than  ( > )', command: insertSymbol('>') },
  {
    latex: '\\geq',
    title: 'Greater than or equal  ( >= or \\ge )',
    command: insertSymbol('≥'),
  },
  { latex: '\\neq', title: 'Not equal  ( != or \\ne )', command: insertSymbol('≠') },
  { latex: '\\land', title: 'And  ( & or \\and )', command: insertSymbol('∧') },
  { latex: '\\lor', title: 'Or  ( \\or )', command: insertSymbol('∨') },
  { latex: '\\lnot', title: 'Not  ( ! or \\not )', command: insertSymbol('¬') },
  { latex: '\\veebar', title: 'Exclusive or  ( \\xor )', command: insertSymbol('⊻') },
]

function buttonHtml(latex: string): string {
  return katex.renderToString(latex, { throwOnError: false, strict: 'ignore' })
}

// ---------------------------------------------------------------------------
// Output panels
// ---------------------------------------------------------------------------

// Every line is parsed: each line's diagnostics are marked in its field, and
// the active line's AST feeds the output panels. Results are cached by row, so
// moving the cursor (which keeps the row) doesn't re-parse or hand MathField
// new marks.
const parseCache = new WeakMap<Row, ReturnType<typeof parseRow>>()
function parseLine(root: Row) {
  if (root.length === 0) return null
  let result = parseCache.get(root)
  if (!result) {
    result = parseRow(root)
    parseCache.set(root, result)
  }
  return result
}
const parsedLines = computed(() => equations.value.map((equation) => parseLine(equation.root)))
const parsed = computed(() => parsedLines.value[activeIndex.value] ?? null)

// Each line's marks: its parse problems, the host's units issues for it, and
// units hints if the host gave variable units. Cached by row, and rebuilt
// when the issues or units change, so moving the cursor hands MathField the
// same array.
const issuesByLine = computed(() => {
  const byLine = new Map<string, UnitsIssue[]>()
  for (const issue of props.issues) {
    byLine.set(issue.lineId, [...(byLine.get(issue.lineId) ?? []), issue])
  }
  return byLine
})
const marksCache = computed(() => {
  // Read here so the cache is replaced when either changes.
  void issuesByLine.value
  void props.variableUnits
  return new WeakMap<Row, Mark[]>()
})
const lineMarks = computed(() =>
  equations.value.map((equation, index) => {
    const root = equation.root
    let marks = marksCache.value.get(root)
    if (!marks) {
      marks = [
        ...(parsedLines.value[index]?.diagnostics ?? []),
        ...unitsIssueMarks(root, issuesByLine.value.get(lineIds.value[index]) ?? []),
        ...unitsHintMarks(root, props.variableUnits ?? null),
      ]
      marksCache.value.set(root, marks)
    }
    return marks
  }),
)
const unitsIssues = computed(() => issuesByLine.value.get(lineIds.value[activeIndex.value]) ?? [])

// Every line for the `equations-change` event, emitted when any line's
// content (not just its cursor) changes.
const lineCache = new WeakMap<Row, EquationLine>()
const lines = computed(() =>
  equations.value.map((equation, index) => {
    const id = lineIds.value[index]
    let line = lineCache.get(equation.root)
    if (!line || line.id !== id) {
      line = equationLine(id, equation.root, parsedLines.value[index])
      lineCache.set(equation.root, line)
    }
    return line
  }),
)
let lastEmitted = ''
watch(
  lines,
  (current) => {
    const key = JSON.stringify(current)
    if (key === lastEmitted) return
    lastEmitted = key
    emit('equations-change', current)
  },
  { immediate: true },
)

const ast = computed(() => parsed.value?.ast ?? null)
const diagnostics = computed(() => parsed.value?.diagnostics ?? [])
// The same LaTeX as copying and "Copy as LaTeX" produce.
const latex = computed(() => (ast.value ? exportRow(active().root, 'latex') : ''))
const mathjson = computed(() => (ast.value ? renderMathJson(ast.value) : ''))
const mathml = computed(() => (ast.value ? contentMathML(active().root, exportOptions.value) : ''))
const cursorLabel = computed(() => describeCursor(active().cursor))
const selectionLabel = computed(() => {
  const selection = selectionOf(active())
  return selection ? describeSelection(selection) : null
})

const isCopyingMathJson = ref(false)
// The output tab showing: Content MathML first, as the output that matters most.
const outputTab = ref<'mathml' | 'mathjson' | 'latex' | 'ast'>('mathml')

function fallbackCopyText(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

async function writeClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    // Permission refused or not a secure context: fall back below.
  }

  fallbackCopyText(text)
}

async function copyMathJson() {
  if (!mathjson.value) return

  isCopyingMathJson.value = true

  try {
    await writeClipboard(mathjson.value)
  } finally {
    window.setTimeout(() => {
      isCopyingMathJson.value = false
    }, 1200)
  }
}

// ---------------------------------------------------------------------------
// Copy as LaTeX / MathJSON / Content MathML (toolbar menu)
// ---------------------------------------------------------------------------

const copyMenu = ref<InstanceType<typeof Menu> | null>(null)
// The format just copied, shown on the button for a moment.
const copiedFormat = ref<string | null>(null)
let copiedTimer: number | undefined

const hasSelection = computed(() => selectionOf(active()) !== null)
const canCopyAs = computed(() => active().root.length > 0)

const copyAsLabel = computed(() => {
  if (copiedFormat.value) return `Copied ${copiedFormat.value}`
  return hasSelection.value ? 'Copy selection as' : 'Copy as'
})

// The selection if there is one, otherwise the whole active equation.
async function copyAs(format: ExportFormat, label: string) {
  const state = active()
  const atoms = selectionOf(state) ? selectedAtoms(state) : state.root

  if (atoms.length > 0) {
    await writeClipboard(exportRow(atoms, format, exportOptions.value))
    copiedFormat.value = label
    window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => (copiedFormat.value = null), 1500)
  }

  focusActive()
}

const copyAsItems = computed(() =>
  EXPORT_FORMATS.map(({ format, label }) => {
    const shown = format === 'mathml' && props.cellml ? `${label} (CellML)` : label
    return { label: shown, command: () => copyAs(format, shown) }
  }),
)

function toggleCopyMenu(event: Event) {
  copyMenu.value?.toggle(event)
}
</script>

<template>
  <section
    class="editor-grid"
    :class="{ 'has-side': !!$slots.side }"
    @keydown.capture="handleCaptureKeydown"
  >
    <Card class="editor-card">
      <template #title>
        <div class="header-row">
          <span>Equation Builder</span>
          <Tag severity="info" value="AST First" />
        </div>
      </template>

      <template #subtitle>
        Type as you would write it; the structure is worked out as you go.
      </template>

      <template #content>
        <div class="toolbar">
          <div class="toolbar-group">
            <button
              v-for="item in structureButtons"
              :key="item.title"
              type="button"
              class="tool-button"
              :title="item.title"
              @mousedown.prevent
              @click="run(item.command)"
            >
              <span v-html="buttonHtml(item.latex)"></span>
            </button>
          </div>

          <div class="toolbar-group">
            <button
              v-for="item in operatorButtons"
              :key="item.title"
              type="button"
              class="tool-button tool-button-op"
              :title="item.title"
              @mousedown.prevent
              @click="run(item.command)"
            >
              <span v-html="buttonHtml(item.latex)"></span>
            </button>
          </div>

          <div class="toolbar-group" data-role="constant-buttons">
            <button
              v-for="item in constantButtons"
              :key="item.title"
              type="button"
              class="tool-button tool-button-op"
              :title="item.title"
              @mousedown.prevent
              @click="run(item.command)"
            >
              <span v-html="buttonHtml(item.latex)"></span>
            </button>
          </div>

          <div class="toolbar-group" data-role="condition-buttons">
            <button
              v-for="item in conditionButtons"
              :key="item.title"
              type="button"
              class="tool-button tool-button-op"
              :title="item.title"
              @mousedown.prevent
              @click="run(item.command)"
            >
              <span v-html="buttonHtml(item.latex)"></span>
            </button>
          </div>

          <div class="toolbar-group">
            <Button
              icon="pi pi-undo"
              size="small"
              text
              title="Undo (Ctrl+Z)"
              :disabled="!canUndo"
              @mousedown.prevent
              @click="undo"
            />
            <Button
              icon="pi pi-refresh"
              size="small"
              text
              title="Redo (Ctrl+Shift+Z)"
              :disabled="!canRedo"
              @mousedown.prevent
              @click="redo"
            />
            <Button
              icon="pi pi-plus"
              label="Line"
              size="small"
              text
              title="Add equation line (Enter)"
              @mousedown.prevent
              @click="addLineAfterActive"
            />
            <Button
              icon="pi pi-trash"
              size="small"
              text
              severity="danger"
              title="Remove equation line"
              :disabled="equations.length <= 1"
              @mousedown.prevent
              @click="removeActiveLine"
            />
          </div>

          <div class="toolbar-group">
            <Button
              icon="pi pi-copy"
              :label="copyAsLabel"
              size="small"
              text
              title="Copy the selection, or the whole equation, as LaTeX, MathJSON or Content MathML"
              aria-haspopup="true"
              aria-controls="copy-as-menu"
              data-role="copy-as"
              :disabled="!canCopyAs"
              @mousedown.prevent
              @click="toggleCopyMenu"
            />
            <Menu id="copy-as-menu" ref="copyMenu" :model="copyAsItems" :popup="true" />
          </div>
        </div>

        <Divider />

        <div class="equations-stack" @keydown="handleUnusedKey">
          <div
            v-for="(equation, index) in equations"
            :key="lineIds[index]"
            class="equation-row"
            :class="{ active: index === activeIndex }"
            :data-line="index"
            :data-line-id="lineIds[index]"
            @focusin="activeIndex = index"
          >
            <div class="equation-label">{{ index + 1 }}</div>

            <MathField
              :ref="(el) => (fieldRefs[index] = el as InstanceType<typeof MathField> | null)"
              class="equation-field"
              :model-value="equation.root"
              :cursor="equation.cursor"
              :anchor="equation.anchor ?? null"
              :active="index === activeIndex"
              :marks="lineMarks[index]"
              @navigate="handleNavigate(index, $event)"
              @edit="(state, info) => handleEdit(index, state, info)"
              @import="handleImport(index, $event)"
            />
          </div>
        </div>

        <div v-if="commandBuffer !== null" class="command-chip" data-role="command">
          <span class="command-slash">\</span>{{ commandBuffer }}<span class="command-caret"></span>
        </div>
        <p v-else class="focus-meta">
          Cursor: <span data-role="cursor">{{ cursorLabel }}</span>
          <template v-if="selectionLabel">
            · Selection: <span data-role="selection">{{ selectionLabel }}</span>
          </template>
        </p>

        <ul v-if="diagnostics.length" class="diagnostics" data-role="diagnostics">
          <li v-for="(problem, index) in diagnostics" :key="index">{{ problem.message }}</li>
        </ul>
        <div v-if="importNotice" class="import-notice" data-role="import-notice">
          <div class="import-notice-head">
            <span>{{ importNotice.message }}</span>
            <Button
              icon="pi pi-times"
              size="small"
              text
              rounded
              severity="secondary"
              aria-label="Dismiss"
              @mousedown.prevent
              @click="importNotice = null"
            />
          </div>
          <ul v-if="importNotice.problems.length">
            <li v-for="problem in importNotice.problems" :key="problem">{{ problem }}</li>
          </ul>
        </div>
        <ul v-if="unitsIssues.length" class="diagnostics units-issues" data-role="units-issues">
          <li v-for="(issue, index) in unitsIssues" :key="index">{{ issue.message }}</li>
        </ul>

        <details class="key-help" data-role="key-help">
          <summary>Keys and typing</summary>
          <p class="key-hint">
            <kbd>←</kbd><kbd>→</kbd> move through every position · <kbd>↑</kbd
            ><kbd>↓</kbd> numerator/denominator, else previous/next line · <kbd>Home</kbd
            ><kbd>End</kbd> start/end · <kbd>Tab</kbd> next empty slot · <kbd>Space</kbd> step out
            of a fraction, exponent or bracket · <kbd>Enter</kbd> new line (in a piecewise: new
            piece; <kbd>Backspace</kbd> in an empty piece removes it; <code>\otherwise</code> adds
            one)
          </p>
          <p class="key-hint">
            Select with <kbd>Shift</kbd>+<kbd>←</kbd><kbd>→</kbd>, <kbd>Shift</kbd>+<kbd>Home</kbd
            ><kbd>End</kbd>, <kbd>Ctrl</kbd>+<kbd>A</kbd> or by dragging · <code>/</code>,
            <code>^</code>, <code>(</code>, <code>|</code>, <code>\sqrt</code>, <code>\sin</code>, …
            or a toolbar button then wraps the selection · typing replaces it ·
            <kbd>Esc</kbd> clears it · <kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>X</kbd>/<kbd>V</kbd> copy,
            cut and paste (copies as LaTeX for other apps; pastes LaTeX or plain text such as
            <code>(x+1)/2</code>)
          </p>
          <p class="key-hint">
            Type letters, numbers and <code>+ − * = ,</code> where the caret is · conditions:
            <code>&lt; &gt; &lt;= &gt;= !=</code>, <code>&amp;</code> (∧), <code>!</code> (¬),
            <code>\or</code> (∨) · <code>/</code> makes a fraction of what's before the caret ·
            <code>^</code> exponent · <code>( )</code> and <code>| |</code> brackets ·
            <code>0.25{mV}</code> a number's units · letters, digits and <code>_</code> with no
            operator between them are one name (<code>Vm_init</code>); multiply names with
            <code>*</code> (<code>a*b</code>) · a name spelling a function (<code>sin</code>,
            <code>cosh</code>, …) is that function · <code>\</code> commands (<code
              >\frac \sqrt \root \abs \dd \cases \sin \pi \e \inf \alpha</code
            >
            …) · <kbd>Backspace</kbd>/<kbd>Delete</kbd> delete · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo
          </p>
        </details>
      </template>
    </Card>

    <!-- The host's side content, beside the editor (a units panel, say); the
         outputs then go under the editor. Without it, the outputs go beside. -->
    <aside v-if="$slots.side" class="side-column" data-role="side">
      <slot name="side" />
    </aside>

    <Card class="output-card" data-role="outputs">
      <template #content>
        <Tabs v-model:value="outputTab">
          <TabList>
            <Tab value="mathml" data-role="tab-mathml">
              Content MathML
              <Tag
                v-if="cellml"
                class="tab-tag"
                severity="secondary"
                value="CellML"
                data-role="cellml-mode"
              />
            </Tab>
            <Tab value="mathjson" data-role="tab-mathjson">MathJSON</Tab>
            <Tab value="latex" data-role="tab-latex">LaTeX</Tab>
            <Tab value="ast" data-role="tab-ast">AST</Tab>
          </TabList>
          <TabPanels>
            <TabPanel value="mathml">
              <pre data-role="mathml">{{ mathml }}</pre>
            </TabPanel>
            <TabPanel value="mathjson">
              <div class="output-actions">
                <Button
                  icon="pi pi-copy"
                  :label="isCopyingMathJson ? 'Copied' : 'Copy MathJSON'"
                  size="small"
                  text
                  :disabled="!mathjson"
                  @click="copyMathJson"
                />
              </div>
              <pre data-role="mathjson">{{ mathjson }}</pre>
            </TabPanel>
            <TabPanel value="latex">
              <pre data-role="latex">{{ latex }}</pre>
            </TabPanel>
            <TabPanel value="ast">
              <pre data-role="ast">{{ ast ? JSON.stringify(ast, null, 2) : '' }}</pre>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </template>
    </Card>
  </section>
</template>

<style scoped>
.editor-grid {
  max-width: 1240px;
  margin: 0 auto;
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  grid-template-areas: 'editor outputs';
  align-items: start;
  outline: none;
}

/* With side content: it takes the right, and the outputs go under the editor. */
.editor-grid.has-side {
  grid-template-rows: auto 1fr;
  grid-template-areas:
    'editor side'
    'outputs side';
}

.editor-card {
  grid-area: editor;
  min-width: 0;
}

.output-card {
  grid-area: outputs;
  min-width: 0;
}

.side-column {
  grid-area: side;
  align-self: start;
  position: sticky;
  top: 1rem;
  min-width: 0;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.preview-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.9rem;
}

.toolbar-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.tool-button {
  min-width: 2.6rem;
  height: 2.6rem;
  padding: 0.25rem 0.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #d7dde6;
  border-radius: 0.5rem;
  background: #ffffff;
  color: #0f172a;
  font-size: 0.82rem;
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    background 0.12s ease,
    box-shadow 0.12s ease;
}

.tool-button:hover {
  border-color: #2563eb;
  background: #eff6ff;
}

.tool-button:active {
  box-shadow: inset 0 1px 3px rgba(15, 23, 42, 0.15);
}

.tool-button-op {
  min-width: 2.2rem;
  height: 2.2rem;
  font-size: 0.95rem;
}

.equations-stack {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.equation-row {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
  border: 1px solid #e2e8f0;
  border-radius: 0.65rem;
  background: #ffffff;
  transition:
    border-color 0.12s ease,
    box-shadow 0.12s ease;
}

.equation-row.active {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.equation-label {
  display: flex;
  align-items: center;
  padding: 0 0.4rem 0 0.65rem;
  color: #94a3b8;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  border-right: 1px solid #f1f5f9;
}

.equation-field {
  flex: 1;
  min-width: 0;
}

/* The active line's border already shows focus. */
.equation-field.focused {
  box-shadow: none;
}

.command-chip {
  display: inline-flex;
  align-items: center;
  margin-top: 0.75rem;
  padding: 0.25rem 0.6rem;
  border-radius: 0.45rem;
  background: #0f172a;
  color: #e2e8f0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 0.9rem;
}

.command-slash {
  color: #7dd3fc;
}

.command-caret {
  width: 2px;
  height: 1em;
  margin-left: 2px;
  background: #e2e8f0;
  animation: chip-blink 1s step-end infinite;
}

@keyframes chip-blink {
  50% {
    opacity: 0;
  }
}

.focus-meta {
  margin: 0.75rem 0 0;
  color: #64748b;
  font-size: 0.8rem;
}

.diagnostics {
  margin: 0.5rem 0 0;
  padding: 0.4rem 0.6rem 0.4rem 1.6rem;
  border-radius: 0.45rem;
  background: #fef3c7;
  color: #92400e;
  font-size: 0.8rem;
}

.import-notice {
  margin: 0.5rem 0 0;
  padding: 0.35rem 0.6rem;
  border-radius: 0.5rem;
  background: #eff6ff;
  color: #1e3a8a;
  font-size: 0.8rem;
}

.import-notice-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.import-notice ul {
  margin: 0.2rem 0 0.1rem;
  padding-left: 1.1rem;
  color: #9a3412;
}

.units-issues {
  background: #ffedd5;
  color: #9a3412;
}

.output-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.25rem;
}

.tab-tag {
  margin-left: 0.4rem;
  font-size: 0.7rem;
  padding: 0.05rem 0.35rem;
}

.key-help {
  margin-top: 0.75rem;
}

.key-help summary {
  cursor: pointer;
  width: fit-content;
  color: #475569;
  font-size: 0.85rem;
}

.key-hint {
  margin: 0.5rem 0 0;
  color: #64748b;
  font-size: 0.8rem;
  line-height: 1.5;
}

.key-hint kbd {
  display: inline-block;
  padding: 0 0.3rem;
  margin: 0 0.08rem;
  border: 1px solid #cbd5e1;
  border-bottom-width: 2px;
  border-radius: 0.3rem;
  background: #f8fafc;
  font-size: 0.72rem;
  font-family: inherit;
}

.key-hint code {
  background: #f1f5f9;
  border-radius: 0.25rem;
  padding: 0.05rem 0.3rem;
}

.output-card pre {
  margin: 0;
  max-height: 28rem;
  overflow: auto;
  border-radius: 0.55rem;
  background: #0f172a;
  color: #e2e8f0;
  padding: 0.85rem;
  font-size: 0.83rem;
  line-height: 1.35;
}

@media (max-width: 900px) {
  .editor-grid,
  .editor-grid.has-side {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: none;
    grid-template-areas: 'editor' 'side' 'outputs';
  }

  .side-column {
    position: static;
  }
}
</style>
