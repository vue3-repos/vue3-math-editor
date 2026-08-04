<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import katex from 'katex'

import { astToInteractiveLatex, decodePath, encodePath } from '../renderers/interactiveLatex'
import type { AstNode } from '../types/ast'
import type { NodePath } from '../types/editor'

const props = defineProps<{
  modelValue: AstNode | null
  focusedPath: NodePath | null
  isActive: boolean
}>()

const emit = defineEmits<{
  'focus-path': [path: NodePath]
}>()

const surfaceEl = ref<HTMLElement | null>(null)
const ringStyle = ref<Record<string, string> | null>(null)

const html = computed(() => {
  const ast: AstNode = props.modelValue ?? { type: 'Placeholder' }
  const latex = astToInteractiveLatex(ast, props.isActive ? props.focusedPath : null)

  return katex.renderToString(latex, {
    throwOnError: false,
    displayMode: true,
    strict: 'ignore',
    trust: (context) => context.command === '\\htmlData' || context.command === '\\htmlClass',
  })
})

// KaTeX marks the focused node with an inline span, but an inline element's
// CSS background only covers its own line box, not tall children such as
// fractions. Measure the span instead and draw an absolutely positioned ring.
function updateRing() {
  const container = surfaceEl.value

  if (!container || !props.isActive || !props.focusedPath) {
    ringStyle.value = null
    return
  }

  const target = container.querySelector(`[data-path="${encodePath(props.focusedPath)}"]`)

  if (!target) {
    ringStyle.value = null
    return
  }

  const rect = target.getBoundingClientRect()
  const base = container.getBoundingClientRect()
  const pad = 3

  ringStyle.value = {
    left: `${rect.left - base.left + container.scrollLeft - pad}px`,
    top: `${rect.top - base.top + container.scrollTop - pad}px`,
    width: `${rect.width + pad * 2}px`,
    height: `${rect.height + pad * 2}px`,
  }
}

async function scheduleRingUpdate() {
  await nextTick()
  updateRing()
}

watch([html, () => props.focusedPath, () => props.isActive], scheduleRingUpdate, {
  immediate: true,
})

onMounted(() => {
  window.addEventListener('resize', updateRing)
  // Re-measure once the math fonts finish loading; glyph metrics shift.
  document.fonts?.ready.then(updateRing)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateRing)
})

function handleClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  const annotated = target?.closest('[data-path]')
  const path = decodePath(annotated?.getAttribute('data-path'))
  emit('focus-path', path ?? [])
}

function handleMousedown(event: MouseEvent) {
  // Keep browser text-selection and focus changes from fighting the editor's
  // own node selection model.
  event.preventDefault()
}
</script>

<template>
  <div
    ref="surfaceEl"
    class="math-surface"
    :class="{ active: isActive }"
    @mousedown="handleMousedown"
    @click="handleClick"
  >
    <div v-if="ringStyle" class="focus-ring" :style="ringStyle"></div>
    <div class="math-content" v-html="html"></div>
  </div>
</template>

<style scoped>
.math-surface {
  position: relative;
  font-size: 1.35rem;
  min-height: 3.4rem;
  padding: 0.55rem 0.8rem;
  display: flex;
  align-items: center;
  cursor: text;
  overflow-x: auto;
}

.math-content {
  position: relative;
  z-index: 1;
  min-width: 0;
}

.focus-ring {
  position: absolute;
  z-index: 0;
  border: 1.5px solid rgba(37, 99, 235, 0.55);
  background: rgba(37, 99, 235, 0.1);
  border-radius: 5px;
  pointer-events: none;
}

.math-surface :deep(.katex-display) {
  margin: 0;
  text-align: left;
}

.math-surface :deep(.katex-display > .katex) {
  text-align: left;
}

.math-surface :deep([data-path]) {
  cursor: pointer;
}
</style>

<style>
/* Global styles for KaTeX-generated spans (v-html content cannot be scoped). */
.math-surface .me-ph {
  color: #94a3b8;
}

.math-surface .me-focused .me-ph,
.math-surface .me-ph.me-focused {
  color: #2563eb;
  animation: me-blink 1.1s step-end infinite;
}

@keyframes me-blink {
  50% {
    opacity: 0.25;
  }
}
</style>
