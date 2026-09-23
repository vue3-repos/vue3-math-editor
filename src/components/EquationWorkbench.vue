<script setup lang="ts">
// The equation workbench: a list of equation lines, each a MathField, plus a
// toolbar, undo/redo, "\" command mode and live output panels.
//
// State is one EditorState ({ root, cursor }) per line. MathField runs the
// per-key editing commands and emits the new state; the workbench records
// undo history and handles what spans lines (Enter, ↑/↓ between lines,
// removing an empty line) and command mode. The semantic AST shown in the
// output panels is parsed from the active line's layout tree.
import { computed, nextTick, ref } from 'vue'
import katex from 'katex'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Divider from 'primevue/divider'
import Tag from 'primevue/tag'

import MathField from './MathField.vue'
import {
  type Command,
  type EditorState,
  emptyState,
  insertAbs,
  insertDerivative,
  insertFraction,
  insertFunction,
  insertNthRoot,
  insertSquareRoot,
  insertSuperscript,
  insertSymbol,
  namedCommand,
} from '../editor/commands'
import { type Cursor, cursorAtEnd, describeCursor } from '../editor/cursor'
import { parseRow } from '../editor/parse'
import { astToLatex } from '../renderers/latex'
import { renderMathJson } from '../renderers/mathjson'
import { astToContentMathML } from '../renderers/mathml'

const equations = ref<EditorState[]>([emptyState()])
const activeIndex = ref(0)
const fieldRefs = ref<Array<InstanceType<typeof MathField> | null>>([])

// Non-null while a "\..." command is being typed (Mathfield-style).
const commandBuffer = ref<string | null>(null)

function active(): EditorState {
  return equations.value[activeIndex.value]
}

function setEquation(index: number, state: EditorState) {
  equations.value[index] = state
}

function focusActive() {
  void nextTick(() => fieldRefs.value[activeIndex.value]?.focus())
}

// ---------------------------------------------------------------------------
// History (undo/redo)
// ---------------------------------------------------------------------------

interface Snapshot {
  equations: EditorState[]
  active: number
}

const undoStack = ref<Snapshot[]>([])
const redoStack = ref<Snapshot[]>([])

function takeSnapshot(): Snapshot {
  return JSON.parse(
    JSON.stringify({ equations: equations.value, active: activeIndex.value }),
  ) as Snapshot
}

function pushHistory() {
  undoStack.value.push(takeSnapshot())
  if (undoStack.value.length > 200) undoStack.value.shift()
  redoStack.value = []
}

function restore(snapshot: Snapshot) {
  equations.value = snapshot.equations
  activeIndex.value = Math.min(snapshot.active, snapshot.equations.length - 1)
  focusActive()
}

function undo() {
  const snapshot = undoStack.value.pop()
  if (!snapshot) return
  redoStack.value.push(takeSnapshot())
  restore(snapshot)
}

function redo() {
  const snapshot = redoStack.value.pop()
  if (!snapshot) return
  undoStack.value.push(takeSnapshot())
  restore(snapshot)
}

const canUndo = computed(() => undoStack.value.length > 0)
const canRedo = computed(() => redoStack.value.length > 0)

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

function handleEdit(index: number, next: EditorState) {
  pushHistory()
  setEquation(index, next)
}

function handleCursor(index: number, cursor: Cursor) {
  setEquation(index, { ...equations.value[index], cursor })
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
  activeIndex.value = index
  focusActive()
}

function moveToLine(index: number) {
  if (index < 0 || index >= equations.value.length) return
  activeIndex.value = index
  focusActive()
}

function removeActiveLine() {
  if (equations.value.length <= 1) return

  pushHistory()
  equations.value.splice(activeIndex.value, 1)
  activeIndex.value = Math.max(0, activeIndex.value - 1)
  // Continue at the end of the line above.
  const state = active()
  setEquation(activeIndex.value, { ...state, cursor: cursorAtEnd(state.root) })
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
  {
    latex: '\\frac{\\mathrm{d}y}{\\mathrm{d}x}',
    title: 'Derivative  ( \\dd )',
    command: insertDerivative,
  },
  { latex: '\\sin', title: 'Sine  ( sin or \\sin )', command: insertFunction('sin') },
]

const operatorButtons: ToolButton[] = [
  { latex: '+', title: 'Add  ( + )', command: insertSymbol('+') },
  { latex: '-', title: 'Subtract  ( - )', command: insertSymbol('-') },
  { latex: '\\times', title: 'Multiply  ( * )', command: insertSymbol('·') },
  { latex: '=', title: 'Equals  ( = )', command: insertSymbol('=') },
]

function buttonHtml(latex: string): string {
  return katex.renderToString(latex, { throwOnError: false, strict: 'ignore' })
}

// ---------------------------------------------------------------------------
// Output panels
// ---------------------------------------------------------------------------

const parsed = computed(() => {
  const root = active().root
  return root.length > 0 ? parseRow(root) : null
})

