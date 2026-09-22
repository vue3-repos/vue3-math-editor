<script setup lang="ts">
// A cursor-only math surface: renders a layout row with KaTeX, draws the
// caret as an overlay, and turns arrow keys and clicks into new cursor
// positions. It never changes the equation itself; editing commands arrive
// in step 4 (keys it doesn't handle bubble up to the parent).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import katex from 'katex'

import { caretBox, hitTest, nearestOffset } from '../editor/caretGeometry'
import {
  type Cursor,
  type PickOffset,
  cursorAtEnd,
  cursorAtStart,
  moveDown,
  moveLeft,
  moveRight,
  moveUp,
} from '../editor/cursor'
import type { Row } from '../editor/layout'
import { KATEX_EDITOR_OPTIONS, rowToLatex } from '../renderers/layoutLatex'

const props = withDefaults(
  defineProps<{
    modelValue: Row
    cursor: Cursor
    active?: boolean
  }>(),
  { active: true },
)

const emit = defineEmits<{
  'update:cursor': [cursor: Cursor]
}>()

const surfaceEl = ref<HTMLElement | null>(null)
const focused = ref(false)
const caretStyle = ref<Record<string, string> | null>(null)
const caretInPlaceholder = ref(false)
// Bumped on every move so the blink animation restarts and the caret is
// visible straight after moving.
const caretKey = ref(0)

const html = computed(() =>
  katex.renderToString(
    rowToLatex(props.modelValue, { activeRow: props.active ? props.cursor.path : null }),
    KATEX_EDITOR_OPTIONS,
  ),
)

const showCaret = computed(
  () => props.active && focused.value && caretStyle.value !== null && !caretInPlaceholder.value,
)

function updateCaret() {
  const container = surfaceEl.value
  const box = container ? caretBox(container, props.modelValue, props.cursor) : null

  caretStyle.value = box
    ? { left: `${box.left}px`, top: `${box.top}px`, height: `${box.height}px` }
    : null
  caretInPlaceholder.value = box?.placeholder ?? false
}

watch(
  [html, () => props.cursor, () => props.active],
  async () => {
    await nextTick()
    updateCaret()
    caretKey.value++
  },
  { immediate: true, deep: true },
)

onMounted(() => {
  window.addEventListener('resize', updateCaret)
  // Glyph metrics shift once the math fonts load.
  document.fonts?.ready.then(updateCaret)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateCaret)
})

// ↑/↓ land on the gap nearest the caret's current x position.
const pickByCaretX: PickOffset = (_target, targetPath) => {
  const container = surfaceEl.value
  const box = container ? caretBox(container, props.modelValue, props.cursor) : null

  if (!container || !box) return props.cursor.offset

  const x = container.getBoundingClientRect().left + box.left - container.scrollLeft
  return nearestOffset(container, props.modelValue, targetPath, x)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey) return

  const row = props.modelValue
  const cursor = props.cursor
  let next: Cursor | null

  switch (event.key) {
    case 'ArrowLeft':
      next = moveLeft(row, cursor)
      break
    case 'ArrowRight':
      next = moveRight(row, cursor)
      break
    case 'ArrowUp':
      next = moveUp(row, cursor, pickByCaretX)
      if (!next) return // let the parent move to the previous equation
      break
    case 'ArrowDown':
      next = moveDown(row, cursor, pickByCaretX)
      if (!next) return
      break
    case 'Home':
      next = cursorAtStart()
      break
    case 'End':
      next = cursorAtEnd(row)
      break
    default:
      return
  }

  event.preventDefault()

  if (next) {
    emit('update:cursor', next)
  }
}

function handleMousedown(event: MouseEvent) {
  // Stop the browser selecting KaTeX text; place the cursor ourselves.
  event.preventDefault()

  const container = surfaceEl.value
  if (!container) return

  container.focus()
  emit('update:cursor', hitTest(container, props.modelValue, event.clientX, event.clientY))
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
  min-width: 0;
}

.caret {
  position: absolute;
  z-index: 1;
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
