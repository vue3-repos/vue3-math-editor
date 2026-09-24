<script setup lang="ts">
import { ref } from 'vue'

import EquationWorkbench from './components/EquationWorkbench.vue'
import type { EquationLine, UnitsIssue, VariableUnits } from './editor/units'

// Demo switch: open the page with ?cellml for CellML mode.
const cellml = new URLSearchParams(window.location.search).has('cellml')

// The units interface, driven from outside for now (the browser tests use
// it): window.__workbench.lines is the latest equations-change payload, and
// window.__workbench.setUnits({ issues, variableUnits }) sets those props. A
// units checker (such as libCellML) will take this place.
const issues = ref<UnitsIssue[]>([])
const variableUnits = ref<VariableUnits | undefined>(undefined)
const lines = ref<EquationLine[]>([])

Object.assign(window, {
  __workbench: {
    get lines() {
      return lines.value
    },
    setUnits(units: { issues?: UnitsIssue[]; variableUnits?: VariableUnits }) {
      issues.value = units.issues ?? []
      variableUnits.value = units.variableUnits
    },
  },
})
</script>

<template>
  <main class="app-shell">
    <section class="hero">
      <h1>Math Equation Workbench</h1>
      <p>Canonical AST editing for LaTeX and Content MathML output.</p>
    </section>

    <EquationWorkbench
      :cellml="cellml"
      :issues="issues"
      :variable-units="variableUnits"
      @equations-change="lines = $event"
    />
  </main>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  padding: 2rem 1rem 3rem;
  background:
    radial-gradient(circle at 15% 15%, #f1f5ff 0%, #f8fafc 35%),
    radial-gradient(circle at 85% 0%, #dcfce7 0%, transparent 40%), #f8fafc;
}

.hero {
  max-width: 1100px;
  margin: 0 auto 1.25rem;
}

.hero h1 {
  margin: 0;
  font-size: clamp(1.5rem, 3vw, 2.2rem);
  letter-spacing: -0.02em;
  color: #0f172a;
}

.hero p {
  margin: 0.35rem 0 0;
  color: #334155;
}
</style>
