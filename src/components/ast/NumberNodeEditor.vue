<script setup lang="ts">
const props = defineProps<{
  modelValue: {
    type: 'Number'
    value: number
  }
}>()

const emit = defineEmits([
  'update:modelValue'
])

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
    @input="update(Number(($event.target as HTMLInputElement).value))"
  />
</template>
