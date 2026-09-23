<script setup lang="ts">
// The equation editing surface: renders a layout row with KaTeX, draws the
// caret and selection as overlays, moves the cursor with the arrow keys and
// the mouse, and runs editing commands for typed keys (editor/keymap.ts).
//
// It owns no state. Navigation and selection emit `navigate` with the new
// { cursor, anchor }; edits emit `edit` with the new { root, cursor } (so the
// parent can record undo history). Keys it doesn't use bubble up: Enter,
// Ctrl/Cmd/Alt shortcuts other than select-all, ↑/↓ with no row above/below,
// and Backspace/Delete/Tab when they have nothing to do here (e.g. Backspace
// in an empty equation).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import katex from 'katex'

import { caretBox, hitTest, nearestOffset, selectionBox } from '../editor/caretGeometry'
import type { EditorState } from '../editor/commands'
import { type Cursor, type PickOffset, cursorAtEnd, cursorAtStart } from '../editor/cursor'
import { commandForKey } from '../editor/keymap'
import type { Row } from '../editor/layout'
import {
  collapseSelection,
  extendSelection,
  extendSelectionTo,
  navigateHorizontal,
  navigateVertical,
  selectAll,
  selectBetween,
  selectionOf,
} from '../editor/selection'
import { KATEX_EDITOR_OPTIONS, rowToLatex } from '../renderers/layoutLatex'

export interface NavigationState {
  cursor: Cursor
  anchor: Cursor | null
}

const props = withDefaults(
  defineProps<{
    modelValue: Row
    cursor: Cursor
    anchor?: Cursor | null
    active?: boolean
    readonly?: boolean
  }>(),
  { anchor: null, active: true, readonly: false },
)

const emit = defineEmits<{
  navigate: [state: NavigationState]
  edit: [state: EditorState]
}>()

const surfaceEl = ref<HTMLElement | null>(null)
const focused = ref(false)
const caretStyle = ref<Record<string, string> | null>(null)
const caretInPlaceholder = ref(false)
const selectionStyle = ref<Record<string, string> | null>(null)
// Bumped on every move so the blink animation restarts and the caret is
// visible straight after moving.
const caretKey = ref(0)

function state(): EditorState {
  return { root: props.modelValue, cursor: props.cursor, anchor: props.anchor }
}

const selection = computed(() => selectionOf(state()))

const html = computed(() =>
  katex.renderToString(
    rowToLatex(props.modelValue, { activeRow: props.active ? props.cursor.path : null }),
    KATEX_EDITOR_OPTIONS,
  ),
)

// While something is selected the selection box stands in for the caret.
const showCaret = computed(
  () =>
    props.active &&
    focused.value &&
    !selection.value &&
    caretStyle.value !== null &&
    !caretInPlaceholder.value,
)

const showSelection = computed(() => props.active && selectionStyle.value !== null)

function updateOverlays() {
  const container = surfaceEl.value
  const box = container ? caretBox(container, props.modelValue, props.cursor) : null

  caretStyle.value = box
    ? { left: `${box.left}px`, top: `${box.top}px`, height: `${box.height}px` }
    : null
  caretInPlaceholder.value = box?.placeholder ?? false

  const range = selection.value
  const area = container && range ? selectionBox(container, props.modelValue, range) : null
  selectionStyle.value = area
    ? {
        left: `${area.left}px`,
        top: `${area.top}px`,
        width: `${area.width}px`,
        height: `${area.height}px`,
      }
    : null
}

watch(
  [html, () => props.cursor, () => props.anchor, () => props.active],
  async () => {
    await nextTick()
    updateOverlays()
    caretKey.value++
  },
  { immediate: true, deep: true },
)

onMounted(() => {
  window.addEventListener('resize', updateOverlays)
  // Glyph metrics shift once the math fonts load.
  document.fonts?.ready.then(updateOverlays)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateOverlays)
  stopDrag()
})

// ↑/↓ land on the gap nearest the caret's current x position.
const pickByCaretX: PickOffset = (_target, targetPath) => {
  const container = surfaceEl.value
  const box = container ? caretBox(container, props.modelValue, props.cursor) : null

  if (!container || !box) return props.cursor.offset

  const x = container.getBoundingClientRect().left + box.left - container.scrollLeft
  return nearestOffset(container, props.modelValue, targetPath, x)
}

