<script setup lang="ts">
// Defining (or changing) one units: a name, and the units it is made of, each
// with an optional prefix, exponent and multiplier:
//   mV_per_ms = (milli volt) · (milli second)^-1
// Emits `save` with the definition once it has no problems.

import { computed, ref, useId } from 'vue'
import Button from 'primevue/button'

import { PREFIXES, type UnitsDefinition, type UnitsPart, definitionProblems } from './definitions'

const props = defineProps<{
  // The definition being changed, or none for new units.
  definition?: UnitsDefinition | null
  // The other new units.
  others: readonly UnitsDefinition[]
  // Every units name that can be used, or null when that isn't known.
  known: readonly string[] | null
  // Names to suggest for the parts.
  choices: readonly string[]
}>()

const emit = defineEmits<{
  save: [definition: UnitsDefinition]
  cancel: []
}>()

// Parts as typed: numbers as text until saved.
interface PartDraft {
  key: number
  prefix: string
  units: string
  exponent: string
  multiplier: string
}

let nextKey = 0
const draftOf = (part?: UnitsPart): PartDraft => ({
  key: nextKey++,
  prefix: part?.prefix ?? '',
  units: part?.units ?? '',
  exponent: part?.exponent !== undefined && part.exponent !== 1 ? String(part.exponent) : '',
  multiplier:
    part?.multiplier !== undefined && part.multiplier !== 1 ? String(part.multiplier) : '',
})

const name = ref(props.definition?.name ?? '')
const parts = ref<PartDraft[]>(props.definition ? props.definition.parts.map(draftOf) : [draftOf()])
// Problems are shown once saving has been tried.
const tried = ref(false)

const number = (text: string) => (text.trim() === '' ? undefined : Number(text))

const draft = computed<UnitsDefinition>(() => ({
  name: name.value.trim(),
  parts: parts.value.map((part) => {
    const exponent = number(part.exponent)
    const multiplier = number(part.multiplier)
    return {
      units: part.units.trim(),
      ...(part.prefix ? { prefix: part.prefix } : {}),
      ...(exponent !== undefined && exponent !== 1 ? { exponent } : {}),
      ...(multiplier !== undefined && multiplier !== 1 ? { multiplier } : {}),
    }
  }),
}))

const problems = computed(() => definitionProblems(draft.value, props.others, props.known))

function save() {
  tried.value = true
  if (problems.value.length === 0) emit('save', draft.value)
}

const choicesList = useId()
</script>

<template>
  <form class="units-form" data-role="units-form" @submit.prevent="save">
    <label class="form-name">
      <span>Name</span>
      <input
        v-model="name"
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="mV_per_ms"
        data-role="units-form-name"
      />
    </label>

    <table class="form-parts">
      <thead>
        <tr>
          <th scope="col">Prefix</th>
          <th scope="col">Units</th>
          <th scope="col" title="Power the part is raised to (1 if empty)">Exponent</th>
          <th scope="col" title="Factor the part is scaled by (1 if empty)">Multiplier</th>
          <th scope="col"><span class="visually-hidden">Remove</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(part, index) in parts" :key="part.key" data-role="units-form-part">
          <td>
            <select v-model="part.prefix" :aria-label="`Prefix of part ${index + 1}`">
              <option value="">—</option>
              <option v-for="prefix in PREFIXES" :key="prefix" :value="prefix">{{ prefix }}</option>
            </select>
          </td>
          <td>
            <input
              v-model="part.units"
              type="text"
              :list="choicesList"
              spellcheck="false"
              autocomplete="off"
              placeholder="second"
              :aria-label="`Units of part ${index + 1}`"
            />
          </td>
          <td>
            <input
              v-model="part.exponent"
              class="number"
              type="text"
              inputmode="decimal"
              placeholder="1"
              :aria-label="`Exponent of part ${index + 1}`"
            />
          </td>
          <td>
            <input
              v-model="part.multiplier"
              class="number"
              type="text"
              inputmode="decimal"
              placeholder="1"
              :aria-label="`Multiplier of part ${index + 1}`"
            />
          </td>
          <td>
            <Button
              icon="pi pi-times"
              size="small"
              text
              rounded
              severity="secondary"
              type="button"
              :aria-label="`Remove part ${index + 1}`"
              :disabled="parts.length === 1"
              @click="parts.splice(index, 1)"
            />
          </td>
        </tr>
      </tbody>
    </table>

    <datalist :id="choicesList">
      <option v-for="choice in choices" :key="choice" :value="choice" />
    </datalist>

    <ul v-if="tried && problems.length" class="form-problems" data-role="units-form-problems">
      <li v-for="problem in problems" :key="problem">{{ problem }}</li>
    </ul>

    <div class="form-actions">
      <Button
        icon="pi pi-plus"
        label="Part"
        size="small"
        text
        type="button"
        data-role="units-form-add-part"
        @click="parts.push(draftOf())"
      />
      <span class="spacer" />
      <Button
        label="Cancel"
        size="small"
        text
        severity="secondary"
        type="button"
        @click="emit('cancel')"
      />
      <Button
        :label="definition ? 'Save' : 'Add'"
        size="small"
        type="submit"
        data-role="units-form-save"
      />
    </div>
  </form>
</template>

<style scoped>
.units-form {
  margin-top: 0.5rem;
  padding: 0.6rem;
  border: 1px solid #bfdbfe;
  border-radius: 0.5rem;
  background: #f8fbff;
}

.form-name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: #334155;
}

.form-name input {
  flex: 1;
}

input,
select {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.2rem 0.35rem;
  border: 1px solid #cbd5e1;
  border-radius: 0.3rem;
  background: #fff;
  min-width: 0;
}

input:focus,
select:focus {
  outline: 2px solid #93c5fd;
  outline-offset: 0;
  border-color: #60a5fa;
}

.form-parts {
  width: 100%;
  margin-top: 0.5rem;
  border-collapse: collapse;
}

.form-parts th {
  font-size: 0.72rem;
  font-weight: 600;
  color: #64748b;
  text-align: left;
  padding: 0 0.25rem 0.15rem 0;
}

.form-parts td {
  padding: 0.1rem 0.25rem 0.1rem 0;
}

.form-parts td input,
.form-parts td select {
  width: 100%;
}

.form-parts .number {
  width: 4.5rem;
}

.form-problems {
  margin: 0.4rem 0 0;
  padding-left: 1.1rem;
  font-size: 0.82rem;
  color: #b91c1c;
}

.form-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.4rem;
}

.spacer {
  flex: 1;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
