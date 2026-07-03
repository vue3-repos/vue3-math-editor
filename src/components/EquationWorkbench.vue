<script setup lang="ts">
import { ref, computed } from 'vue'
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

const editorState = ref<EditorState>({
  ast: {
    type: 'Identifier',
    name: 'x',
  },
  focusedPath: [],
  selection: {
    anchor: [],
    focus: [],
  },
  mode: 'insert',
})

const editorSurface = ref<HTMLElement | null>(null)

function applyCommandResult(result: { ast: AstNode; focusedPath: NodePath }) {
  editorState.value.ast = result.ast
  editorState.value.focusedPath = result.focusedPath
  editorState.value.selection = collapseSelection(result.focusedPath)
}

function insertFraction() {
  const path = resolveCommandPath(editorState.value.focusedPath)
  const result = insertFractionAtPath(editorState.value.ast, path)
  applyCommandResult(result)
}

function insertAdd() {
  const path = resolveCommandPath(editorState.value.focusedPath)
  const result = insertAddAtPath(editorState.value.ast, path)
  applyCommandResult(result)
}

function insertMultiply() {
  const path = resolveCommandPath(editorState.value.focusedPath)
  const result = insertMultiplyAtPath(editorState.value.ast, path)
  applyCommandResult(result)
}

function insertEqual() {
  const path = resolveCommandPath(editorState.value.focusedPath)
  const result = insertEqualAtPath(editorState.value.ast, path)
  applyCommandResult(result)
}

function insertPower() {
  const path = resolveCommandPath(editorState.value.focusedPath)
  const result = insertPowerAtPath(editorState.value.ast, path)
  applyCommandResult(result)
}

function insertDerivative() {
  const path = resolveCommandPath(editorState.value.focusedPath)
  const result = insertDerivativeAtPath(editorState.value.ast, path)
  applyCommandResult(result)
}

function unwrapFocusedNode() {
  const path = resolveCommandPath(editorState.value.focusedPath)
  const result = unwrapNodeAtPath(editorState.value.ast, path)
  applyCommandResult(result)
}

function updateFocusedPath(path: NodePath) {
  editorState.value.focusedPath = path
  editorState.value.selection = collapseSelection(path)
  editorSurface.value?.focus()
}

function replaceFocusedWithIdentifier(name: string) {
  const path = resolveCommandPath(editorState.value.focusedPath)
  const result = replaceFocusedNode(editorState.value.ast, path, { type: 'Identifier', name })
  applyCommandResult(result)
}

function replaceFocusedWithNumber(value: number) {
  const path = resolveCommandPath(editorState.value.focusedPath)
  const result = replaceFocusedNode(editorState.value.ast, path, { type: 'Number', value })
  applyCommandResult(result)
}

function typeCharacter(char: string) {
  const path = resolveCommandPath(editorState.value.focusedPath)
  const node = getNodeAtPath(editorState.value.ast, path)

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
    const result = replaceFocusedNode(editorState.value.ast, path, {
      ...node,
      name: `${node.name}${char}`,
    })
    applyCommandResult(result)
    return
  }

  if (node.type === 'Number' && /^[0-9]$/.test(char)) {
    const result = replaceFocusedNode(editorState.value.ast, path, {
      ...node,
      value: Number(`${node.value}${char}`),
    })
    applyCommandResult(result)
  }
}

function moveFocusToPlaceholder(direction: 'forward' | 'backward') {
  const nextPath = getNextPlaceholderPath(
    editorState.value.ast,
    editorState.value.focusedPath,
    direction,
  )

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
  const path = resolveCommandPath(editorState.value.focusedPath)

  if (path.length === 0) {
    return
  }

  if (isPlaceholderAtPath(editorState.value.ast, path)) {
    const parent = fallbackFocusAfterDelete(path)
    const unwrapped = unwrapNodeAtPath(editorState.value.ast, parent)
    applyCommandResult(unwrapped)
    return
  }

  const result = replaceNodeWithPlaceholder(editorState.value.ast, path)
  applyCommandResult(result)
}

function handleEditorKeydown(event: KeyboardEvent) {
  if (event.key === 'Tab') {
    event.preventDefault()
    moveFocusToPlaceholder(event.shiftKey ? 'backward' : 'forward')
    return
  }

  if (isTypingTarget(event)) {
    return
  }

  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault()
    moveFocusToPlaceholder('forward')
    return
  }

  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault()
    moveFocusToPlaceholder('backward')
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

const ast = computed<AstNode>({
  get: () => editorState.value.ast,
  set: (value) => {
    editorState.value.ast = value
  },
})

const latex = computed(() => astToLatex(editorState.value.ast))
const mathml = computed(() => astToContentMathML(editorState.value.ast).trim())
const focusedPathLabel = computed(() =>
  editorState.value.focusedPath && editorState.value.focusedPath.length > 0
    ? editorState.value.focusedPath.join(' > ')
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
          Focused path: {{ focusedPathLabel }} | Mode: {{ editorState.mode }}
        </p>

        <p class="key-hint">
          Keyboard: Tab/arrows move slots, letters/numbers type into slot, / fraction, * multiply, +
          add, = equals, ^ power, d derivative, Backspace/Delete remove.
        </p>

        <Divider />

        <EquationEditor
          v-model="ast"
          :focused-path="editorState.focusedPath"
          @focus-path="updateFocusedPath"
        />
      </template>
    </Card>

    <Card class="output-card" aria-labelledby="ast-preview-title">
      <template #title>
        <div id="ast-preview-title">AST Preview</div>
      </template>
      <template #content>
        <pre>{{ JSON.stringify(editorState.ast, null, 2) }}</pre>
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
