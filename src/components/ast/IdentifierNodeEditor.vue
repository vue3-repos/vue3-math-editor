<script setup lang="ts">
import type { NodePath } from '../../types/editor'

const props = defineProps<{
  modelValue: {
    type: 'Identifier'
    name: string
  }
  path: NodePath
}>()

const emit = defineEmits<{
  'update:modelValue': [value: { type: 'Identifier'; name: string }]
  'focus-path': [path: NodePath]
}>()

function update(name: string) {
  emit('update:modelValue', {
    ...props.modelValue,
    name,
  })
}
</script>

<template>
  <input
    :value="modelValue.name"
    @focus="emit('focus-path', path)"
    @input="update(($event.target as HTMLInputElement).value)"
  />
</template>
