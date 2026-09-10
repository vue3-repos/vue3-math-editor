<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import katex from 'katex'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Divider from 'primevue/divider'
import Tag from 'primevue/tag'

import EquationEditor from './EquationEditor.vue'

import {
  collapseSelection,
  convertIdentifierToFunctionCallAtPath,
  deleteEmptyGroupAtPath,
  deletePlaceholderAtPath,
  getNodeAtPath,
  getNextPlaceholderPath,
  insertAbsAtPath,
  insertAddAtPath,
  insertDerivativeAtPath,
  insertEqualAtPath,
  insertFractionAtPath,
  insertFunctionAtPath,
  insertGroupAtPath,
  insertMultiplyAtPath,
  insertNegateAtPath,
  insertPowerAtPath,
  insertRootAtPath,
  insertSiblingAfterAtPath,
  insertSubtractAtPath,
  isPlaceholderAtPath,
  replaceFocusedNode,
  replaceNodeWithPlaceholder,
  resolveCommandPath,
  unwrapNodeAtPath,
  type CommandResult,
  type NodeCommand,
} from '../editor/commands'
import {
  climbForOperator,
  firstChildNodePath,
  moveLeaf,
  parentNodePath,
  pathsEqual,
} from '../editor/navigation'
import { astToLatex } from '../renderers/latex'
import { renderMathJson } from '../renderers/mathjson'
import { astToContentMathML } from '../renderers/mathml'
import { getFunctionDefinition } from '../registry/nodes'
import type { AstNode } from '../types/ast'
import type { EditorState, NodePath } from '../types/editor'

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

// Buffer for the digits the user typed into the focused Number node, so that
// intermediate states like "3." and "3.50" survive round-trips through the
// numeric AST value.
const numberEdit = ref<{ key: string; text: string } | null>(null)

// Non-null while a "\..." command is being typed (Mathfield-style).
const commandBuffer = ref<string | null>(null)

function currentState(): EditorState {
  return editorStates.value[activeEquationIndex.value]
}

function focusSurface() {
  editorSurface.value?.focus()
}

// ---------------------------------------------------------------------------
// History (undo/redo)
// ---------------------------------------------------------------------------

interface Snapshot {
  states: EditorState[]
  active: number
}

const undoStack = ref<Snapshot[]>([])
const redoStack = ref<Snapshot[]>([])

function takeSnapshot(): Snapshot {
  return JSON.parse(
    JSON.stringify({ states: editorStates.value, active: activeEquationIndex.value }),
  ) as Snapshot
}

function pushHistory() {
  undoStack.value.push(takeSnapshot())

  if (undoStack.value.length > 200) {
    undoStack.value.shift()
  }

  redoStack.value = []
}

function restoreSnapshot(snapshot: Snapshot) {
  editorStates.value = snapshot.states
  activeEquationIndex.value = Math.min(snapshot.active, snapshot.states.length - 1)
  numberEdit.value = null
  focusSurface()
}

function undo() {
  const snapshot = undoStack.value.pop()

  if (!snapshot) {
    return
  }

  redoStack.value.push(takeSnapshot())
  restoreSnapshot(snapshot)
}

function redo() {
  const snapshot = redoStack.value.pop()

  if (!snapshot) {
    return
  }

  undoStack.value.push(takeSnapshot())
  restoreSnapshot(snapshot)
}

const canUndo = computed(() => undoStack.value.length > 0)
const canRedo = computed(() => redoStack.value.length > 0)

// ---------------------------------------------------------------------------
// Command application
// ---------------------------------------------------------------------------

function applyCommandResult(result: CommandResult) {
  pushHistory()

  const state = currentState()
  state.ast = result.ast
  state.focusedPath = result.focusedPath
  state.selection = collapseSelection(result.focusedPath)
  numberEdit.value = null
}

function rootAstForCommand(): AstNode {
  return currentState().ast ?? { type: 'Placeholder' }
}

function wrapFocused(command: NodeCommand) {
  const path = resolveCommandPath(currentState().focusedPath)
  applyCommandResult(command(rootAstForCommand(), path))
}

function insertPower() {
  wrapFocused(insertPowerAtPath)
}

function insertDerivative() {
  wrapFocused(insertDerivativeAtPath)
}

function insertAbs() {
  wrapFocused(insertAbsAtPath)
}

function insertRoot(withDegree: boolean) {
  wrapFocused((root, path) => insertRootAtPath(root, path, withDegree))
}

function insertFunction(name: string) {
  wrapFocused((root, path) => insertFunctionAtPath(root, path, name))
}

