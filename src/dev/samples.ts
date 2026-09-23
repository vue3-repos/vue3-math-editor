// Sample equations for the cursor playground (playground.html). The
// Playwright tests in tests/e2e import these too, so the expected cursor
// positions are computed from the same trees the page renders.

import {
  type Row,
  derivative,
  fraction,
  func,
  group,
  root,
  row,
  superscript,
  symbol,
} from '../editor/layout'

export interface Sample {
  // Stable key, used as data-sample on the page.
  id: string
  label: string
  build: () => Row
}

export const SAMPLES: readonly Sample[] = [
  {
    id: 'fraction-sum',
    label: 'x + 1/2 + 3',
    build: () => row('x+', fraction(row('1'), row('2')), '+3'),
  },
  {
    id: 'sin-squared',
    label: 'sin(x)^2 = y',
    build: () => row(func('sin'), group(row('x')), superscript(row('2')), '=y'),
  },
  {
    id: 'power-over-sum',
    label: 'x^2 + 1/(x+1)',
    build: () => row('x', superscript(row('2')), '+', fraction(row('1'), row('x+1'))),
  },
  {
    id: 'nested-fractions',
    label: 'nested fractions',
    build: () =>
      row(fraction(row(fraction(row('a'), row('b')), '+1'), row('c')), '=', symbol('alpha')),
  },
  {
    id: 'roots-abs-derivative',
    label: 'roots, abs, derivative',
    build: () =>
      row(
        root(row('x+1')),
        '+',
        root(row('y'), row('3')),
        '-',
        group(row('z'), '|'),
        '=',
        derivative(row('f'), row('t')),
      ),
  },
  {
    id: 'empty-slots',
    label: 'empty slots',
    build: () => row(fraction(), '+', superscript(), func('log'), group(row('x,2'))),
  },
  {
    id: 'bracket-power',
    label: '(x+1)^2 - 4t',
    build: () => row(group(row('x+1')), superscript(row('2')), '-4t'),
  },
]

// How the playground prints a cursor, e.g. "0.num › 0.den @ 1".
export { describeCursor } from '../editor/cursor'
