<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import katex from 'katex'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Divider from 'primevue/divider'
import Tag from 'primevue/tag'

import EquationEditor from './EquationEditor.vue'

import {
  collapseSelection,
  fallbackFocusAfterDelete,
  getNodeAtPath,
  getNextPlaceholderPath,
  insertAddAtPath,
  insertDerivativeAtPath,
  insertEqualAtPath,
  insertFractionAtPath,
  insertMultiplyAtPath,
  insertPowerAtPath,
  isPlaceholderAtPath,
  replaceFocusedNode,
  replaceNodeWithPlaceholder,
  resolveCommandPath,
  unwrapNodeAtPath,
} from '../editor/commands'
import { astToLatex } from '../renderers/latex'
import { astToContentMathML } from '../renderers/mathml'
import type { AstNode } from '../types/ast'
import type { EditorState, NodePath } from '../types/editor'

const viewMode = ref<'edit' | 'display'>('edit')

function createEditorState(ast: AstNode | null = null): EditorState {
  return {
    ast,
    focusedPath: [],
    selection: {
      anchor: [],
      focus: [],
    },
    mode: 'insert',
  }
}

const editorStates = ref<EditorState[]>([createEditorState()])
const activeEquationIndex = ref(0)

const editorSurface = ref<HTMLElement | null>(null)

function currentState(): EditorState {
  return editorStates.value[activeEquationIndex.value]
}

function applyCommandResult(result: { ast: AstNode; focusedPath: NodePath }) {
  const state = currentState()
  state.ast = result.ast
  state.focusedPath = result.focusedPath
  state.selection = collapseSelection(result.focusedPath)
}

function rootAstForCommand(): AstNode {
  const state = currentState()

  if (state.ast) {
    return state.ast
  }

  return { type: 'Placeholder' }
}

function insertFraction() {
  const path = resolveCommandPath(currentState().focusedPath)
  const result = insertFractionAtPath(rootAstForCommand(), path)
  applyCommandResult(result)
}

function insertAdd() {
  const path = resolveCommandPath(currentState().focusedPath)
  const result = insertAddAtPath(rootAstForCommand(), path)
  applyCommandResult(result)
}

function insertMultiply() {
  const path = resolveCommandPath(currentState().focusedPath)
  const result = insertMultiplyAtPath(rootAstForCommand(), path)
  applyCommandResult(result)
}

function insertEqual() {
  const path = resolveCommandPath(currentState().focusedPath)
  const result = insertEqualAtPath(rootAstForCommand(), path)
  applyCommandResult(result)
}

function insertPower() {
  const path = resolveCommandPath(currentState().focusedPath)
  const result = insertPowerAtPath(rootAstForCommand(), path)
  applyCommandResult(result)
}

function insertDerivative() {
  const path = resolveCommandPath(currentState().focusedPath)
  const result = insertDerivativeAtPath(rootAstForCommand(), path)
  applyCommandResult(result)
}

function unwrapFocusedNode() {
  const state = currentState()

  if (!state.ast) {
    return
  }

  const path = resolveCommandPath(state.focusedPath)
  const result = unwrapNodeAtPath(state.ast, path)
  applyCommandResult(result)
}

function setActiveEquation(index: number) {
  activeEquationIndex.value = index

  const activeElement = document.activeElement
  const isTextInputTarget =
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement ||
    activeElement?.hasAttribute('contenteditable')

  if (!isTextInputTarget) {
    editorSurface.value?.focus()
  }
}

function addEquationAfterActive() {
  const insertAt = activeEquationIndex.value + 1
  editorStates.value.splice(insertAt, 0, createEditorState())
  activeEquationIndex.value = insertAt

  void nextTick(() => {
    editorSurface.value?.focus()
  })
}

function moveActiveEquation(direction: 'up' | 'down') {
  if (editorStates.value.length <= 1) {
    return
  }

  const delta = direction === 'down' ? 1 : -1
  const nextIndex = activeEquationIndex.value + delta

  if (nextIndex < 0 || nextIndex >= editorStates.value.length) {
    return
  }

  activeEquationIndex.value = nextIndex

  void nextTick(() => {
    editorSurface.value?.focus()
  })
}

function removeActiveEquationIfPossible() {
  if (editorStates.value.length <= 1) {
    return false
  }

  editorStates.value.splice(activeEquationIndex.value, 1)
  activeEquationIndex.value = Math.max(0, activeEquationIndex.value - 1)

  void nextTick(() => {
    editorSurface.value?.focus()
  })

  return true
}

function updateFocusedPath(path: NodePath) {
  const state = currentState()
  state.focusedPath = path
  state.selection = collapseSelection(path)

  const activeElement = document.activeElement
  const isTextInputTarget =
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement ||
    activeElement?.hasAttribute('contenteditable')

  if (!isTextInputTarget) {
    editorSurface.value?.focus()
  }
}

function replaceFocusedWithIdentifier(name: string) {
  const state = currentState()

  if (!state.ast) {
    state.ast = { type: 'Identifier', name }
    state.focusedPath = []
    state.selection = collapseSelection([])
    return
  }

  const path = resolveCommandPath(state.focusedPath)
  const result = replaceFocusedNode(state.ast, path, { type: 'Identifier', name })
  applyCommandResult(result)
}

