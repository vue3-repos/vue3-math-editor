// Units the user defines while writing equations. They are plain data, kept by
// the host (v-model:new-units on the units panel), and go out as a CellML file
// of their own that holds only them: nothing is ever written back into the
// units files the user loaded (no side effects). The checker reads that file
// as one more units file. None of this needs libCellML.
//
//   mV_per_ms = milli volt · (milli second)^-1
//   { name: 'mV_per_ms', parts: [
//       { prefix: 'milli', units: 'volt' },
//       { prefix: 'milli', units: 'second', exponent: -1 } ] }

// One <unit> of a definition: (multiplier · prefix units)^exponent.
export interface UnitsPart {
  units: string
  prefix?: string
  exponent?: number
  multiplier?: number
}

export interface UnitsDefinition {
  name: string
  parts: UnitsPart[]
}

// The name the new units file goes by, in the checker and its messages.
export const NEW_UNITS_SOURCE = 'new units'

// CellML's named prefixes, largest first.
export const PREFIXES = [
  'yotta',
  'zetta',
  'exa',
  'peta',
  'tera',
  'giga',
  'mega',
  'kilo',
  'hecto',
  'deca',
  'deci',
  'centi',
  'milli',
  'micro',
  'nano',
  'pico',
  'femto',
  'atto',
  'zepto',
  'yocto',
] as const

// A CellML identifier.
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

// What is wrong with a definition, or [] if nothing. `known` is every units
// name that can be used (built in, the files', and the other new units);
// null when that isn't known (no libCellML), so names aren't checked against
// it. `others` are the other new units, for names taken and for cycles.
export function definitionProblems(
  definition: UnitsDefinition,
  others: readonly UnitsDefinition[],
  known: readonly string[] | null,
): string[] {
  const problems: string[] = []
  const { name, parts } = definition

  if (!name) problems.push('Give the units a name')
  else if (!NAME.test(name)) {
    problems.push(
      `${name} isn't a units name: use letters, digits and _, not starting with a digit`,
    )
  } else if (others.some((other) => other.name === name) || known?.includes(name)) {
    problems.push(`There are units called ${name} already`)
  }

  if (parts.length === 0) problems.push('Add what the units are made of')

  parts.forEach((part, index) => {
    const which = parts.length > 1 ? `Part ${index + 1}: ` : ''
    if (!part.units) problems.push(`${which}choose the units it is made of`)
    else if (part.units === name) problems.push(`${which}units can't be made of themselves`)
    else if (
      known &&
      !known.includes(part.units) &&
      !others.some((other) => other.name === part.units)
    ) {
      problems.push(`${which}no units called ${part.units} are defined`)
    }
    if (part.prefix && !(PREFIXES as readonly string[]).includes(part.prefix)) {
      problems.push(`${which}${part.prefix} isn't a prefix`)
    }
    if (part.exponent !== undefined && !Number.isFinite(part.exponent)) {
      problems.push(`${which}the exponent must be a number`)
    }
    if (part.multiplier !== undefined && !Number.isFinite(part.multiplier)) {
      problems.push(`${which}the multiplier must be a number`)
    }
  })

  if (name && NAME.test(name) && madeFromItself(name, parts, others)) {
    problems.push(`${name} would be made of itself, through other new units`)
  }

  return problems
}

function madeFromItself(
  name: string,
  parts: readonly UnitsPart[],
  others: readonly UnitsDefinition[],
): boolean {
  const seen = new Set<string>()
  const visit = (units: string): boolean => {
    if (units === name) return true
    if (seen.has(units)) return false
    seen.add(units)
    const other = others.find((definition) => definition.name === units)
    return !!other && other.parts.some((part) => visit(part.units))
  }
  // Directly made of itself is reported on its own.
  return parts.some((part) => part.units !== name && visit(part.units))
}

// The new units that use `name`.
export function usedBy(name: string, definitions: readonly UnitsDefinition[]): string[] {
  return definitions
    .filter((definition) => definition.parts.some((part) => part.units === name))
    .map((definition) => definition.name)
}

// A definition as text: "milli volt · (milli second)^-1", "1000 second".
export function describeDefinition(definition: UnitsDefinition): string {
  return definition.parts
    .map((part) => {
      const scaled = [part.multiplier !== undefined && part.multiplier !== 1 ? part.multiplier : '']
        .concat(part.prefix ?? '', part.units)
        .filter((piece) => piece !== '')
        .join(' ')
      const exponent = part.exponent ?? 1
      if (exponent === 1) return scaled
      return scaled.includes(' ') ? `(${scaled})^${exponent}` : `${scaled}^${exponent}`
    })
    .join(' · ')
}

const attribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// The definitions as a CellML 2.0 file holding only them, units used by
// others first.
export function newUnitsFile(
  definitions: readonly UnitsDefinition[],
  modelName = 'new_units',
): string {
  const ordered: UnitsDefinition[] = []
  const place = (definition: UnitsDefinition, visiting: Set<string>) => {
    if (ordered.includes(definition) || visiting.has(definition.name)) return
    visiting.add(definition.name)
    for (const part of definition.parts) {
      const used = definitions.find((other) => other.name === part.units)
      if (used) place(used, visiting)
    }
    ordered.push(definition)
  }
  for (const definition of definitions) place(definition, new Set())

  const units = ordered.map((definition) => {
    const parts = definition.parts.map((part) => {
      const attributes = [
        part.prefix ? ` prefix="${attribute(part.prefix)}"` : '',
        ` units="${attribute(part.units)}"`,
        part.exponent !== undefined && part.exponent !== 1 ? ` exponent="${part.exponent}"` : '',
        part.multiplier !== undefined && part.multiplier !== 1
          ? ` multiplier="${part.multiplier}"`
          : '',
      ].join('')
      return `    <unit${attributes}/>`
    })
    return [`  <units name="${attribute(definition.name)}">`, ...parts, '  </units>'].join('\n')
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<model xmlns="http://www.cellml.org/cellml/2.0#" name="${attribute(modelName)}">`,
    ...units,
    '</model>',
    '',
  ].join('\n')
}
