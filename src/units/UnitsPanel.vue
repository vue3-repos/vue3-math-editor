<script setup lang="ts">
// The units side of an equation workbench: the units files loaded, and each
// variable's units. It shows what useUnitsChecker reports and hands edits back
// through v-model:sources and v-model:variable-units; it never touches
// libCellML itself, so it works (with less to say) without it.
//
//   <UnitsPanel
//     v-model:sources="sources" v-model:variable-units="variableUnits"
//     :lines="lines" :status="checker.status" :files="checker.files"
//     :problems="checker.problems" :units-names="checker.unitsNames"
//     :issues="checker.issues" />

import { computed, ref, useId } from 'vue'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Tag from 'primevue/tag'

import type { EquationLine, UnitsIssue, VariableUnits } from '../editor/units'
import type { UnitsLibraryProblem, UnitsSource } from './library'
import { variableRows, withSources, withUnits } from './panel'
import type { UnitsCheckerStatus } from './useUnitsChecker'

const props = withDefaults(
  defineProps<{
    status: UnitsCheckerStatus
    lines: readonly EquationLine[]
    files?: readonly { name: string; units: readonly string[] }[]
    problems?: readonly UnitsLibraryProblem[]
    unitsNames?: readonly string[]
    issues?: readonly UnitsIssue[]
    // Whether the checker is reporting (useUnitsChecker's `checking`).
    checking?: boolean
  }>(),
  {
    files: () => [],
    problems: () => [],
    unitsNames: () => [],
    issues: () => [],
    checking: true,
  },
)

const sources = defineModel<UnitsSource[]>('sources', { default: () => [] })
const variableUnits = defineModel<VariableUnits>('variableUnits', { default: () => ({}) })

const ready = computed(() => props.status === 'ready')
const rows = computed(() =>
  variableRows(props.lines, variableUnits.value, ready.value ? props.unitsNames : null),
)
const missingCount = computed(() => rows.value.filter((row) => row.state === 'missing').length)

const statusTag = computed(
  () =>
    ({
      ready: { value: 'libCellML', severity: 'success' },
      loading: { value: 'Loading libCellML…', severity: 'info' },
      unavailable: { value: 'No libCellML', severity: 'secondary' },
    })[props.status],
)

const summary = computed(() => {
  if (props.status === 'unavailable') {
    return 'Units checking needs libCellML (the vue3-libcellml.js plugin), which this application doesn’t provide. Units given here are still shown on hover.'
  }
  if (props.status === 'loading') return 'Units are checked once libCellML has loaded.'
  if (!props.checking) return 'Give a variable units, or load units files, to check units.'
  const checked = props.lines.filter((line) => line.complete).length
  if (checked === 0) return 'Complete equations are checked as you type.'
  const lines = new Set(props.issues.map((issue) => issue.lineId)).size
  return props.issues.length === 0
    ? `No units problems in ${plural(checked, 'equation')}.`
    : `${plural(props.issues.length, 'units problem')} in ${plural(lines, 'equation')}.`
})

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

// Units files.

const fileInput = ref<HTMLInputElement | null>(null)

async function readFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  const added = await Promise.all(
    files.map(async (file) => ({ name: file.name, text: await file.text() })),
  )
  if (added.length) sources.value = withSources(sources.value, added)
}

function removeFile(name: string) {
  sources.value = sources.value.filter((source) => source.name !== name)
}

const problemsIn = (name: string) => props.problems.filter((problem) => problem.source === name)
const unitsIn = (name: string) => props.files.find((file) => file.name === name)?.units ?? []

// Variables.

const unitsList = useId()

function setUnits(name: string, event: Event) {
  variableUnits.value = withUnits(
    variableUnits.value,
    name,
    (event.target as HTMLInputElement).value,
  )
}

const stateLabel = { ok: '', missing: 'no units', unknown: 'unknown units' }
</script>