// True when the focused node sits directly inside a variadic parent of `type`.
function focusedVariadicParent(type: 'Add' | 'Multiply'): boolean {
  const state = currentState()

  if (!state.ast) {
    return false
  }

  const path = resolveCommandPath(state.focusedPath)

  if (path.length < 2 || path[path.length - 2] !== 'children') {
    return false
  }

  const parent = parentNodePath(path)
  return parent !== null && getNodeAtPath(state.ast, parent).type === type
}

// Apply a typed binary operator at the precedence-correct level: "4*t-3"
// subtracts from the whole product, "2+3*4" keeps the product tight, and
// explicit brackets or structural slots (fractions, roots, ...) stop the climb.
function wrapWithPrecedence(
  command: NodeCommand,
  operatorPrecedence: number,
  siblingParentType: 'Add' | 'Multiply' | null = null,
) {
  const state = currentState()

  if (!state.ast) {
    wrapFocused(command)
    return
  }

  const path = resolveCommandPath(state.focusedPath)
  const climbed = climbForOperator(state.ast, path, operatorPrecedence, siblingParentType)

  if (climbed.siblingParent) {
    const result = insertSiblingAfterAtPath(state.ast, climbed.path)

    if (result) {
      applyCommandResult(result)
      return
    }
  }

  applyCommandResult(command(state.ast, climbed.path))
}

function insertFraction() {
  wrapWithPrecedence(insertFractionAtPath, 3)
}

function insertEqual() {
  wrapWithPrecedence(insertEqualAtPath, 1)
}

function insertSubtract() {
  wrapWithPrecedence(insertSubtractAtPath, 2)
}

function insertAddSmart() {
  wrapWithPrecedence(insertAddAtPath, 2, 'Add')
}

function insertMultiplySmart() {
  wrapWithPrecedence(insertMultiplyAtPath, 3, 'Multiply')
}

// "-" on an empty slot means unary minus; on filled content it subtracts.
function insertMinusSmart() {
  const state = currentState()
  const path = resolveCommandPath(state.focusedPath)

  if (!state.ast || isPlaceholderAtPath(state.ast, path)) {
    wrapFocused(insertNegateAtPath)
    return
  }

  insertSubtract()
}

function unwrapFocusedNode() {
  const state = currentState()

  if (!state.ast) {
    return
  }

  applyCommandResult(unwrapNodeAtPath(state.ast, resolveCommandPath(state.focusedPath)))
}

// ---------------------------------------------------------------------------
// Equation rows
// ---------------------------------------------------------------------------

function setActiveEquation(index: number) {
  activeEquationIndex.value = index
  focusSurface()
}

function focusEquationPath(index: number, path: NodePath) {
  activeEquationIndex.value = index

  const state = currentState()
  state.focusedPath = path
  state.selection = collapseSelection(path)
  numberEdit.value = null
  focusSurface()
}

function addEquationAfterActive() {
  pushHistory()

  const insertAt = activeEquationIndex.value + 1
  editorStates.value.splice(insertAt, 0, createEditorState())
  activeEquationIndex.value = insertAt

  void nextTick(focusSurface)
}

function moveActiveEquation(direction: 'up' | 'down') {
  const delta = direction === 'down' ? 1 : -1
  const nextIndex = activeEquationIndex.value + delta

  if (nextIndex < 0 || nextIndex >= editorStates.value.length) {
    return
  }

  activeEquationIndex.value = nextIndex
  void nextTick(focusSurface)
}

function removeActiveEquationIfPossible() {
  if (editorStates.value.length <= 1) {
    return
  }

  pushHistory()
  editorStates.value.splice(activeEquationIndex.value, 1)
  activeEquationIndex.value = Math.max(0, activeEquationIndex.value - 1)

  void nextTick(focusSurface)
}

// ---------------------------------------------------------------------------
// Typing
// ---------------------------------------------------------------------------

function numberTextFor(path: NodePath, node: { value: number }): string {
  const key = JSON.stringify(path)

  if (numberEdit.value && numberEdit.value.key === key) {
    return numberEdit.value.text
  }

  return String(node.value)
}

function startEquationWith(node: AstNode) {
  pushHistory()

  const state = currentState()
  state.ast = node
  state.focusedPath = []
  state.selection = collapseSelection([])
}

