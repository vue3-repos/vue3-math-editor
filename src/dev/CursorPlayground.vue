<script setup lang="ts">
// Development page for the cursor refactor (docs/cursor-refactor.md, step 3).
// Open /playground.html under `npm run dev`. Each field is navigable with the
// arrow keys, Home/End and the mouse; nothing is editable yet (step 4).
// The Playwright tests in tests/e2e drive this page.
import { computed, reactive } from 'vue'

import MathField from '../components/MathField.vue'
import { type Cursor, cursorAtStart } from '../editor/cursor'
import type { Row } from '../editor/layout'
import { parseRow } from '../editor/parse'
import { astToMathJson } from '../renderers/mathjson'
import { SAMPLES, describeCursor } from './samples'

interface LiveSample {
  id: string
  label: string
  row: Row
  cursor: Cursor
}

const samples = reactive<LiveSample[]>(
  SAMPLES.map((sample) => ({
    id: sample.id,
    label: sample.label,
    row: sample.build(),
    cursor: cursorAtStart(),
  })),
)

const parsed = computed(() =>
  samples.map((sample) => JSON.stringify(astToMathJson(parseRow(sample.row).ast))),
)
</script>

<template>
  <main class="playground">
    <h1>Cursor playground</h1>
    <p class="hint">
      Click a field, then use <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Home</kbd>
      <kbd>End</kbd>, or click anywhere in an equation. Editing arrives in step 4.
    </p>

    <section
      v-for="(sample, index) in samples"
      :key="sample.id"
      class="sample"
      :data-sample="sample.id"
    >
      <h2>{{ sample.label }}</h2>
      <MathField v-model:cursor="sample.cursor" :model-value="sample.row" class="field" />
      <dl>
        <dt>Cursor</dt>
        <dd data-role="cursor">{{ describeCursor(sample.cursor) }}</dd>
        <dt>MathJSON</dt>
        <dd>
          <code data-role="mathjson">{{ parsed[index] }}</code>
        </dd>
      </dl>
    </section>
  </main>
</template>

<style scoped>
.playground {
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem 1rem;
  font-family: system-ui, sans-serif;
  color: #0f172a;
}

.hint {
  color: #475569;
}

.sample {
  margin: 1.5rem 0;
}

.sample h2 {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0 0 0.35rem;
  color: #334155;
}

.field {
  background: white;
  border: 1px solid #e2e8f0;
}

dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.15rem 0.75rem;
  margin: 0.4rem 0 0;
  font-size: 0.85rem;
  color: #475569;
}

dt {
  font-weight: 600;
}

dd {
  margin: 0;
}

kbd {
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 0 0.3rem;
  font-size: 0.8rem;
  background: #f8fafc;
}
</style>
