<script setup lang="ts">
import IdentifierNodeEditor from './IdentifierNodeEditor.vue'
import NumberNodeEditor from './NumberNodeEditor.vue'
import AddNodeEditor from './AddNodeEditor.vue'
import MultiplyNodeEditor from './MultiplyNodeEditor.vue'
import EqualNodeEditor from './EqualNodeEditor.vue'
import DivideNodeEditor from './DivideNodeEditor.vue'
import PowerNodeEditor from './PowerNodeEditor.vue'
import DerivativeNodeEditor from './DerivativeNodeEditor.vue'
import PlaceholderNodeEditor from './PlaceholderNodeEditor.vue'
import type { AstNode } from '../../types/ast'
import type { NodePath } from '../../types/editor'

const props = defineProps<{
  modelValue: AstNode
  path: NodePath
  focusedPath: NodePath | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: AstNode]
  'focus-path': [path: NodePath]
}>()

function isSamePath(a: NodePath, b: NodePath | null): boolean {
  if (!b || a.length !== b.length) {
    return false
  }

  return a.every((segment, index) => segment === b[index])
}

function focusCurrentNode() {
  emit('focus-path', props.path)
}
</script>

<template>
  <div
    class="node-shell"
    :class="{ focused: isSamePath(path, focusedPath) }"
    @click.stop="focusCurrentNode"
  >
    <IdentifierNodeEditor
      v-if="modelValue.type === 'Identifier'"
      :model-value="modelValue"
      :path="path"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <NumberNodeEditor
      v-else-if="modelValue.type === 'Number'"
      :model-value="modelValue"
      :path="path"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <AddNodeEditor
      v-else-if="modelValue.type === 'Add'"
      :model-value="modelValue"
      :path="path"
      :focused-path="focusedPath"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <MultiplyNodeEditor
      v-else-if="modelValue.type === 'Multiply'"
      :model-value="modelValue"
      :path="path"
      :focused-path="focusedPath"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <EqualNodeEditor
      v-else-if="modelValue.type === 'Equal'"
      :model-value="modelValue"
      :path="path"
      :focused-path="focusedPath"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <DivideNodeEditor
      v-else-if="modelValue.type === 'Divide'"
      :model-value="modelValue"
      :path="path"
      :focused-path="focusedPath"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <PowerNodeEditor
      v-else-if="modelValue.type === 'Power'"
      :model-value="modelValue"
      :path="path"
      :focused-path="focusedPath"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <DerivativeNodeEditor
      v-else-if="modelValue.type === 'Derivative'"
      :model-value="modelValue"
      :path="path"
      :focused-path="focusedPath"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <PlaceholderNodeEditor
      v-else
      :model-value="modelValue"
      :path="path"
      :is-focused="isSamePath(path, focusedPath)"
      @focus-path="emit('focus-path', $event)"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </div>
</template>

<style scoped>
.node-shell {
  border: 1px dashed transparent;
  border-radius: 0.35rem;
  padding: 0.1rem;
}

.node-shell.focused {
  border-color: #22c55e;
  background: #f0fdf4;
}
</style>
