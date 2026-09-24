// Reading libCellML's units messages. The analyser reports units problems as
// text only (the issue's item is undefined), so the variables and numbers
// involved come from the message itself. Two forms are seen (libcellml.js
// 0.7.1):
//
//   The units in 'w+x' in 'v+w+x' in equation 'y = v+w+x' in component
//   'equation' are not equivalent. 'w' is in 'mV' (i.e. '10^-3 x ampere^-1 x
//   kilogram x metre^2 x second^-3') while 'x' is in 'metre'.
//
//   The unit of 't' in 'exp(t)' in equation 'y = exp(t)' in component
//   'equation' is not dimensionless. 't' is in 'second'.
//
// Numbers are written '1.0', '1.0e-3' and '2.0' is 'dimensionless' (without
// "in"); derivatives 'dy/dt'; piecewise '(t < 1.0)?t:0.0'.

export interface Operand {
  // The expression, as libCellML writes it.
  text: string
  units: string
}

export interface UnitsMessage {
  kind: 'mismatch' | 'notDimensionless'
  // The expression the problem is in.
  expression: string
  // The operands whose units are at fault: two for a mismatch, one otherwise.
  operands: Operand[]
}

// 'x' is in 'metre', or '2.0' is 'dimensionless', optionally followed by the
// units in base units: (i.e. '…').
const OPERAND = /'([^']+)' is (?:in )?'([^']+)'(?: \(i\.e\. '[^']*'\))?/g

export function readUnitsMessage(message: string): UnitsMessage | null {
  const mismatch = /^The units in '([^']+)'.* are not equivalent\. (.*)$/s.exec(message)
  const notDimensionless = /^The unit of '[^']+' in '([^']+)'.* is not dimensionless\. (.*)$/s.exec(
    message,
  )
  const found = mismatch ?? notDimensionless
  if (!found) return null

  const operands = [...found[2].matchAll(OPERAND)].map(([, text, units]) => ({ text, units }))
  if (operands.length === 0) return null

  return { kind: mismatch ? 'mismatch' : 'notDimensionless', expression: found[1], operands }
}

// The message to show: shorter than libCellML's, and without the names of the
// check model's parts, which mean nothing to the user.
export function describeUnitsMessage(parsed: UnitsMessage): string {
  const [first, second] = parsed.operands
  if (parsed.kind === 'notDimensionless') {
    return `${first.text} in ${parsed.expression} must be dimensionless, but is in ${first.units}`
  }
  if (second && first.units === second.units) {
    // libCellML reports a piecewise whose pieces disagree this way.
    return `The parts of ${second.text} have different units`
  }
  return second
    ? `Units don't match in ${parsed.expression}: ${inUnits(first)}, ${inUnits(second)}`
    : `Units don't match in ${parsed.expression}`
}

// "t is in second", "2.0 is dimensionless".
const inUnits = (operand: Operand) =>
  operand.units === 'dimensionless'
    ? `${operand.text} is dimensionless`
    : `${operand.text} is in ${operand.units}`

const NAME = /[A-Za-z_][A-Za-z0-9_]*/g
const DERIVATIVE = /\bd(?:\^\d+)?([A-Za-z_][A-Za-z0-9_]*)\/d([A-Za-z_][A-Za-z0-9_]*)(?:\^\d+)?/g
const NUMBER = /(?<![A-Za-z_0-9.])\d+(?:\.\d*)?(?:e[+-]?\d+)?/g

// The variables an operand uses, of those the line has: libCellML writes
// derivatives as dy/dt, so d-prefixed names are read as derivatives when they
// aren't variables themselves.
export function operandVariables(text: string, variables: readonly string[]): string[] {
  const found = new Set<string>()
  const add = (name: string) => {
    if (variables.includes(name)) found.add(name)
  }

  const rest = text.replace(DERIVATIVE, (whole, of: string, by: string) => {
    if (variables.includes(`d${of}`) || variables.includes(`d${by}`)) return whole
    add(of)
    add(by)
    return ' '
  })
  // Numbers first, so the e of 1.0e-3 isn't read as a name.
  for (const [name] of rest.replace(NUMBER, ' ').matchAll(NAME)) add(name)

  return [...found]
}

// The numbers written in an operand, by value.
export function operandNumbers(text: string): number[] {
  return [...text.matchAll(NUMBER)].map(([number]) => Number(number))
}
