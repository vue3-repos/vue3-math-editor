// What the units panel shows and how its edits change the host's state, kept
// apart from the component so it can be tested without a browser.

import type { EquationLine, VariableUnits } from '../editor/units'
import type { UnitsSource } from './library'

export interface VariableRow {
  name: string
  units: string
  // Used in an equation (otherwise it only has units left over from before).
  used: boolean
  // missing: used without units; unknown: its units aren't a known name
  // (only known once libCellML has read the units files).
  state: 'ok' | 'missing' | 'unknown'
}

// One row per variable: those the equations use, in order of first use, then
// any others that have units.
export function variableRows(
  lines: readonly EquationLine[],
  variableUnits: VariableUnits,
  unitsNames: readonly string[] | null,
): VariableRow[] {
  const used = [...new Set(lines.flatMap((line) => line.variables))]
  const unused = Object.keys(variableUnits).filter((name) => !used.includes(name))
  const known = unitsNames ? new Set(unitsNames) : null

  return [...used, ...unused].map((name) => {
    const units = variableUnits[name] ?? ''
    const state = !units ? 'missing' : known && !known.has(units) ? 'unknown' : 'ok'
    return { name, units, used: used.includes(name), state: used.includes(name) ? state : 'ok' }
  })
}

// Variable units with `name` set to `units`; empty units remove it.
export function withUnits(
  variableUnits: VariableUnits,
  name: string,
  units: string,
): VariableUnits {
  const next = { ...variableUnits }
  const trimmed = units.trim()
  if (trimmed) next[name] = trimmed
  else delete next[name]
  return next
}

// The sources with `added` loaded: a file with the same name as one already
// loaded replaces it, in its place.
export function withSources(
  sources: readonly UnitsSource[],
  added: readonly UnitsSource[],
): UnitsSource[] {
  const next = [...sources]
  for (const source of added) {
    const index = next.findIndex((existing) => existing.name === source.name)
    if (index >= 0) next[index] = source
    else next.push(source)
  }
  return next
}
