// Numbers: which runs of typed characters form one number.
//
// A number is a run of digits and decimal points, optionally followed by an
// exponent in scientific notation: "e" or "E", an optional sign, and at
// least one digit, each typed as its own character: "1e-08", "6.022E23",
// "2.5e+3". Without a digit after it, the e is not part of the number: "2e"
// is 2·e and "2e-x" is 2·e − x. Digits after a letter belong to a name
// instead ("x2e5" is one name; see identifiers.ts, which scans for both).
//
// Each character stays its own atom, so the cursor moves through a number
// one character at a time; the grouping is worked out here, when parsing and
// rendering.

import type { Atom, Row } from './layout'

export interface NumberRun {
  // Atoms [start, end) of the row.
  start: number
  end: number
  // The number as typed, for Number(): "1e-08" (a typed "−" becomes "-").
  text: string
  // The part before the exponent, as typed: "1", "6.022".
  mantissa: string
  // The exponent as typed, with its sign ("-08", "23"), or null for a plain
  // number. It may be malformed ("-0.5"); Number(text) is then NaN.
  exponent: string | null
}

const valueOf = (atom: Atom | undefined): string | null =>
  atom?.kind === 'symbol' ? atom.value : null

const isDigit = (value: string | null) => value !== null && /^[0-9]$/.test(value)
const isNumberChar = (value: string | null) => isDigit(value) || value === '.'

export const startsNumber = (atom: Atom | undefined) => isNumberChar(valueOf(atom))

// The number starting at `start`, or null if none starts there.
export function numberAt(row: Row, start: number): NumberRun | null {
  if (!startsNumber(row[start])) return null

  let i = start
  let mantissa = ''
  while (isNumberChar(valueOf(row[i]))) mantissa += valueOf(row[i++])

  let exponent: string | null = null
  const e = valueOf(row[i])

  if (e === 'e' || e === 'E') {
    let j = i + 1
    let sign = ''
    const signChar = valueOf(row[j])
    if (signChar === '+' || signChar === '-' || signChar === '−') {
      sign = signChar === '+' ? '+' : '-'
      j++
    }

    if (isDigit(valueOf(row[j]))) {
      let digits = ''
      // Digits, plus any stray decimal point, which makes the number
      // malformed rather than starting a second number ("1e-0.5").
      while (isNumberChar(valueOf(row[j]))) digits += valueOf(row[j++])
      exponent = sign + digits
      i = j
    }
  }

  return {
    start,
    end: i,
    text: exponent === null ? mantissa : `${mantissa}e${exponent}`,
    mantissa,
    exponent,
  }
}

// Whether a sign typed at `offset` in a row would be the sign of an exponent
// (straight after the e of "1e"), rather than an operator. Not after the e
// of a name such as "x2e".
export function isExponentSignPosition(row: Row, offset: number): boolean {
  const e = valueOf(row[offset - 1])
  if ((e !== 'e' && e !== 'E') || !isNumberChar(valueOf(row[offset - 2]))) return false

  let start = offset - 2
  while (isNumberChar(valueOf(row[start - 1]))) start--
  return !/^[A-Za-z_]$/.test(valueOf(row[start - 1]) ?? '')
}
