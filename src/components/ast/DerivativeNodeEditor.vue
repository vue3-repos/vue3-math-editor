<script setup lang="ts">
import AstNodeEditor from './AstNodeEditor.vue'
import type { DerivativeNode } from '../../types/ast'
import type { NodePath } from '../../types/editor'

defineProps<{
  modelValue: DerivativeNode
  path: NodePath
  focusedPath: NodePath | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: DerivativeNode]
  'focus-path': [path: NodePath]
}>()
</script>

<script lang="ts">
function getInputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}
</script>

<template>
  <div class="derivative">
    <div>
      d(
      <AstNodeEditor
        :model-value="modelValue.expression"
        :path="[...path, 'expression']"
        :focused-path="focusedPath"
        @focus-path="emit('focus-path', $event)"
        @update:model-value="
          (expression) =>
            emit('update:modelValue', {
              ...modelValue,
              expression,
            })
        "
      />
      )
    </div>

    <div>
      with respect to

      <input
        :value="modelValue.variable"
        @focus="emit('focus-path', path)"
        @input="
          emit('update:modelValue', {
            ...modelValue,
            variable: getInputValue($event),
          })
        "
      />
    </div>
  </div>
</template>
