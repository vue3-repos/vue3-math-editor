<script setup lang="ts">
const emit = defineEmits([
  'update:modelValue'
])

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
  <div class="placeholder">
    □

    <button @click="makeIdentifier">
      Variable
    </button>

    <button @click="makeNumber">
      Number
    </button>
  </div>
</template>
