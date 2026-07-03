<script setup lang="ts">
import { ref, computed } from 'vue'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Divider from 'primevue/divider'
import Tag from 'primevue/tag'

import EquationEditor from './EquationEditor.vue'

import { astToLatex } from '../renderers/latex'
import { astToContentMathML } from '../renderers/mathml'
import type { AstNode } from '../types/ast'

const ast = ref<AstNode>({
  type: 'Identifier',
  name: 'x',
})

function insertFraction() {
  ast.value = {
    type: 'Divide',
    numerator: {
      type: 'Identifier',
      name: 'a',
    },
    denominator: {
      type: 'Identifier',
      name: 'b',
    },
  }
}

function insertPower() {
  ast.value = {
    type: 'Power',
    base: {
      type: 'Identifier',
      name: 'x',
    },
    exponent: {
      type: 'Number',
      value: 2,
    },
  }
}

function insertDerivative() {
  ast.value = {
    type: 'Derivative',
    expression: {
      type: 'Identifier',
      name: 'y',
    },
    variable: 'x',
  }
}

const latex = computed(() => astToLatex(ast.value))
const mathml = computed(() => astToContentMathML(ast.value).trim())
</script>

<template>
  <section class="editor-grid">
    <Card class="editor-card">
      <template #title>
        <div class="header-row">
          <span>Equation Builder</span>
          <Tag severity="info" value="AST First" />
        </div>
      </template>

      <template #subtitle>
        Insert structured operations and keep derivative semantics distinct from fractions.
      </template>

      <template #content>
        <div class="toolbar">
          <Button icon="pi pi-slash" label="Fraction" size="small" @click="insertFraction" />
          <Button
            icon="pi pi-superscript"
            label="Power"
            size="small"
            outlined
            @click="insertPower"
          />
          <Button
            icon="pi pi-forward"
            label="Derivative"
            size="small"
            severity="contrast"
            @click="insertDerivative"
          />
        </div>

        <Divider />

        <EquationEditor v-model="ast" />
        
      </template>
    </Card>

    <Card class="output-card" aria-labelledby="ast-preview-title">
      <template #title>
        <div id="ast-preview-title">AST Preview</div>
      </template>
      <template #content>
        <pre>{{ JSON.stringify(ast, null, 2) }}</pre>
      </template>
    </Card>

    <Card class="output-card" aria-labelledby="mathml-preview-title">
      <template #title>
        <div id="mathml-preview-title">Content MathML</div>
      </template>
      <template #content>
        <pre>{{ mathml }}</pre>
      </template>
    </Card>

    <Card class="output-card" aria-labelledby="latex-preview-title">
      <template #title>
        <div id="latex-preview-title">LaTeX</div>
      </template>
      <template #content>
        <pre>{{ latex }}</pre>
      </template>
    </Card>
  </section>
</template>

<style scoped>
.editor-grid {
  max-width: 1100px;
  margin: 0 auto;
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  align-items: start;
}

.editor-card {
  grid-row: span 3;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.math-field-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.section-label {
  color: #475569;
  font-size: 0.9rem;
}

.math-field {
  width: 100%;
  min-height: 5rem;
  border: 1px solid #cbd5e1;
  border-radius: 0.65rem;
  background: #fff;
  padding: 0.75rem;
}

.output-card pre {
  margin: 0;
  overflow: auto;
  border-radius: 0.55rem;
  background: #0f172a;
  color: #e2e8f0;
  padding: 0.85rem;
  font-size: 0.83rem;
  line-height: 1.35;
}

@media (max-width: 900px) {
  .editor-grid {
    grid-template-columns: 1fr;
  }

  .editor-card {
    grid-row: auto;
  }
}
</style>