function navigate(next: EditorState) {
  emit('navigate', { cursor: next.cursor, anchor: next.anchor ?? null })
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

function handleKeydown(event: KeyboardEvent) {
  const current = state()

  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    navigate(selectAll(current))
    return
  }

  if (event.altKey || event.ctrlKey || event.metaKey) return

  let next: EditorState | null

  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowRight': {
      const direction = event.key === 'ArrowRight' ? 'forward' : 'backward'
      next = event.shiftKey
        ? extendSelection(current, direction)
        : navigateHorizontal(current, direction)
      break
    }
    case 'ArrowUp':
    case 'ArrowDown':
      next = navigateVertical(current, event.key === 'ArrowUp' ? 'up' : 'down', pickByCaretX)
      if (!next) return // let the parent move to the previous/next equation
      break
    case 'Home':
    case 'End': {
      const edge = event.key === 'Home' ? 'start' : 'end'
      next = event.shiftKey
        ? extendSelectionTo(current, edge)
        : {
            ...current,
            cursor: edge === 'start' ? cursorAtStart() : cursorAtEnd(current.root),
            anchor: null,
          }
      break
    }
    case 'Escape':
      if (!current.anchor) return
      next = collapseSelection(current)
      break
    default:
      handleEditKey(event, current)
      return
  }

  event.preventDefault()

  if (next) {
    navigate(next)
  }
}

// Keys that do nothing here bubble up for the parent to use.
const BUBBLE_WHEN_UNUSED = new Set(['Backspace', 'Delete', 'Tab'])

function handleEditKey(event: KeyboardEvent, current: EditorState) {
  if (props.readonly) return

  const command = commandForKey(event)
  if (!command) return

  const next = command(current)

  if (next === current) {
    if (!BUBBLE_WHEN_UNUSED.has(event.key)) event.preventDefault()
    return
  }

  event.preventDefault()
  emit('edit', next)
}

// ---------------------------------------------------------------------------
// Mouse: click to place the cursor, drag or Shift+click to select
// ---------------------------------------------------------------------------

let dragAnchor: Cursor | null = null

function cursorAt(event: MouseEvent): Cursor | null {
  const container = surfaceEl.value
  return container ? hitTest(container, props.modelValue, event.clientX, event.clientY) : null
}

function handleMousedown(event: MouseEvent) {
  // Stop the browser selecting KaTeX text; place the cursor ourselves.
  event.preventDefault()
  if (event.button !== 0) return

  const hit = cursorAt(event)
  if (!hit) return

  surfaceEl.value?.focus()

  const current = state()
  dragAnchor = event.shiftKey ? (current.anchor ?? current.cursor) : hit
  navigate(selectBetween(current, dragAnchor, hit))

  window.addEventListener('mousemove', handleDragMove)
  window.addEventListener('mouseup', stopDrag)
}

function handleDragMove(event: MouseEvent) {
  if (!dragAnchor) return
  const hit = cursorAt(event)
  if (hit) navigate(selectBetween(state(), dragAnchor, hit))
}

function stopDrag() {
  dragAnchor = null
  window.removeEventListener('mousemove', handleDragMove)
  window.removeEventListener('mouseup', stopDrag)
}

defineExpose({ focus: () => surfaceEl.value?.focus() })
</script>

<template>
  <div
    ref="surfaceEl"
    class="math-field"
    :class="{ active, focused }"
    tabindex="0"
    role="textbox"
    aria-label="Equation"
    @keydown="handleKeydown"
    @mousedown="handleMousedown"
    @focus="focused = true"
    @blur="focused = false"
  >
    <div v-if="showSelection" class="selection" :style="selectionStyle!"></div>
    <div v-if="showCaret" :key="caretKey" class="caret" :style="caretStyle!"></div>
    <div class="math-content" v-html="html"></div>
  </div>
</template>

<style scoped>
.math-field {
  position: relative;
  font-size: 1.35rem;
  min-height: 3.4rem;
  padding: 0.55rem 0.8rem;
  display: flex;
  align-items: center;
  cursor: text;
  overflow-x: auto;
  outline: none;
  border-radius: 6px;
}

.math-field.focused {
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.35);
}

.math-content {
  position: relative;
  z-index: 1;
  min-width: 0;
}

.selection {
  position: absolute;
  z-index: 0;
  border-radius: 3px;
  background: rgba(148, 163, 184, 0.3);
  pointer-events: none;
}

.math-field.focused .selection {
  background: rgba(37, 99, 235, 0.2);
}

.caret {
  position: absolute;
  z-index: 2;
  width: 2px;
  margin-left: -1px;
  background: #2563eb;
  pointer-events: none;
  animation: math-field-blink 1.1s step-end infinite;
}

.math-field :deep(.katex-display) {
  margin: 0;
  text-align: left;
}

.math-field :deep(.katex-display > .katex) {
  text-align: left;
}

.math-field :deep(.me-ph) {
  color: #94a3b8;
}

.math-field.focused :deep(.me-ph-active) {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.12);
  border-radius: 2px;
  animation: math-field-blink 1.1s step-end infinite;
}

@keyframes math-field-blink {
  50% {
    opacity: 0;
  }
}
</style>
