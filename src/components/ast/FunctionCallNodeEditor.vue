<script setup lang="ts">
import AstNodeEditor from './AstNodeEditor.vue'
import type { FunctionCallNode } from '../../types/ast'
import type { NodePath } from '../../types/editor'

const props = defineProps<{
  modelValue: FunctionCallNode
  path: NodePath
  focusedPath: NodePath | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: FunctionCallNode]
  'focus-path': [path: NodePath]
}>()

function updateName(name: string) {
  emit('update:modelValue', {
    ...props.modelValue,
    name,
  })
}

function updateArg(index: number, arg: FunctionCallNode['args'][number]) {
  const args = [...props.modelValue.args]
  args[index] = arg
  emit('update:modelValue', {
    ...props.modelValue,
    args,
  })
}
</script>

<template>
  <div class="function-row">
    <input
      class="function-name"
      :value="modelValue.name"
      @input="updateName(($event.target as HTMLInputElement).value)"
    />
    <span>(</span>
    <template v-for="(arg, index) in modelValue.args" :key="index">
      <span v-if="index > 0">,</span>
      <AstNodeEditor
        :model-value="arg"
        :path="[...path, 'args', index]"
        :focused-path="focusedPath"
        @focus-path="emit('focus-path', $event)"
        @update:model-value="(nextArg) => updateArg(index, nextArg)"
      />
    </template>
    <span>)</span>
  </div>
</template>

<style scoped>
.function-row {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.function-name {
  width: 4.5rem;
}
</style>
