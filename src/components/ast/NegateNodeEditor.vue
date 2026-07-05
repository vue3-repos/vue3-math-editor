<script setup lang="ts">
import AstNodeEditor from './AstNodeEditor.vue'
import type { NegateNode } from '../../types/ast'
import type { NodePath } from '../../types/editor'

defineProps<{
  modelValue: NegateNode
  path: NodePath
  focusedPath: NodePath | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: NegateNode]
  'focus-path': [path: NodePath]
}>()
</script>

<template>
  <div class="prefix-row">
    <span class="operator">-</span>
    <AstNodeEditor
      :model-value="modelValue.value"
      :path="[...path, 'value']"
      :focused-path="focusedPath"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="(value) => emit('update:modelValue', { ...modelValue, value })"
    />
  </div>
</template>

<style scoped>
.prefix-row {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.operator {
  color: #334155;
  font-weight: 600;
}
</style>
