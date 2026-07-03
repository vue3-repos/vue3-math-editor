<script setup lang="ts">
import type { NodePath } from '../../types/editor'

defineProps<{
  path: NodePath
  isFocused: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [
    value: { type: 'Identifier'; name: string } | { type: 'Number'; value: number },
  ]
  'focus-path': [path: NodePath]
}>()

function makeIdentifier() {
  emit('update:modelValue', {
    type: 'Identifier',
    name: 'x',
  })
}

function makeNumber() {
  emit('update:modelValue', {
    type: 'Number',
    value: 1,
  })
}
</script>

<template>
  <div class="placeholder" @click.stop="emit('focus-path', path)">
    <span v-if="isFocused" class="caret" aria-hidden="true"></span>
    <span v-else class="slot" aria-hidden="true">□</span>

    <button type="button" @click="makeIdentifier">x</button>

    <button type="button" @click="makeNumber">1</button>
  </div>
</template>

<style scoped>
.placeholder {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.05rem 0.25rem;
  border-radius: 0.3rem;
}

.slot {
  color: #94a3b8;
}

.caret {
  width: 2px;
  height: 1.1em;
  background: #0f172a;
  animation: blink 1s step-end infinite;
}

.placeholder button {
  font-size: 0.72rem;
  line-height: 1;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  border-radius: 0.25rem;
  padding: 0.2rem 0.35rem;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}
</style>
