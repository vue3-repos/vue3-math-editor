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

import { type Atom, type Row, childRows } from './layout'
import { type NumberRun, numberAt } from './numbers'
import { FUNCTION_REGISTRY } from '../registry/nodes'

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

      // A whole-word symbol, such as a Greek letter ("alpha").
      if (atom.kind === 'symbol' && atom.value === name) found.push([atom.id])

      for (const [, child] of childRows(atom)) visit(child)
    }
  }

  visit(root)
  return found
}
