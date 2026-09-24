// Names: which runs of typed characters form one variable or function name.
//
// A run of single-character symbols that starts with a letter and continues
// with letters, digits and underscores is one name: "Vm", "Vm_init", "x2".
// Without an explicit operator between them, letters belong to the same
// name, so a product of variables needs "*" (shown as ·): "a*b". A number
// before a name is still a product: "2Vm" is 2·Vm.
//
// A name that is exactly a known function's spelling ("sin", "cosh",
// "arcsin") is that function; a longer name containing one ("cost",
// "tangent") is just a name. The underscore is part of the name and shown
// literally (no subscript formatting).
//
// Each character stays its own atom, so the cursor moves through a name one
// character at a time; the grouping is worked out here, when parsing and
// rendering.

import {
  type Atom,
  type GroupDelimiter,
  type PiecewiseAtom,
  type Row,
  type UnitsAtom,
  childRows,
} from './layout'
import { constantForSymbol } from './constants'
import { type NumberRun, numberAt } from './numbers'
import { FUNCTION_REGISTRY, bracketsForFunction } from '../registry/nodes'

// Names written as a command (\alpha) that insert a Greek letter.
export const GREEK_NAMES: ReadonlySet<string> = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta',
  'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau',
  'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda',
  'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega',
]) // prettier-ignore

// Typed spellings of known functions -> function name ("arcsin" -> "asin").
const FUNCTION_SPELLINGS = new Map<string, string>()
for (const definition of Object.values(FUNCTION_REGISTRY)) {
  FUNCTION_SPELLINGS.set(definition.name, definition.name)
  FUNCTION_SPELLINGS.set(definition.latexName, definition.name)
  for (const alias of definition.aliases ?? []) FUNCTION_SPELLINGS.set(alias, definition.name)
}

// The function a spelling names ("sin", "arcsin" -> "asin"), if any.
export function functionForSpelling(spelling: string): string | undefined {
  return FUNCTION_SPELLINGS.get(spelling)
}

const isSymbol = (atom: Atom | undefined, pattern: RegExp): boolean =>
  atom?.kind === 'symbol' && pattern.test(atom.value)

export const startsName = (atom: Atom | undefined) => isSymbol(atom, /^[A-Za-z]$/)
export const continuesName = (atom: Atom | undefined) => isSymbol(atom, /^[A-Za-z0-9_]$/)

export interface NameRun {
  // Atoms [start, end) of the row.
  start: number
  end: number
  name: string
  // The function this name spells, or null for a variable name.
  functionName: string | null
}

// Every name in a row, left to right. Numbers are skipped as a whole, so the
// "e" of "1e-08" doesn't start a name.
export function nameRuns(row: Row): NameRun[] {
  const runs: NameRun[] = []
  let i = 0

  while (i < row.length) {
    const number = numberAt(row, i)
    if (number) {
      i = number.end
      continue
    }

    if (!startsName(row[i])) {
      i++
      continue
    }

    const start = i
    let name = ''
    while (i < row.length && continuesName(row[i])) {
      name += (row[i] as Atom & { kind: 'symbol' }).value
      i++
    }

    runs.push({ start, end: i, name, functionName: functionForSpelling(name) ?? null })
  }

  return runs
}

// Every number in a row, left to right. Digits inside a name ("x2") are not
// numbers.
export function numberRuns(row: Row): NumberRun[] {
  const runs: NumberRun[] = []
  let i = 0

  while (i < row.length) {
    if (startsName(row[i])) {
      while (i < row.length && continuesName(row[i])) i++
      continue
    }

    const number = numberAt(row, i)
    if (number) {
      runs.push(number)
      i = number.end
    } else {
      i++
    }
  }

  return runs
}

// A units atom's name, as typed.
export const unitsName = (atom: UnitsAtom): string =>
  atom.units.map((a) => (a.kind === 'symbol' ? a.value : '')).join('')

// The otherwise value a new piecewise starts with.
export const DEFAULT_OTHERWISE = '0.0'

