<script setup lang="ts">
import AstNodeEditor from './AstNodeEditor.vue'
import type { PowerNode } from '../../types/ast'
import type { NodePath } from '../../types/editor'

defineProps<{
  modelValue: PowerNode
  path: NodePath
  focusedPath: NodePath | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: PowerNode]
  'focus-path': [path: NodePath]
}>()
</script>

<template>
  <div>
    <AstNodeEditor
      :model-value="modelValue.base"
      :path="[...path, 'base']"
      :focused-path="focusedPath"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="
        (base) =>
          emit('update:modelValue', {
            ...modelValue,
            base,
          })
      "
    />

    <sup>
      <AstNodeEditor
        :model-value="modelValue.exponent"
        :path="[...path, 'exponent']"
        :focused-path="focusedPath"
        @focus-path="emit('focus-path', $event)"
        @update:model-value="
          (exponent) =>
            emit('update:modelValue', {
              ...modelValue,
              exponent,
            })
        "
      />
    </sup>
  </div>
</template>