// Typing a letter/digit right after a complete term multiplies implicitly,
// mirroring how "2x" is entered in Mathfield.
function insertImplicitFactor(factor: AstNode) {
  const state = currentState()

  if (!state.ast) {
    return
  }

  const path = resolveCommandPath(state.focusedPath)
  let base: CommandResult | null = null

  if (focusedVariadicParent('Multiply')) {
    base = insertSiblingAfterAtPath(state.ast, path)
  }

  if (!base) {
    base = insertMultiplyAtPath(state.ast, path)
  }

  applyCommandResult(replaceFocusedNode(base.ast, base.focusedPath, factor))
}

function typeLetter(char: string) {
  const state = currentState()

  if (!state.ast) {
    startEquationWith({ type: 'Identifier', name: char })
    return
  }

  const path = resolveCommandPath(state.focusedPath)
  const node = getNodeAtPath(state.ast, path)

  if (node.type === 'Placeholder') {
    applyCommandResult(replaceFocusedNode(state.ast, path, { type: 'Identifier', name: char }))
    return
  }

  if (node.type === 'Identifier') {
    applyCommandResult(
      replaceFocusedNode(state.ast, path, { ...node, name: `${node.name}${char}` }),
    )
    return
  }

  insertImplicitFactor({ type: 'Identifier', name: char })
}

function typeDigit(digit: string) {
  const state = currentState()

  if (!state.ast) {
    startEquationWith({ type: 'Number', value: Number(digit) })
    numberEdit.value = { key: JSON.stringify([]), text: digit }
    return
  }

  const path = resolveCommandPath(state.focusedPath)
  const node = getNodeAtPath(state.ast, path)

  if (node.type === 'Placeholder') {
    applyCommandResult(replaceFocusedNode(state.ast, path, { type: 'Number', value: Number(digit) }))
    numberEdit.value = { key: JSON.stringify(path), text: digit }
    return
  }

  if (node.type === 'Number') {
    const text = numberTextFor(path, node) + digit
    applyCommandResult(replaceFocusedNode(state.ast, path, { ...node, value: Number(text) }))
    numberEdit.value = { key: JSON.stringify(path), text }
    return
  }

  if (node.type === 'Identifier') {
    applyCommandResult(
      replaceFocusedNode(state.ast, path, { ...node, name: `${node.name}${digit}` }),
    )
    return
  }

  insertImplicitFactor({ type: 'Number', value: Number(digit) })

  const focusedPath = currentState().focusedPath

  if (focusedPath) {
    numberEdit.value = { key: JSON.stringify(focusedPath), text: digit }
  }
}

function typeDecimalPoint() {
  const state = currentState()

  if (!state.ast) {
    startEquationWith({ type: 'Number', value: 0 })
    numberEdit.value = { key: JSON.stringify([]), text: '0.' }
    return
  }

  const path = resolveCommandPath(state.focusedPath)
  const node = getNodeAtPath(state.ast, path)

  if (node.type === 'Placeholder') {
    applyCommandResult(replaceFocusedNode(state.ast, path, { type: 'Number', value: 0 }))
    numberEdit.value = { key: JSON.stringify(path), text: '0.' }
    return
  }

  if (node.type === 'Number') {
    const text = numberTextFor(path, node)

    if (!text.includes('.')) {
      numberEdit.value = { key: JSON.stringify(path), text: `${text}.` }
    }
  }
}

function handleOpenParen() {
  const state = currentState()
  const path = resolveCommandPath(state.focusedPath)

  // On an empty slot, open a bracket group to type into: (□)
  if (!state.ast || isPlaceholderAtPath(state.ast, path)) {
    applyCommandResult(insertGroupAtPath(rootAstForCommand(), path))
    return
  }

  const node = getNodeAtPath(state.ast, path)

  // "sin(" turns the identifier into a function call, starting with an
  // empty argument rather than repeating the identifier as its own argument.
  if (node.type === 'Identifier') {
    applyCommandResult(convertIdentifierToFunctionCallAtPath(state.ast, path))
    return
  }

  // After a complete term, "(" starts a multiplied bracket group: 4(□), (x+2)(□)
  insertImplicitFactor({ type: 'Group', value: { type: 'Placeholder' } })

  const focusedPath = currentState().focusedPath

  if (focusedPath) {
    focusEquationPath(activeEquationIndex.value, [...focusedPath, 'value'])
  }
}

// ")" steps out of the innermost bracket group and selects it, so a following
// operator (e.g. ^) applies to the bracketed expression as a whole.
function handleCloseParen() {
  const state = currentState()

  if (!state.ast) {
    return
  }

  const path = resolveCommandPath(state.focusedPath)

  for (let parent = parentNodePath(path); parent; parent = parentNodePath(parent)) {
    if (getNodeAtPath(state.ast, parent).type === 'Group') {
      focusEquationPath(activeEquationIndex.value, parent)
      return
    }
  }

  moveHorizontal('forward')
}