// The units an otherwise value takes from the first piece: while it is still
// the default 0.0, with no units of its own, and the first piece's value is a
// number with units (5{mV}, or -5{mV}), the 0.0 is in those units too, so the
// pieces agree without the user giving the 0.0 units. Null otherwise.
export function inheritedOtherwiseUnits(atom: PiecewiseAtom): string | null {
  const otherwise = atom.otherwise
  const text = otherwise?.map((a) => (a.kind === 'symbol' ? a.value : '\0')).join('')
  if (text !== DEFAULT_OTHERWISE) return null

  const value = atom.pieces[0]?.value ?? []
  const start = value[0]?.kind === 'symbol' && value[0].value === '-' ? 1 : 0
  const number = numberAt(value, start)
  const units = value[value.length - 1]
  if (!number || number.end !== value.length - 1 || units?.kind !== 'units') return null
  return unitsName(units) || null
}

// Every place a variable name appears in an equation, at any depth: the atoms
// of each occurrence. For marking a problem reported by name rather than by
// position, such as a units mismatch from libCellML.
export function nameOccurrences(root: Row, name: string): string[][] {
  const found: string[][] = []

  const visit = (row: Row) => {
    const runs = new Map(nameRuns(row).map((run) => [run.start, run]))

    for (let i = 0; i < row.length; i++) {
      const atom = row[i]
      const run = runs.get(i)

      if (run) {
        if (run.name === name && !run.functionName) {
          found.push(row.slice(run.start, run.end).map((a) => a.id))
        }
        i = run.end - 1
        continue
      }

      // A whole-word symbol, such as a Greek letter ("alpha"), but not a
      // constant (π is never a variable).
      if (atom.kind === 'symbol' && atom.value === name && !constantForSymbol(name)) {
        found.push([atom.id])
      }

      // A units name is not a variable.
      if (atom.kind === 'units') continue
      for (const [, child] of childRows(atom)) visit(child)
    }
  }

  visit(root)
  return found
}

export interface NumberOccurrence {
  value: number
  // The number's atoms, and its units atom if it has one.
  atomIds: string[]
  // The number's atoms only.
  digitIds: string[]
  // The name in its units atom, if it has one, or the units a default
  // otherwise value takes from the first piece.
  units: string | null
  // The units are the first piece's (see inheritedOtherwiseUnits).
  inherited?: boolean
}

// Every number in an equation, at any depth.
export function numberOccurrences(root: Row): NumberOccurrence[] {
  const found: NumberOccurrence[] = []

  // `inherited`: the units a default otherwise value takes from its piecewise.
  const visit = (row: Row, inherited: string | null = null) => {
    for (const run of numberRuns(row)) {
      const after = row[run.end]
      const unitsAtom = after?.kind === 'units' ? after : null
      const atoms = row.slice(run.start, run.end + (unitsAtom ? 1 : 0))
      const atomIds = atoms.map((a) => a.id)
      const digitIds = row.slice(run.start, run.end).map((a) => a.id)
      const value = Number(run.text)
      if (unitsAtom) found.push({ value, atomIds, digitIds, units: unitsName(unitsAtom) })
      else if (inherited) {
        found.push({ value, atomIds, digitIds, units: inherited, inherited: true })
      } else found.push({ value, atomIds, digitIds, units: null })
    }
    for (const atom of row) {
      if (atom.kind === 'units') continue
      for (const [branch, child] of childRows(atom)) {
        const otherwise = atom.kind === 'piecewise' && branch === 'otherwise'
        visit(child, otherwise ? inheritedOtherwiseUnits(atom) : null)
      }
    }
  }

  visit(root)
  return found
}

// A floor or ceiling written as a name straight before `offset`: typed
// letters spelling floor, ceil or ceiling, or the function atom. Where it
// starts and the bracket it becomes, so that "floor(" turns into ⌊ ⌋.
export function bracketFunctionBefore(
  row: Row,
  offset: number,
): { start: number; open: GroupDelimiter } | null {
  const before = row[offset - 1]
  if (before?.kind === 'function') {
    const brackets = bracketsForFunction(before.name)
    return brackets ? { start: offset - 1, open: brackets.open as GroupDelimiter } : null
  }

  const run = nameRuns(row.slice(0, offset)).find((r) => r.end === offset)
  const brackets = run?.functionName ? bracketsForFunction(run.functionName) : undefined
  return run && brackets ? { start: run.start, open: brackets.open as GroupDelimiter } : null
}
