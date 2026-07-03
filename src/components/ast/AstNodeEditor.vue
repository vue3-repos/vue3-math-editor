<script setup lang="ts">
import IdentifierNodeEditor from './IdentifierNodeEditor.vue'
import NumberNodeEditor from './NumberNodeEditor.vue'
import DivideNodeEditor from './DivideNodeEditor.vue'
import PowerNodeEditor from './PowerNodeEditor.vue'
import DerivativeNodeEditor from './DerivativeNodeEditor.vue'
import PlaceholderNodeEditor from './PlaceholderNodeEditor.vue'

defineProps<{
  modelValue: any
}>()

defineEmits<{
  'update:modelValue': [value: any]
}>()
</script>

<template>
  <IdentifierNodeEditor
    v-if="modelValue.type === 'Identifier'"
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
  />

  <NumberNodeEditor
    v-else-if="modelValue.type === 'Number'"
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
  />

  <DivideNodeEditor
    v-else-if="modelValue.type === 'Divide'"
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
  />

  <PowerNodeEditor
    v-else-if="modelValue.type === 'Power'"
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
  />

  <DerivativeNodeEditor
    v-else-if="modelValue.type === 'Derivative'"
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
  />

  <PlaceholderNodeEditor
    v-else
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
  />
</template>