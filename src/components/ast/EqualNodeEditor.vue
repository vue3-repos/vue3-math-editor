<script setup lang="ts">
import AstNodeEditor from './AstNodeEditor.vue'
import type { EqualNode } from '../../types/ast'
import type { NodePath } from '../../types/editor'

defineProps<{
  modelValue: EqualNode
  path: NodePath
  focusedPath: NodePath | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: EqualNode]
  'focus-path': [path: NodePath]
}>()
</script>

<template>
  <div class="infix-row">
    <AstNodeEditor
      :model-value="modelValue.left"
      :path="[...path, 'left']"
      :focused-path="focusedPath"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="(left) => emit('update:modelValue', { ...modelValue, left })"
    />

    <span class="operator">=</span>

    <AstNodeEditor
      :model-value="modelValue.right"
      :path="[...path, 'right']"
      :focused-path="focusedPath"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="(right) => emit('update:modelValue', { ...modelValue, right })"
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
