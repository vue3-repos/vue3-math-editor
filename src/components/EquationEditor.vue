<script setup lang="ts">
import { computed } from 'vue'

import AstNodeEditor from './ast/AstNodeEditor.vue'
import type { AstNode } from '../types/ast'
import type { NodePath } from '../types/editor'

const props = defineProps<{
  modelValue: AstNode | null
  focusedPath: NodePath | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: AstNode | null]
  'focus-path': [path: NodePath]
}>()

const ast = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const nonNullAst = computed(() => props.modelValue as AstNode)
</script>

<template>
  <div>
    <div v-if="!modelValue" class="empty-root" @click="emit('focus-path', [])">
      Empty equation. Type a letter/number or use toolbar to start.
    </div>

    <AstNodeEditor
      v-else
      :model-value="nonNullAst"
      :path="[]"
      :focused-path="focusedPath"
      @update:model-value="ast = $event"
      @focus-path="emit('focus-path', $event)"
    />
  </div>
</template>

<style scoped>
.empty-root {
  border: 1px dashed #94a3b8;
  border-radius: 0.5rem;
  padding: 0.75rem;
  color: #64748b;
  background: #f8fafc;
  cursor: text;
}
</style>
