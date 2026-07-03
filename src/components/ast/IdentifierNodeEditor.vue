<script setup lang="ts">
const props = defineProps<{
  modelValue: {
    type: 'Identifier'
    name: string
  }
}>()

const emit = defineEmits([
  'update:modelValue'
])

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
    @input="update(($event.target as HTMLInputElement).value)"
  />
</template>