function handleComma() {
  const state = currentState()

  if (!state.ast) {
    return
  }

  const result = insertSiblingAfterAtPath(state.ast, resolveCommandPath(state.focusedPath))

  if (result) {
    applyCommandResult(result)
  }
}

function handleBackspace() {
  const state = currentState()

  if (!state.ast) {
    removeActiveEquationIfPossible()
    return
  }

  const path = resolveCommandPath(state.focusedPath)
  const node = getNodeAtPath(state.ast, path)

  if (node.type === 'Number') {
    const text = numberTextFor(path, node).slice(0, -1)

    if (text && text !== '-' && text !== '.') {
      applyCommandResult(replaceFocusedNode(state.ast, path, { ...node, value: Number(text) }))
      numberEdit.value = { key: JSON.stringify(path), text }
      return
    }
  }

  if (node.type === 'Identifier' && node.name.length > 1) {
    applyCommandResult(
      replaceFocusedNode(state.ast, path, { ...node, name: node.name.slice(0, -1) }),
    )
    return
  }

  // Deleting a bracket group removes the brackets but keeps the content.
  // An empty group has no content worth keeping, so drop it entirely
  // instead of unwrapping to a placeholder that would need a second
  // backspace to clear.
  if (node.type === 'Group') {
    if (node.value.type === 'Placeholder') {
      applyCommandResult(deleteEmptyGroupAtPath(state.ast, path))
    } else {
      applyCommandResult(unwrapNodeAtPath(state.ast, path))
    }
    return
  }

  if (node.type === 'Placeholder') {
    if (path.length === 0) {
      pushHistory()
      state.ast = null
      state.focusedPath = []
      state.selection = collapseSelection([])
      numberEdit.value = null
      return
    }

    // Focus is inside an empty group's parens; delete the group as a
    // whole rather than collapsing it to a bare placeholder in place.
    const enclosingGroupPath = parentNodePath(path)
    if (enclosingGroupPath && getNodeAtPath(state.ast, enclosingGroupPath).type === 'Group') {
      applyCommandResult(deleteEmptyGroupAtPath(state.ast, enclosingGroupPath))
      return
    }

    applyCommandResult(deletePlaceholderAtPath(state.ast, path))
    return
  }

  applyCommandResult(replaceNodeWithPlaceholder(state.ast, path))
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function moveFocusToPlaceholder(direction: 'forward' | 'backward') {
  const state = currentState()

  if (!state.ast) {
    return
  }

  const current = resolveCommandPath(state.focusedPath)
  const nextPath = getNextPlaceholderPath(state.ast, state.focusedPath, direction)

  // No empty slot to jump to (or only the one already focused): step
  // horizontally instead so Tab keeps moving through the equation.
  if (!nextPath || pathsEqual(nextPath, current)) {
    moveHorizontal(direction)
    return
  }

  focusEquationPath(activeEquationIndex.value, nextPath)
}

function moveHorizontal(direction: 'forward' | 'backward') {
  const state = currentState()

  if (!state.ast) {
    return
  }

  const path = resolveCommandPath(state.focusedPath)
  const next = moveLeaf(state.ast, path, direction)

  // At either boundary there's no further leaf to walk to; stay put. Climbing
  // to the enclosing expression is a deliberate separate action (ArrowUp),
  // not something walking the terms does on its own.
  if (next) {
    focusEquationPath(activeEquationIndex.value, next)
  }
}

function selectParent(): boolean {
  const state = currentState()

  if (!state.ast) {
    return false
  }

  const parent = parentNodePath(resolveCommandPath(state.focusedPath))

  if (!parent) {
    return false
  }

  focusEquationPath(activeEquationIndex.value, parent)
  return true
}

function selectFirstChild(): boolean {
  const state = currentState()

  if (!state.ast) {
    return false
  }

  const child = firstChildNodePath(state.ast, resolveCommandPath(state.focusedPath))

  if (!child) {
    return false
  }

  focusEquationPath(activeEquationIndex.value, child)
  return true
}

// ---------------------------------------------------------------------------
// Command mode ("\frac", "\sqrt", "\sin", ...)
// ---------------------------------------------------------------------------

function runCommandName(name: string) {
  switch (name) {
    case 'frac':
    case 'fraction':
      insertFraction()
      return
    case 'sqrt':
      insertRoot(false)
      return
    case 'root':
      insertRoot(true)
      return
    case 'abs':
      insertAbs()
      return
    case 'dd':
    case 'diff':
    case 'derivative':
      insertDerivative()
      return
    case 'pow':
    case 'power':
      insertPower()
      return
  }

  if (getFunctionDefinition(name)) {
    insertFunction(name)
    return
  }

  // Fall back to a named identifier, so "\alpha" gives a greek variable.
  const state = currentState()

  if (!state.ast) {
    startEquationWith({ type: 'Identifier', name })
    return
  }

  applyCommandResult(
    replaceFocusedNode(state.ast, resolveCommandPath(state.focusedPath), {
      type: 'Identifier',
      name,
    }),
  )
}

function commitCommand() {
  const name = (commandBuffer.value ?? '').trim().toLowerCase()
  commandBuffer.value = null

  if (name) {
    runCommandName(name)
  }
}

function handleCommandModeKeydown(event: KeyboardEvent) {
  event.preventDefault()

  if (/^[a-zA-Z0-9]$/.test(event.key)) {
    commandBuffer.value += event.key
    return
  }

  if (event.key === 'Backspace') {
    commandBuffer.value = commandBuffer.value ? commandBuffer.value.slice(0, -1) : null
    return
  }

  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Tab' || event.key === '(') {
    commitCommand()
    return
  }

  if (event.key === 'Escape') {
    commandBuffer.value = null
  }
}

// ---------------------------------------------------------------------------
// Keyboard dispatch
// ---------------------------------------------------------------------------

function handleCharacter(char: string) {
  switch (char) {
    case '/':
      insertFraction()
      return
    case '^':
      insertPower()
      return
    case '=':
      insertEqual()
      return
    case '+':
      insertAddSmart()
      return
    case '*':
      insertMultiplySmart()
      return
    case '-':
      insertMinusSmart()
      return
    case '|':
      insertAbs()
      return
    case '(':
      handleOpenParen()
      return
    case ')':
      handleCloseParen()
      return
    case ',':
      handleComma()
      return
    case '.':
      typeDecimalPoint()
      return
  }

  if (/^[a-zA-Z]$/.test(char)) {
    typeLetter(char)
    return
  }

  if (/^[0-9]$/.test(char)) {
    typeDigit(char)
  }
}

function handleEditorKeydown(event: KeyboardEvent) {
  if (commandBuffer.value !== null) {
    handleCommandModeKeydown(event)
    return
  }

  if ((event.ctrlKey || event.metaKey) && !event.altKey) {
    const key = event.key.toLowerCase()

    if (key === 'z') {
      event.preventDefault()

      if (event.shiftKey) {
        redo()
      } else {
        undo()
      }

      return
    }

    if (key === 'y') {
      event.preventDefault()
      redo()
    }

    return
  }

  if (event.altKey) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      moveActiveEquation(event.key === 'ArrowUp' ? 'up' : 'down')
    }

    return
  }

  switch (event.key) {
    case 'Enter':
      event.preventDefault()
      addEquationAfterActive()
      return
    case 'Tab':
      event.preventDefault()
      moveFocusToPlaceholder(event.shiftKey ? 'backward' : 'forward')
      return
    case 'ArrowRight':
      event.preventDefault()
      moveHorizontal('forward')
      return
    case 'ArrowLeft':
      event.preventDefault()
      moveHorizontal('backward')
      return
    case 'ArrowUp':
      event.preventDefault()

      if (!selectParent()) {
        moveActiveEquation('up')
      }

      return
    case 'ArrowDown':
      // Drill-in only — switching equation lines is Alt+ArrowDown, so a leaf
      // selection never accidentally jumps to another line.
      event.preventDefault()
      selectFirstChild()
      return
    case 'Escape':
      event.preventDefault()
      selectParent()
      return
    case 'Backspace':
    case 'Delete':
      event.preventDefault()
      handleBackspace()
      return
  }

  if (event.key === '\\') {
    event.preventDefault()
    commandBuffer.value = ''
    return
  }

  if (event.key.length === 1) {
    event.preventDefault()
    handleCharacter(event.key)
  }
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

