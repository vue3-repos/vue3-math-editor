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
  <div class="derivative">
    <div>
      d(
      <AstNodeEditor
        :model-value="modelValue.expression"
        @update:model-value="
          expression =>
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
        @input="
          emit('update:modelValue', {
            ...modelValue,
            variable: $event.target.value,
          })
        "
      />
    </div>
  </div>
</template>
