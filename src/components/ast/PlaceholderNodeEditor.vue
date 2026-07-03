<script setup lang="ts">
import type { NodePath } from '../../types/editor'

defineProps<{
  path: NodePath
}>()

const emit = defineEmits<{
  'update:modelValue': [
    value: { type: 'Identifier'; name: string } | { type: 'Number'; value: number },
  ]
  'focus-path': [path: NodePath]
}>()

function makeIdentifier() {
  emit('update:modelValue', {
    type: 'Identifier',
    name: 'x',
  })
}

function makeNumber() {
  emit('update:modelValue', {
    type: 'Number',
    value: 1,
  })
}
</script>

<template>
  <div class="placeholder" @click.stop="emit('focus-path', path)">
    □

    <button @click="makeIdentifier">Variable</button>

    <button @click="makeNumber">Number</button>
  </div>
</template>
