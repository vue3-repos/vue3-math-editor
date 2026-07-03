<script setup lang="ts">
import { computed } from 'vue'

import AstNodeEditor from './ast/AstNodeEditor.vue'
import type { AstNode } from '../types/ast'
import type { NodePath } from '../types/editor'

const props = defineProps<{
  modelValue: AstNode
  focusedPath: NodePath | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: AstNode]
  'focus-path': [path: NodePath]
}>()

const ast = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})
</script>

<template>
  <div>
    <AstNodeEditor
      v-model="ast"
      :path="[]"
      :focused-path="focusedPath"
      @focus-path="emit('focus-path', $event)"
    />
  </div>
</template>