interface ToolButton {
  latex: string
  title: string
  run: () => void
}

const structureButtons: ToolButton[] = [
  { latex: '\\frac{a}{b}', title: 'Fraction  ( / )', run: insertFraction },
  { latex: 'x^{n}', title: 'Power  ( ^ )', run: insertPower },
  { latex: '\\sqrt{x}', title: 'Square root  ( \\sqrt )', run: () => insertRoot(false) },
  { latex: '\\sqrt[n]{x}', title: 'nth root  ( \\root )', run: () => insertRoot(true) },
  { latex: '|x|', title: 'Absolute value  ( | )', run: insertAbs },
  {
    latex: '\\frac{\\mathrm{d}y}{\\mathrm{d}x}',
    title: 'Derivative  ( \\dd )',
    run: insertDerivative,
  },
  { latex: '\\sin', title: 'Sine  ( \\sin or sin( )', run: () => insertFunction('sin') },
]

const operatorButtons: ToolButton[] = [
  { latex: '+', title: 'Add  ( + )', run: insertAddSmart },
  { latex: '-', title: 'Subtract  ( - )', run: insertSubtract },
  { latex: '\\times', title: 'Multiply  ( * )', run: insertMultiplySmart },
  { latex: '=', title: 'Equals  ( = )', run: insertEqual },
]

