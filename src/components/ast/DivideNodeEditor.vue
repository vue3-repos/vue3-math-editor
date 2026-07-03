<script setup lang="ts">
import AstNodeEditor from './AstNodeEditor.vue'
import type { DivideNode } from '../../types/ast'
import type { NodePath } from '../../types/editor'

const props = defineProps<{
  modelValue: DivideNode
  path: NodePath
  focusedPath: NodePath | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: DivideNode]
  'focus-path': [path: NodePath]
}>()

function updateNumerator(numerator: DivideNode['numerator']) {
  emit('update:modelValue', {
    ...props.modelValue,
    numerator,
  })
}

function updateDenominator(denominator: DivideNode['denominator']) {
  emit('update:modelValue', {
    ...props.modelValue,
    denominator,
  })
}
</script>

<template>
  <div class="fraction">
    <AstNodeEditor
      :model-value="modelValue.numerator"
      :path="[...path, 'numerator']"
      :focused-path="focusedPath"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="updateNumerator"
    />

    <hr />

    <AstNodeEditor
      :model-value="modelValue.denominator"
      :path="[...path, 'denominator']"
      :focused-path="focusedPath"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="updateDenominator"
    />
  </div>
</template>
