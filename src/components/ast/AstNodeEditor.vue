<script setup lang="ts">
import { computed } from 'vue'
import katex from 'katex'

import IdentifierNodeEditor from './IdentifierNodeEditor.vue'
import NumberNodeEditor from './NumberNodeEditor.vue'
import AddNodeEditor from './AddNodeEditor.vue'
import MultiplyNodeEditor from './MultiplyNodeEditor.vue'
import SubtractNodeEditor from './SubtractNodeEditor.vue'
import NegateNodeEditor from './NegateNodeEditor.vue'
import AbsNodeEditor from './AbsNodeEditor.vue'
import RootNodeEditor from './RootNodeEditor.vue'
import FunctionCallNodeEditor from './FunctionCallNodeEditor.vue'
import EqualNodeEditor from './EqualNodeEditor.vue'
import DivideNodeEditor from './DivideNodeEditor.vue'
import PowerNodeEditor from './PowerNodeEditor.vue'
import DerivativeNodeEditor from './DerivativeNodeEditor.vue'
import PlaceholderNodeEditor from './PlaceholderNodeEditor.vue'
import type { AstNode } from '../../types/ast'
import type { NodePath } from '../../types/editor'
import { astToLatex } from '../../renderers/latex'

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

function isPathPrefix(prefix: NodePath, target: NodePath | null): boolean {
  if (!target || prefix.length > target.length) {
    return false
  }

  return prefix.every((segment, index) => segment === target[index])
}

const isActiveEditBranch = computed(() => {
  if (!props.focusedPath) {
    return true
  }

  return isPathPrefix(props.path, props.focusedPath)
})

const displayLatex = computed(() => astToLatex(props.modelValue))
const displayHtml = computed(() =>
  katex.renderToString(displayLatex.value, {
    throwOnError: false,
    displayMode: false,
    strict: 'ignore',
  }),
)
</script>

<template>
  <div
    class="node-shell"
    :class="{ focused: isSamePath(path, focusedPath) }"
    @click.self.stop="focusCurrentNode"
  >
    <button
      v-if="!isActiveEditBranch"
      type="button"
      class="node-display"
      @click.stop="focusCurrentNode"
    >
      <span v-html="displayHtml"></span>
    </button>

    <template v-else>
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

      <SubtractNodeEditor
        v-else-if="modelValue.type === 'Subtract'"
        :model-value="modelValue"
        :path="path"
        :focused-path="focusedPath"
        @focus-path="emit('focus-path', $event)"
        @update:model-value="emit('update:modelValue', $event)"
      />

      <NegateNodeEditor
        v-else-if="modelValue.type === 'Negate'"
        :model-value="modelValue"
        :path="path"
        :focused-path="focusedPath"
        @focus-path="emit('focus-path', $event)"
        @update:model-value="emit('update:modelValue', $event)"
      />

      <AbsNodeEditor
        v-else-if="modelValue.type === 'Abs'"
        :model-value="modelValue"
        :path="path"
        :focused-path="focusedPath"
        @focus-path="emit('focus-path', $event)"
        @update:model-value="emit('update:modelValue', $event)"
      />

      <RootNodeEditor
        v-else-if="modelValue.type === 'Root'"
        :model-value="modelValue"
        :path="path"
        :focused-path="focusedPath"
        @focus-path="emit('focus-path', $event)"
        @update:model-value="emit('update:modelValue', $event)"
      />

      <FunctionCallNodeEditor
        v-else-if="modelValue.type === 'FunctionCall'"
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
    </template>
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

.node-display {
  border: 1px solid #cbd5e1;
  border-radius: 0.35rem;
  background: #f8fafc;
  color: #0f172a;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 0.86rem;
  padding: 0.22rem 0.42rem;
  cursor: pointer;
}
</style>
