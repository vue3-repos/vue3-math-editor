<script setup lang="ts">
import AstNodeEditor from './AstNodeEditor.vue'

const props = defineProps<{
  modelValue: any
}>()

const emit = defineEmits([
  'update:modelValue'
])

function updateNumerator(numerator: any) {
  emit('update:modelValue', {
    ...props.modelValue,
    numerator,
  })
}

function updateDenominator(denominator: any) {
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
      @update:model-value="updateNumerator"
    />

    <hr>

    <AstNodeEditor
      :model-value="modelValue.denominator"
      @update:model-value="updateDenominator"
    />
  </div>
</template>