function replaceFocusedWithNumber(value: number) {
  const state = currentState()

  if (!state.ast) {
    state.ast = { type: 'Number', value }
    state.focusedPath = []
    state.selection = collapseSelection([])
    return
  }

  const path = resolveCommandPath(state.focusedPath)
  const result = replaceFocusedNode(state.ast, path, { type: 'Number', value })
  applyCommandResult(result)
}

function typeCharacter(char: string) {
  const state = currentState()

  if (!state.ast) {
    if (/^[a-zA-Z]$/.test(char)) {
      replaceFocusedWithIdentifier(char)
      return
    }

    if (/^[0-9]$/.test(char)) {
      replaceFocusedWithNumber(Number(char))
      return
    }

    return
  }

  const path = resolveCommandPath(state.focusedPath)
  const node = getNodeAtPath(state.ast, path)

  if (node.type === 'Placeholder') {
    if (/^[a-zA-Z]$/.test(char)) {
      replaceFocusedWithIdentifier(char)
      return
    }

    if (/^[0-9]$/.test(char)) {
      replaceFocusedWithNumber(Number(char))
      return
    }
  }

  if (node.type === 'Identifier' && /^[a-zA-Z]$/.test(char)) {
    const result = replaceFocusedNode(state.ast, path, {
      ...node,
      name: `${node.name}${char}`,
    })
    applyCommandResult(result)
    return
  }

  if (node.type === 'Number' && /^[0-9]$/.test(char)) {
    const result = replaceFocusedNode(state.ast, path, {
      ...node,
      value: Number(`${node.value}${char}`),
    })
    applyCommandResult(result)
  }
}

function moveFocusToPlaceholder(direction: 'forward' | 'backward') {
  const state = currentState()

  if (!state.ast) {
    return
  }

  const nextPath = getNextPlaceholderPath(state.ast, state.focusedPath, direction)

  if (!nextPath) {
    return
  }

  updateFocusedPath(nextPath)
}

function isTypingTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null

  if (!target) {
    return false
  }

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return true
  }

  return target.isContentEditable
}

function removeAtFocusedPath() {
  const state = currentState()

  if (!state.ast) {
    removeActiveEquationIfPossible()
    return
  }

  const path = resolveCommandPath(state.focusedPath)

  if (path.length === 0) {
    state.ast = null
    state.focusedPath = []
    state.selection = collapseSelection([])

    if (editorStates.value.length > 1) {
      removeActiveEquationIfPossible()
    }

    return
  }

  if (isPlaceholderAtPath(state.ast, path)) {
    const parent = fallbackFocusAfterDelete(path)
    const unwrapped = unwrapNodeAtPath(state.ast, parent)
    applyCommandResult(unwrapped)
    return
  }

  const result = replaceNodeWithPlaceholder(state.ast, path)
  applyCommandResult(result)
}

function handleEditorKeydown(event: KeyboardEvent) {
  if (viewMode.value !== 'edit') {
    return
  }

  if (isTypingTarget(event)) {
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    addEquationAfterActive()
    return
  }

  if (event.key === 'Tab') {
    event.preventDefault()
    moveFocusToPlaceholder(event.shiftKey ? 'backward' : 'forward')
    return
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault()
    moveFocusToPlaceholder('forward')
    return
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    moveFocusToPlaceholder('backward')
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveActiveEquation('down')
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveActiveEquation('up')
    return
  }

  if (event.key === '/' && !event.metaKey && !event.ctrlKey) {
    event.preventDefault()
    insertFraction()
    return
  }

  if (event.key === '+' && !event.metaKey && !event.ctrlKey) {
    event.preventDefault()
    insertAdd()
    return
  }

  if (event.key === '*' && !event.metaKey && !event.ctrlKey) {
    event.preventDefault()
    insertMultiply()
    return
  }

  if (event.key === '=' && !event.metaKey && !event.ctrlKey) {
    event.preventDefault()
    insertEqual()
    return
  }

  if (event.key === '^' && !event.metaKey && !event.ctrlKey) {
    event.preventDefault()
    insertPower()
    return
  }

  if (
    (event.key === 'd' || event.key === 'D') &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    event.preventDefault()
    insertDerivative()
    return
  }

  if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault()
    removeAtFocusedPath()
    return
  }

  if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1) {
    typeCharacter(event.key)
  }
}

const ast = computed<AstNode | null>({
  get: () => currentState().ast,
  set: (value) => {
    currentState().ast = value
  },
})

function latexForAst(astNode: AstNode | null): string {
  if (!astNode) {
    return ''
  }

  return astToLatex(astNode)
}

function katexHtmlForAst(astNode: AstNode | null): string {
  const latex = latexForAst(astNode)

  if (!latex) {
    return '<span class="empty-equation">Empty equation</span>'
  }

  return katex.renderToString(latex, {
    throwOnError: false,
    displayMode: true,
    strict: 'ignore',
  })
}

