<script setup lang="ts">
import type { NodePath } from '../../types/editor'

const props = defineProps<{
  modelValue: {
    type: 'Number'
    value: number
  }
  path: NodePath
}>()

const emit = defineEmits<{
  'update:modelValue': [value: { type: 'Number'; value: number }]
  'focus-path': [path: NodePath]
}>()

function update(value: number) {
  emit('update:modelValue', {
    ...props.modelValue,
    value,
  })
}
</script>

<template>
  <input
    type="number"
    :value="modelValue.value"
    @focus="emit('focus-path', path)"
    @input="update(Number(($event.target as HTMLInputElement).value))"
  />
</template>
