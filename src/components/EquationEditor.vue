<script setup lang="ts">
import { computed } from 'vue'

import AstNodeEditor from './ast/AstNodeEditor.vue'

const props = defineProps<{
  modelValue: any
}>()

const emit = defineEmits([
  'update:modelValue'
])

const ast = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})
</script>

<template>
  <div>
    <AstNodeEditor
      v-model="ast"
    />
  </div>
</template>