<template>
  <Card class="units-panel" data-role="units-panel" :data-status="status">
    <template #title>
      <div class="units-title">
        <span>Units</span>
        <Tag :severity="statusTag.severity" :value="statusTag.value" data-role="units-status" />
      </div>
    </template>

    <template #subtitle>
      <span data-role="units-summary">{{ summary }}</span>
    </template>

    <template #content>
      <section class="units-section" aria-labelledby="units-files-title">
        <div class="section-head">
          <h3 id="units-files-title">Units files</h3>
          <div class="section-actions">
            <slot name="actions" />
            <Button
              icon="pi pi-folder-open"
              label="Load units files"
              size="small"
              text
              data-role="load-units"
              title="Load CellML files; only their units are kept"
              @click="fileInput?.click()"
            />
            <input
              ref="fileInput"
              type="file"
              accept=".cellml,.xml,application/xml,text/xml"
              multiple
              hidden
              data-role="units-file-input"
              @change="readFiles"
            />
          </div>
        </div>

        <p v-if="sources.length === 0" class="hint">
          Built-in units (<code>second</code>, <code>metre</code>, <code>volt</code>, …) are always
          available. Load CellML files for others; only their units are kept.
        </p>

        <ul v-else class="files" data-role="units-files">
          <li v-for="source in sources" :key="source.name" :data-file="source.name">
            <div class="file-head">
              <span class="file-name">{{ source.name }}</span>
              <span class="file-count">
                {{ ready ? plural(unitsIn(source.name).length, 'units definition') : '' }}
              </span>
              <Button
                icon="pi pi-times"
                size="small"
                text
                rounded
                severity="secondary"
                :aria-label="`Remove ${source.name}`"
                title="Remove this file"
                @click="removeFile(source.name)"
              />
            </div>
            <div v-if="unitsIn(source.name).length" class="units-names">
              <code v-for="name in unitsIn(source.name)" :key="name">{{ name }}</code>
            </div>
            <ul v-if="problemsIn(source.name).length" class="problems" data-role="units-problems">
              <li v-for="(problem, index) in problemsIn(source.name)" :key="index">
                {{ problem.message }}
              </li>
            </ul>
          </li>
        </ul>
      </section>

      <section class="units-section" aria-labelledby="units-variables-title">
        <div class="section-head">
          <h3 id="units-variables-title">Variables</h3>
          <span v-if="missingCount" class="missing-count" data-role="missing-count">
            {{ plural(missingCount, 'variable') }} without units
          </span>
        </div>

        <p v-if="rows.length === 0" class="hint">
          The variables in your equations are listed here, to give each one its units.
        </p>

        <table v-else class="variables" data-role="variables">
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.name"
              :class="[`state-${row.state}`, { unused: !row.used }]"
              :data-variable="row.name"
              :data-state="row.state"
            >
              <th scope="row" class="variable-name">{{ row.name }}</th>
              <td>
                <input
                  class="units-input"
                  type="text"
                  :value="row.units"
                  :list="unitsList"
                  placeholder="units"
                  spellcheck="false"
                  autocomplete="off"
                  :aria-label="`Units of ${row.name}`"
                  :aria-invalid="row.state !== 'ok'"
                  @change="setUnits(row.name, $event)"
                />
              </td>
              <td class="variable-state">
                <template v-if="row.used">{{ stateLabel[row.state] }}</template>
                <template v-else>
                  not used
                  <Button
                    icon="pi pi-times"
                    size="small"
                    text
                    rounded
                    severity="secondary"
                    :aria-label="`Forget the units of ${row.name}`"
                    title="Forget these units"
                    @click="variableUnits = withUnits(variableUnits, row.name, '')"
                  />
                </template>
              </td>
            </tr>
          </tbody>
        </table>

        <datalist :id="unitsList">
          <option v-for="name in unitsNames" :key="name" :value="name" />
        </datalist>
      </section>
    </template>
  </Card>
</template>

<style scoped>
.units-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.units-section + .units-section {
  margin-top: 1.25rem;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.section-head h3 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: #0f172a;
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.hint {
  margin: 0.4rem 0 0;
  font-size: 0.875rem;
  color: #64748b;
}

.files {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}

.files > li {
  border: 1px solid #e2e8f0;
  border-radius: 0.5rem;
  padding: 0.4rem 0.6rem;
  background: #fff;
}

.file-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.file-name {
  font-weight: 600;
  color: #0f172a;
  overflow-wrap: anywhere;
}

.file-count {
  flex: 1;
  font-size: 0.8rem;
  color: #64748b;
}

.units-names {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.25rem;
}

.units-names code {
  font-size: 0.78rem;
  padding: 0.05rem 0.35rem;
  border-radius: 0.25rem;
  background: #f1f5f9;
  color: #334155;
}

.problems {
  margin: 0.4rem 0 0.1rem;
  padding-left: 1.1rem;
  font-size: 0.82rem;
  color: #92400e;
}

.missing-count {
  font-size: 0.82rem;
  color: #b45309;
}

.variables {
  margin-top: 0.5rem;
  border-collapse: collapse;
  width: 100%;
}

.variables th,
.variables td {
  padding: 0.2rem 0.5rem 0.2rem 0;
  text-align: left;
  vertical-align: middle;
}

/* Names as wide as they need, then the units, then the state in what's left. */
.variables th {
  width: 1%;
  padding-right: 1rem;
}

.variables td:nth-child(2) {
  width: 16rem;
}

.variable-name {
  font-family: 'KaTeX_Math', 'Times New Roman', serif;
  font-style: italic;
  font-weight: normal;
  font-size: 1.05rem;
  white-space: nowrap;
  color: #0f172a;
}

.units-input {
  width: 100%;
  min-width: 8rem;
  max-width: 16rem;
  font: inherit;
  font-size: 0.9rem;
  padding: 0.25rem 0.45rem;
  border: 1px solid #cbd5e1;
  border-radius: 0.375rem;
  background: #fff;
}

.units-input:focus {
  outline: 2px solid #93c5fd;
  outline-offset: 0;
  border-color: #60a5fa;
}

.state-missing .units-input,
.state-unknown .units-input {
  border-color: #f59e0b;
  background: #fffbeb;
}

.variable-state {
  white-space: nowrap;
  font-size: 0.8rem;
  color: #b45309;
}

.unused .variable-name,
.unused .variable-state {
  color: #94a3b8;
}
</style>