const ast = computed(() => parsed.value?.ast ?? null)
const diagnostics = computed(() => parsed.value?.diagnostics ?? [])
const latex = computed(() => (ast.value ? astToLatex(ast.value) : ''))
const mathjson = computed(() => (ast.value ? renderMathJson(ast.value) : ''))
const mathml = computed(() => (ast.value ? astToContentMathML(ast.value).trim() : ''))
const cursorLabel = computed(() => describeCursor(active().cursor))

const isCopyingMathJson = ref(false)

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

async function copyMathJson() {
  if (!mathjson.value) return

  isCopyingMathJson.value = true

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(mathjson.value)
      return
    }

    fallbackCopyText(mathjson.value)
  } finally {
    window.setTimeout(() => {
      isCopyingMathJson.value = false
    }, 1200)
  }
}
</script>

<template>
  <section class="editor-grid" @keydown.capture="handleCaptureKeydown">
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
        </div>

        <Divider />

        <div class="equations-stack" @keydown="handleUnusedKey">
          <div
            v-for="(equation, index) in equations"
            :key="index"
            class="equation-row"
            :class="{ active: index === activeIndex }"
            :data-line="index"
            @focusin="activeIndex = index"
          >
            <div class="equation-label">{{ index + 1 }}</div>

            <MathField
              :ref="(el) => (fieldRefs[index] = el as InstanceType<typeof MathField> | null)"
              class="equation-field"
              :model-value="equation.root"
              :cursor="equation.cursor"
              :active="index === activeIndex"
              @update:cursor="handleCursor(index, $event)"
              @edit="handleEdit(index, $event)"
            />
          </div>
        </div>

        <div v-if="commandBuffer !== null" class="command-chip" data-role="command">
          <span class="command-slash">\</span>{{ commandBuffer }}<span class="command-caret"></span>
        </div>
        <p v-else class="focus-meta">
          Cursor: <span data-role="cursor">{{ cursorLabel }}</span>
        </p>

        <ul v-if="diagnostics.length" class="diagnostics" data-role="diagnostics">
          <li v-for="(problem, index) in diagnostics" :key="index">{{ problem.message }}</li>
        </ul>

        <p class="key-hint">
          <kbd>←</kbd><kbd>→</kbd> move through every position · <kbd>↑</kbd
          ><kbd>↓</kbd> numerator/denominator, else previous/next line · <kbd>Home</kbd
          ><kbd>End</kbd> start/end · <kbd>Tab</kbd> next empty slot · <kbd>Space</kbd> step out of
          a fraction, exponent or bracket · <kbd>Enter</kbd> new line
        </p>
        <p class="key-hint">
          Type letters, numbers and <code>+ − * = ,</code> where the caret is · <code>/</code> makes
          a fraction of what's before the caret · <code>^</code> exponent · <code>( )</code> and
          <code>| |</code> brackets · <code>sin</code>, <code>cos</code>, … become functions ·
          <code>\</code> commands (<code>\frac \sqrt \root \abs \dd \sin \alpha</code> …) ·
          <kbd>Backspace</kbd>/<kbd>Delete</kbd> delete · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo
        </p>
      </template>
    </Card>

    <Card class="output-card" aria-labelledby="ast-preview-title">
      <template #title>
        <div id="ast-preview-title">AST Preview</div>
      </template>
      <template #content>
        <pre data-role="ast">{{ ast ? JSON.stringify(ast, null, 2) : '' }}</pre>
      </template>
    </Card>

    <Card class="output-card" aria-labelledby="mathml-preview-title">
      <template #title>
        <div id="mathml-preview-title">Content MathML</div>
      </template>
      <template #content>
        <pre data-role="mathml">{{ mathml }}</pre>
      </template>
    </Card>

    <Card class="output-card" aria-labelledby="mathjson-preview-title">
      <template #title>
        <div class="preview-title-row">
          <div id="mathjson-preview-title">MathJSON</div>
          <Button
            icon="pi pi-copy"
            :label="isCopyingMathJson ? 'Copied' : 'Copy MathJSON'"
            size="small"
            outlined
            :disabled="!mathjson"
            @click="copyMathJson"
          />
        </div>
      </template>
      <template #content>
        <pre data-role="mathjson">{{ mathjson }}</pre>
      </template>
    </Card>

    <Card class="output-card" aria-labelledby="latex-preview-title">
      <template #title>
        <div id="latex-preview-title">LaTeX</div>
      </template>
      <template #content>
        <pre data-role="latex">{{ latex }}</pre>
      </template>
    </Card>
  </section>
</template>

<style scoped>
.editor-grid {
  max-width: 1100px;
  margin: 0 auto;
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  align-items: start;
  outline: none;
}

.editor-card {
  grid-row: span 3;
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
  overflow: auto;
  border-radius: 0.55rem;
  background: #0f172a;
  color: #e2e8f0;
  padding: 0.85rem;
  font-size: 0.83rem;
  line-height: 1.35;
}

@media (max-width: 900px) {
  .editor-grid {
    grid-template-columns: 1fr;
  }

  .editor-card {
    grid-row: auto;
  }
}
</style>
