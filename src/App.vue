<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from 'primevue/button'

import EquationWorkbench from './components/EquationWorkbench.vue'
import type { EquationLine, UnitsIssue, VariableUnits } from './editor/units'
import type { UnitsSource } from './units/library'
import UnitsPanel from './units/UnitsPanel.vue'
import { useUnitsChecker } from './units/useUnitsChecker'
import exampleUnits from './demo/example-units.cellml?raw'

// Demo switches: ?cellml for CellML mode; ?nolibcellml to run without the
// libCellML plugin (see main.ts), as an application without it would.
const cellml = new URLSearchParams(window.location.search).has('cellml')

const lines = ref<EquationLine[]>([])
const sources = ref<UnitsSource[]>([])
const variableUnits = ref<VariableUnits>({})

// Units checking with libCellML, if the plugin is installed.
// It starts once some units are given, so that equations written without
// units aren't all reported as missing them.
const checker = useUnitsChecker({
  lines,
  sources,
  variableUnits,
  enabled: () => sources.value.length > 0 || Object.keys(variableUnits.value).length > 0,
})

// Issues set from outside (browser tests, through window.__workbench) take the
// place of the checker's once given.
const hostIssues = ref<UnitsIssue[] | null>(null)
const issues = computed(() => hostIssues.value ?? checker.issues.value)

// Hover hints once there is something to say: units checking, or units given.
const hintUnits = computed(() =>
  checker.available.value || Object.keys(variableUnits.value).length
    ? variableUnits.value
    : undefined,
)

// An example to try: units for a membrane equation such as
// dV/dt = -(I_ion - I_stim)/C_m with I_ion = g_K*n^4*(V - E_K).
const EXAMPLE_VARIABLES: VariableUnits = {
  V: 'mV',
  t: 'ms',
  C_m: 'uF_per_cm2',
  I_ion: 'uA_per_cm2',
  I_stim: 'uA_per_cm2',
  g_K: 'mS_per_cm2',
  E_K: 'mV',
  n: 'dimensionless',
}

function loadExample() {
  sources.value = [
    ...sources.value.filter((source) => source.name !== 'example-units.cellml'),
    { name: 'example-units.cellml', text: exampleUnits },
  ]
  variableUnits.value = { ...EXAMPLE_VARIABLES, ...variableUnits.value }
}

// For the browser tests: window.__workbench.lines is the latest
// equations-change payload; setUnits({ issues, variableUnits }) sets them.
Object.assign(window, {
  __workbench: {
    get lines() {
      return lines.value
    },
    setUnits(units: { issues?: UnitsIssue[]; variableUnits?: VariableUnits }) {
      // From then on the test, not the checker, gives the issues.
      hostIssues.value = units.issues ?? []
      variableUnits.value = units.variableUnits ?? {}
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
      :variable-units="hintUnits"
      @equations-change="lines = $event"
    >
      <template #below-editor>
        <UnitsPanel
          v-model:sources="sources"
          v-model:variable-units="variableUnits"
          :status="checker.status.value"
          :lines="lines"
          :files="checker.files.value"
          :problems="checker.problems.value"
          :units-names="checker.unitsNames.value"
          :issues="issues"
          :checking="checker.checking.value"
        >
          <template #actions>
            <Button
              icon="pi pi-bolt"
              label="Example"
              size="small"
              text
              data-role="load-example"
              title="Load example units, and units for dV/dt = -(I_ion - I_stim)/C_m"
              @click="loadExample"
            />
          </template>
        </UnitsPanel>
      </template>
    </EquationWorkbench>
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
