<script setup lang="ts">
import AstNodeEditor from './AstNodeEditor.vue'
import type { SubtractNode } from '../../types/ast'
import type { NodePath } from '../../types/editor'

defineProps<{
  modelValue: SubtractNode
  path: NodePath
  focusedPath: NodePath | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: SubtractNode]
  'focus-path': [path: NodePath]
}>()
</script>

<template>
  <div class="infix-row">
    <AstNodeEditor
      :model-value="modelValue.minuend"
      :path="[...path, 'minuend']"
      :focused-path="focusedPath"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="(minuend) => emit('update:modelValue', { ...modelValue, minuend })"
    />

    <span class="operator">-</span>

    <AstNodeEditor
      :model-value="modelValue.subtrahend"
      :path="[...path, 'subtrahend']"
      :focused-path="focusedPath"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="(subtrahend) => emit('update:modelValue', { ...modelValue, subtrahend })"
    />
  </div>
</template>

<style scoped>
.infix-row {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.operator {
  color: #334155;
  font-weight: 600;
}
</style>