const activeEquation = computed(() => currentState())
const latex = computed(() => latexForAst(activeEquation.value.ast))
const mathml = computed(() =>
  activeEquation.value.ast ? astToContentMathML(activeEquation.value.ast).trim() : '',
)
const focusedPathLabel = computed(() =>
  activeEquation.value.focusedPath && activeEquation.value.focusedPath.length > 0
    ? activeEquation.value.focusedPath.join(' > ')
    : 'root',
)
</script>

<template>
  <section
    ref="editorSurface"
    class="editor-grid"
    tabindex="0"
    @keydown.capture="handleEditorKeydown"
  >
    <Card class="editor-card">
      <template #title>
        <div class="header-row">
          <span>Equation Builder</span>
          <Tag severity="info" value="AST First" />
        </div>
      </template>

      <template #subtitle>
        Insert structured operations and keep derivative semantics distinct from fractions.
      </template>

      <template #content>
        <div class="toolbar">
          <Button
            icon="pi pi-pen-to-square"
            :severity="viewMode === 'edit' ? 'contrast' : 'secondary'"
            label="Edit"
            size="small"
            @click="viewMode = 'edit'"
          />
          <Button
            icon="pi pi-eye"
            :severity="viewMode === 'display' ? 'contrast' : 'secondary'"
            label="Display"
            size="small"
            @click="viewMode = 'display'"
          />

          <Button icon="pi pi-slash" label="Fraction" size="small" @click="insertFraction" />
          <Button icon="pi pi-plus" label="Add" size="small" outlined @click="insertAdd" />
          <Button
            icon="pi pi-times"
            label="Multiply"
            size="small"
            outlined
            @click="insertMultiply"
          />
          <Button icon="pi pi-equals" label="Equals" size="small" outlined @click="insertEqual" />
          <Button
            icon="pi pi-superscript"
            label="Power"
            size="small"
            outlined
            @click="insertPower"
          />
          <Button
            icon="pi pi-forward"
            label="Derivative"
            size="small"
            severity="contrast"
            @click="insertDerivative"
          />
          <Button icon="pi pi-undo" label="Unwrap" size="small" text @click="unwrapFocusedNode" />
        </div>

        <p class="focus-meta">
          Focused path: {{ focusedPathLabel }} | Node mode: {{ activeEquation.mode }} | View:
          {{ viewMode }}
        </p>

        <p class="key-hint">Press Enter to create a new equation line.</p>

        <p class="key-hint">
          Keyboard: Tab and Left/Right move slots, Up/Down move between equation rows,
          letters/numbers type into slot, / fraction, * multiply, + add, = equals, ^ power, d
          derivative, Backspace/Delete remove.
        </p>

        <Divider />

        <div class="equations-stack">
          <div
            v-for="(equationState, index) in editorStates"
            :key="index"
            class="equation-row"
            :class="{ active: index === activeEquationIndex }"
            @click="setActiveEquation(index)"
          >
            <div class="equation-label">Eq {{ index + 1 }}</div>

            <EquationEditor
              v-if="viewMode === 'edit' && index === activeEquationIndex"
              v-model="ast"
              :focused-path="equationState.focusedPath"
              @focus-path="updateFocusedPath"
            />

            <div v-else class="display-surface" v-html="katexHtmlForAst(equationState.ast)"></div>
          </div>
        </div>
      </template>
    </Card>

    <Card class="output-card" aria-labelledby="ast-preview-title">
      <template #title>
        <div id="ast-preview-title">AST Preview</div>
      </template>
      <template #content>
        <pre>{{ JSON.stringify(activeEquation.ast, null, 2) }}</pre>
      </template>
    </Card>

    <Card class="output-card" aria-labelledby="mathml-preview-title">
      <template #title>
        <div id="mathml-preview-title">Content MathML</div>
      </template>
      <template #content>
        <pre>{{ mathml }}</pre>
      </template>
    </Card>

    <Card class="output-card" aria-labelledby="latex-preview-title">
      <template #title>
        <div id="latex-preview-title">LaTeX</div>
      </template>
      <template #content>
        <pre>{{ latex }}</pre>
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

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.equations-stack {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.equation-row {
  border: 1px solid #e2e8f0;
  border-radius: 0.55rem;
  padding: 0.6rem;
  background: #ffffff;
}

.equation-row.active {
  border-color: #22c55e;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.12);
}

.equation-label {
  color: #64748b;
  font-size: 0.75rem;
  margin-bottom: 0.35rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.display-surface {
  border: 1px solid #cbd5e1;
  border-radius: 0.55rem;
  padding: 0.85rem;
  background: #f8fafc;
  min-height: 3rem;
  color: #0f172a;
}

.focus-meta {
  margin: 0.75rem 0 0;
  color: #475569;
  font-size: 0.85rem;
}

.math-field-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.section-label {
  color: #475569;
  font-size: 0.9rem;
}

.math-field {
  width: 100%;
  min-height: 5rem;
  border: 1px solid #cbd5e1;
  border-radius: 0.65rem;
  background: #fff;
  padding: 0.75rem;
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