function buttonHtml(latex: string): string {
  return katex.renderToString(latex, { throwOnError: false, strict: 'ignore' })
}

// ---------------------------------------------------------------------------
// Output panels
// ---------------------------------------------------------------------------

const activeEquation = computed(() => currentState())
const latex = computed(() => (activeEquation.value.ast ? astToLatex(activeEquation.value.ast) : ''))
const mathjson = computed(() =>
  activeEquation.value.ast ? renderMathJson(activeEquation.value.ast) : '',
)
const mathml = computed(() =>
  activeEquation.value.ast ? astToContentMathML(activeEquation.value.ast).trim() : '',
)
const focusedPathLabel = computed(() =>
  activeEquation.value.focusedPath && activeEquation.value.focusedPath.length > 0
    ? activeEquation.value.focusedPath.join(' › ')
    : 'root',
)

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
  if (!mathjson.value) {
    return
  }

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
        Click any part of an equation to select it, then type — the structure stays semantic.
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
              @click="item.run"
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
              @click="item.run"
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
              @click="undo"
            />
            <Button
              icon="pi pi-refresh"
              size="small"
              text
              title="Redo (Ctrl+Shift+Z)"
              :disabled="!canRedo"
              @click="redo"
            />
            <Button label="Unwrap" size="small" text title="Replace selection with its first child"
              @click="unwrapFocusedNode" />
            <Button
              icon="pi pi-plus"
              label="Line"
              size="small"
              text
              title="Add equation line (Enter)"
              @click="addEquationAfterActive"
            />
            <Button
              icon="pi pi-trash"
              size="small"
              text
              severity="danger"
              title="Remove equation line"
              :disabled="editorStates.length <= 1"
              @click="removeActiveEquationIfPossible"
            />
          </div>
        </div>

        <Divider />

        <div class="equations-stack">
          <div
            v-for="(equationState, index) in editorStates"
            :key="index"
            class="equation-row"
            :class="{ active: index === activeEquationIndex }"
            @click="setActiveEquation(index)"
          >
            <div class="equation-label">{{ index + 1 }}</div>

            <EquationEditor
              class="equation-field"
              :model-value="equationState.ast"
              :focused-path="equationState.focusedPath"
              :is-active="index === activeEquationIndex"
              @focus-path="focusEquationPath(index, $event)"
            />
          </div>
        </div>

        <div v-if="commandBuffer !== null" class="command-chip">
          <span class="command-slash">\</span>{{ commandBuffer }}<span class="command-caret"></span>
        </div>
        <p v-else class="focus-meta">Selection: {{ focusedPathLabel }}</p>

        <p class="key-hint">
          <kbd>←</kbd><kbd>→</kbd> walk the terms · <kbd>↑</kbd> select enclosing expression ·
          <kbd>↓</kbd> drill in · <kbd>Tab</kbd> next empty slot, else step right ·
          <kbd>Enter</kbd> new line ·
          <kbd>Alt</kbd>+<kbd>↑↓</kbd> switch lines
        </p>
        <p class="key-hint">
          Type letters/numbers to fill the selection · <code>+ − * / ^ = |</code> build structure
          with normal precedence · <code>(</code> opens brackets, <code>)</code> steps out and
          selects them · <code>\</code> opens commands (<code>\frac \sqrt \root \abs \dd \sin
          \alpha</code> …) · <code>sin(</code> makes a function · <kbd>Backspace</kbd> deletes step
          by step · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo
        </p>
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
        <pre>{{ mathjson }}</pre>
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
