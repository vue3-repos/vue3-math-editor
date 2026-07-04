<script setup lang="ts">
import AstNodeEditor from './AstNodeEditor.vue'
import type { DerivativeNode } from '../../types/ast'
import type { NodePath } from '../../types/editor'

const props = defineProps<{
  modelValue: DerivativeNode
  path: NodePath
  focusedPath: NodePath | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: DerivativeNode]
  'focus-path': [path: NodePath]
}>()

function leaveVariableInput(event: KeyboardEvent) {
  const target = event.currentTarget as HTMLInputElement | null

  event.preventDefault()
  event.stopPropagation()

  target?.blur()
  emit('focus-path', props.path)
}
</script>

<script lang="ts">
function getInputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}
</script>

<template>
  <div class="derivative">
    <button type="button" class="select-node" @click.stop="emit('focus-path', path)">d/d</button>

    <div class="derivative-expression">
      <span class="scaffold-token" @click.stop="emit('focus-path', path)">d(</span>
      <AstNodeEditor
        :model-value="modelValue.expression"
        :path="[...path, 'expression']"
        :focused-path="focusedPath"
        @focus-path="emit('focus-path', $event)"
        @update:model-value="
          (expression) =>
            emit('update:modelValue', {
              ...modelValue,
              expression,
            })
        "
      />
      <span class="scaffold-token" @click.stop="emit('focus-path', path)">)</span>
    </div>

    <div class="derivative-variable">
      <span class="scaffold-label" @click.stop="emit('focus-path', path)">with respect to</span>

      <input
        :value="modelValue.variable"
        @click.stop
        @focus="emit('focus-path', path)"
        @keydown.tab="leaveVariableInput"
        @keydown.enter="leaveVariableInput"
        @keydown.esc="leaveVariableInput"
        @keydown.right="leaveVariableInput"
        @input="
          emit('update:modelValue', {
            ...modelValue,
            variable: getInputValue($event),
          })
        "
      />
    </div>
  </div>
</template>

<style scoped>
.derivative {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.55rem;
}

.select-node {
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  background: #f8fafc;
  color: #0f172a;
  font-size: 0.72rem;
  line-height: 1;
  padding: 0.2rem 0.45rem;
  cursor: pointer;
}

.derivative-expression,
.derivative-variable {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.scaffold-token,
.scaffold-label {
  cursor: pointer;
  color: #334155;
}

.derivative-variable input {
  min-width: 3rem;
}
</style>
