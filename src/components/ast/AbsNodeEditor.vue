<script setup lang="ts">
import AstNodeEditor from './AstNodeEditor.vue'
import type { AbsNode } from '../../types/ast'
import type { NodePath } from '../../types/editor'

defineProps<{
  modelValue: AbsNode
  path: NodePath
  focusedPath: NodePath | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: AbsNode]
  'focus-path': [path: NodePath]
}>()
</script>

<template>
  <div class="wrap-row">
    <span class="fence">|</span>
    <AstNodeEditor
      :model-value="modelValue.value"
      :path="[...path, 'value']"
      :focused-path="focusedPath"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="(value) => emit('update:modelValue', { ...modelValue, value })"
    />
    <span class="fence">|</span>
  </div>
</template>

<style scoped>
.wrap-row {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.fence {
  color: #334155;
  font-weight: 600;
}
</style>
