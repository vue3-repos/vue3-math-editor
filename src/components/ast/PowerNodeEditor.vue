<script setup lang="ts">
import AstNodeEditor from './AstNodeEditor.vue'

const props = defineProps<{
  modelValue: any
}>()

const emit = defineEmits([
  'update:modelValue'
])
</script>

<template>
  <div>
    <AstNodeEditor
      :model-value="modelValue.base"
      @update:model-value="
        base =>
          emit('update:modelValue', {
            ...modelValue,
            base,
          })
      "
    />

    <sup>
      <AstNodeEditor
        :model-value="modelValue.exponent"
        @update:model-value="
          exponent =>
            emit('update:modelValue', {
              ...modelValue,
              exponent,
            })
        "
      />
    </sup>
  </div>
</template>
