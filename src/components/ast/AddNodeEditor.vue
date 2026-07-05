<script setup lang="ts">
import AstNodeEditor from './AstNodeEditor.vue'
import type { AddNode } from '../../types/ast'
import type { NodePath } from '../../types/editor'

const props = defineProps<{
  modelValue: AddNode
  path: NodePath
  focusedPath: NodePath | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: AddNode]
  'focus-path': [path: NodePath]
}>()

function updateChild(index: number, child: AddNode['children'][number]) {
  const children = [...props.modelValue.children]
  children[index] = child
  emit('update:modelValue', {
    ...props.modelValue,
    children,
  })
}
</script>

<template>
  <div class="infix-row">
    <template v-for="(child, index) in modelValue.children" :key="index">
      <span v-if="index > 0" class="operator">+</span>

      <AstNodeEditor
        :model-value="child"
        :path="[...path, 'children', index]"
        :focused-path="focusedPath"
        @focus-path="emit('focus-path', $event)"
        @update:model-value="(nextChild) => updateChild(index, nextChild)"
      />
    </template>
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
