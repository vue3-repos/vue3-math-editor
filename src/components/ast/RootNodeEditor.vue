<script setup lang="ts">
import AstNodeEditor from './AstNodeEditor.vue'
import type { RootNode } from '../../types/ast'
import type { NodePath } from '../../types/editor'

defineProps<{
  modelValue: RootNode
  path: NodePath
  focusedPath: NodePath | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: RootNode]
  'focus-path': [path: NodePath]
}>()
</script>

<template>
  <div class="root-row">
    <sup v-if="modelValue.degree">
      <AstNodeEditor
        :model-value="modelValue.degree"
        :path="[...path, 'degree']"
        :focused-path="focusedPath"
        @focus-path="emit('focus-path', $event)"
        @update:model-value="(degree) => emit('update:modelValue', { ...modelValue, degree })"
      />
    </sup>

    <span class="radical">sqrt</span>
    <AstNodeEditor
      :model-value="modelValue.radicand"
      :path="[...path, 'radicand']"
      :focused-path="focusedPath"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="(radicand) => emit('update:modelValue', { ...modelValue, radicand })"
    />
  </div>
</template>

<style scoped>
.root-row {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.radical {
  color: #334155;
  font-weight: 600;
}
</style>
