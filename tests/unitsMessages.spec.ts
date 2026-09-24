import { describe, expect, it } from 'vitest'

import {
  describeUnitsMessage,
  operandNumbers,
  operandVariables,
  readUnitsMessage,
} from '../src/units/messages'

// Messages as libcellml.js 0.7.1 writes them.
const MISMATCH =
  "The units in 'w+x' in 'v+w+x' in equation 'y = v+w+x' in component 'equation' are not equivalent. 'w' is in 'mV' (i.e. '10^-3 x ampere^-1 x kilogram x metre^2 x second^-3') while 'x' is in 'metre'."
const WITH_NUMBER =
  "The units in 't+1.0e-3' in equation 'y = t+1.0e-3' in component 'equation' are not equivalent. 't' is in 'second' while '1.0e-3' is 'dimensionless'."
const NOT_DIMENSIONLESS =
  "The unit of 't' in 'exp(t)' in equation 'y = exp(t)' in component 'equation' is not dimensionless. 't' is in 'second'."
const PIECEWISE =
  "The units in 'y = (t < 1.0)?t:0.0' in component 'equation' are not equivalent. 'y' is in 'second' while '(t < 1.0)?t:0.0' is in 'second'."

describe('readUnitsMessage', () => {
  it('reads a mismatch, with units given in base units too', () => {
    expect(readUnitsMessage(MISMATCH)).toEqual({
      kind: 'mismatch',
      expression: 'w+x',
      operands: [
        { text: 'w', units: 'mV' },
        { text: 'x', units: 'metre' },
      ],
    })
  })

  it('reads numbers, which are "dimensionless" rather than "in" it', () => {
    expect(readUnitsMessage(WITH_NUMBER)?.operands).toEqual([
      { text: 't', units: 'second' },
      { text: '1.0e-3', units: 'dimensionless' },
    ])
  })

  it('reads an argument that should be dimensionless', () => {
    expect(readUnitsMessage(NOT_DIMENSIONLESS)).toEqual({
      kind: 'notDimensionless',
      expression: 'exp(t)',
      operands: [{ text: 't', units: 'second' }],
    })
  })

  it('is null for any other message', () => {
    expect(readUnitsMessage("Variable 'x' in component 'equation' is unused.")).toBeNull()
  })
})

describe('describeUnitsMessage', () => {
  it('says what disagrees, without the check model', () => {
    expect(describeUnitsMessage(readUnitsMessage(MISMATCH)!)).toBe(
      "Units don't match in w+x: w is in mV, x is in metre",
    )
    expect(describeUnitsMessage(readUnitsMessage(NOT_DIMENSIONLESS)!)).toBe(
      't in exp(t) must be dimensionless, but is in second',
    )
  })

  it('explains a piecewise whose pieces disagree', () => {
    expect(describeUnitsMessage(readUnitsMessage(PIECEWISE)!)).toBe(
      'The parts of (t < 1.0)?t:0.0 have different units',
    )
  })
})

describe('operands', () => {
  it('finds the line’s variables, not function names', () => {
    expect(operandVariables('pow(t, 2.0)*alpha', ['y', 't', 'alpha'])).toEqual(['t', 'alpha'])
  })

  it('reads derivatives, unless a d-name is a variable itself', () => {
    expect(operandVariables('dx/dt', ['x', 't', 'v'])).toEqual(['x', 't'])
    expect(operandVariables('d^2x/dt^2', ['x', 't'])).toEqual(['x', 't'])
    expect(operandVariables('dx/dt', ['dx', 'dt'])).toEqual(['dx', 'dt'])
  })

  it('doesn’t read the e of a number as a name', () => {
    expect(operandVariables('1.0e-3', ['e'])).toEqual([])
    expect(operandNumbers('2.0*1.0e-3')).toEqual([2, 0.001])
    expect(operandNumbers('x2+1')).toEqual([1])
  })
})
