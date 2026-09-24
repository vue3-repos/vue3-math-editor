// The editor's side of units checking, which is done outside the editor (see
// docs/component-interface.md). The editor knows no more about units than
// the equations themselves say: each number's units (0.25{mV}, dimensionless
// by default). A host with a units checker (such as libCellML) reads each
// line from the workbench's `equations-change` event and sends back
// `UnitsIssue`s, which the lines underline; it can also pass the variables'
// units, shown on hover.

import { contentMathML } from './exports'
import { nameOccurrences, numberOccurrences } from './identifiers'
import { type Row, childRows } from './layout'
import type { Mark } from './marks'
import type { ParseResult } from './parse'
import { DEFAULT_NUMBER_UNITS } from '../renderers/mathml'
import type { AstNode } from '../types/ast'

// One equation line, as the workbench reports it.
export interface EquationLine {
  // Stable for the line's lifetime, whatever lines are added or removed.
  id: string
  // Content MathML in CellML mode: the CellML namespace is declared and every
  // number carries cellml:units (its own, or dimensionless).
  mathml: string
  // Variable names used, in order of first use.
  variables: string[]
  // Units names given to numbers (without the default dimensionless).
  units: string[]
  // Whether the line is ready to check: not empty, no parse problems, no
  // empty slots and no units still being typed.
  complete: boolean
}

// A units problem to show on a line.
export interface UnitsIssue {
  lineId: string
  message: string
  // Variables to underline, at every place they appear in the line.
  variables?: readonly string[]
  // Numbers to underline, by value.
  numbers?: readonly number[]
  // Numbers to underline, by the units they were given (0.25{mV}).
  units?: readonly string[]
}

// A variable's units, by name, for hover hints.
export type VariableUnits = Readonly<Record<string, string>>

export function equationLine(id: string, root: Row, parsed: ParseResult | null): EquationLine {
  if (!parsed) return { id, mathml: '', variables: [], units: [], complete: false }

  const variables: string[] = []
  const units: string[] = []
  let placeholders = 0

  const visit = (node: AstNode) => {
    if (node.type === 'Identifier' && !variables.includes(node.name)) variables.push(node.name)
    if (node.type === 'Number' && node.units && !units.includes(node.units)) units.push(node.units)
    if (node.type === 'Placeholder') placeholders++
    for (const child of childNodes(node)) visit(child)
  }
  visit(parsed.ast)

  return {
    id,
    mathml: contentMathML(root, { cellml: true }),
    variables,
    units,
    complete: parsed.diagnostics.length === 0 && placeholders === 0 && !hasEmptyUnits(root),
  }
}

// Units still being typed: an empty units atom anywhere in the equation.
function hasEmptyUnits(row: Row): boolean {
  return row.some(
    (atom) =>
      (atom.kind === 'units' && atom.units.length === 0) ||
      childRows(atom).some(([, child]) => hasEmptyUnits(child)),
  )
}

function childNodes(node: AstNode): AstNode[] {
  switch (node.type) {
    case 'Add':
    case 'Multiply':
    case 'And':
    case 'Or':
    case 'Xor':
      return node.children
    case 'Subtract':
      return [node.minuend, node.subtrahend]
    case 'Negate':
    case 'Abs':
    case 'Group':
    case 'Not':
      return [node.value]
    case 'Root':
      return node.degree ? [node.radicand, node.degree] : [node.radicand]
    case 'FunctionCall':
      return node.args
    case 'Equal':
    case 'Less':
    case 'Greater':
    case 'LessEqual':
    case 'GreaterEqual':
    case 'NotEqual':
      return [node.left, node.right]
    case 'Divide':
      return [node.numerator, node.denominator]
    case 'Power':
      return [node.base, node.exponent]
    case 'Derivative':
      return [node.expression, node.variable]
    case 'Piecewise':
      return [
        ...node.pieces.flatMap(({ value, condition }) => [value, condition]),
        ...(node.otherwise ? [node.otherwise] : []),
      ]
    default:
      return []
  }
}

// Underlines for the issues on one line: every occurrence of each variable
// and number an issue names (numbers by value or by their units).
export function unitsIssueMarks(root: Row, issues: readonly UnitsIssue[]): Mark[] {
  const marks: Mark[] = []
  const numbers = issues.some((issue) => issue.numbers?.length || issue.units?.length)
    ? numberOccurrences(root)
    : []

  for (const issue of issues) {
    for (const name of issue.variables ?? []) {
      for (const atomIds of nameOccurrences(root, name)) {
        marks.push({ message: issue.message, atomIds, kind: 'units' })
      }
    }
    // A number named by its units (undefined units, say) is underlined with
    // its units, which the underline then reveals; by value, only the number.
    for (const number of numbers) {
      if (!number.inherited && number.units !== null && issue.units?.includes(number.units)) {
        marks.push({ message: issue.message, atomIds: number.atomIds, kind: 'units' })
      } else if (issue.numbers?.includes(number.value)) {
        marks.push({ message: issue.message, atomIds: number.digitIds, kind: 'units' })
      }
    }
  }

  return marks
}

// Hover hints for one line: each variable's units ("Vm: millivolt") where
// known, and each number's units ("0.25: mV"). A number's units are hidden, so
// its hint is always there; without `variableUnits` (no units checking),
// numbers without units aren't explained.
export function unitsHintMarks(root: Row, variableUnits: VariableUnits | null): Mark[] {
  const marks: Mark[] = []

  for (const [name, units] of Object.entries(variableUnits ?? {})) {
    for (const atomIds of nameOccurrences(root, name)) {
      marks.push({ message: `${name}: ${units}`, atomIds, kind: 'hint' })
    }
  }

  for (const number of numberOccurrences(root)) {
    if (!number.units && !variableUnits) continue
    const from = number.inherited ? ', as in the first piece' : ''
    marks.push({
      message: `${number.value}: ${number.units || DEFAULT_NUMBER_UNITS}${from}`,
      atomIds: number.atomIds,
      kind: 'hint',
    })
  }

  return marks
}
