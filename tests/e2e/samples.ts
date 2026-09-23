// Sample equations for the browser tests. Each one is typed into the
// workbench (`keys`) and must produce exactly the layout tree `build()`
// describes; the expected cursor positions are computed from that tree.

import { type Cursor, allPositions, describeCursor } from '../../src/editor/cursor'
import {
  type Row,
  type RowPath,
  childRows,
  derivative,
  fraction,
  group,
  piecewise,
  root,
  row,
  superscript,
  symbol,
} from '../../src/editor/layout'
import { encodeRowPath } from '../../src/renderers/layoutLatex'

export interface Sample {
  id: string
  label: string
  // Typed in order. "{Name}" presses a named key (Enter, Tab, ArrowRight, …);
  // anything else is typed character by character.
  keys: string[]
  build: () => Row
}

export const SAMPLES: readonly Sample[] = [
  {
    id: 'fraction-sum',
    label: 'x + 1/2 + 3',
    keys: ['x+1/2', ' ', '+3'],
    build: () => row('x+', fraction(row('1'), row('2')), '+3'),
  },
  {
    id: 'sin-squared',
    label: 'sin(x)^2 = y',
    keys: ['sin(x)^2', ' ', '=y'],
    // Typed letters: "sin" is three characters, read as the function.
    build: () => row('sin', group(row('x')), superscript(row('2')), '=y'),
  },
  {
    id: 'power-over-sum',
    label: 'x^2 + 1/(x+1)',
    keys: ['x^2', ' ', '+1/x+1'],
    build: () => row('x', superscript(row('2')), '+', fraction(row('1'), row('x+1'))),
  },
  {
    id: 'nested-fractions',
    label: 'nested fractions',
    keys: ['/a/b', ' ', '+1', '{Tab}', 'c', ' ', '=\\alpha', '{Enter}'],
    build: () =>
      row(fraction(row(fraction(row('a'), row('b')), '+1'), row('c')), '=', symbol('alpha')),
  },
  {
    id: 'roots-abs-derivative',
    label: 'roots, abs, derivative',
    keys: ['\\sqrt x+1', ' ', '+\\root 3', '{ArrowRight}', 'y', ' ', '-|z|=\\dd f', '{Tab}', 't'],
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
    keys: ['/', '{ArrowRight}', '{ArrowRight}', '+^', '{ArrowRight}', 'log(x,2)'],
    build: () => row(fraction(), '+', superscript(), 'log', group(row('x,2'))),
  },
  {
    id: 'names',
    label: 'Vm_init = 2Vm·cost',
    keys: ['Vm_init=2Vm*cost'],
    build: () => row('Vm_init=2Vm·cost'),
  },
  {
    id: 'piecewise',
    label: 'y = { a if t < 1, otherwise 0.0 }',
    keys: ['y=\\cases ', 'a', '{ArrowRight}', 't<1'],
    build: () => row('y=', piecewise([[row('a'), row('t<1')]], row('0.0'))),
  },
  {
    id: 'bracket-power',
    label: '(x+1)^2 - 4t',
    keys: ['(x+1)^2', ' ', '-4t'],
    build: () => row(group(row('x+1')), superscript(row('2')), '-4t'),
  },
]

export function sample(id: string): Sample {
  const found = SAMPLES.find((s) => s.id === id)
  if (!found) throw new Error(`No sample "${id}"`)
  return found
}

// Every cursor position of a sample in traversal order, as the workbench
// prints them ("0.num › 0.den @ 1").
export function expectedStops(id: string): string[] {
  return allPositions(sample(id).build()).map((cursor: Cursor) => describeCursor(cursor))
}

// The tree's shape as "<data-row>:<atom count>" entries, sorted: what the
// rendered page must show for the typed equation to match the sample.
export function expectedShape(id: string): string[] {
  const out: string[] = []

  const visit = (r: Row, path: RowPath) => {
    out.push(`${encodeRowPath(path)}:${r.length}`)
    r.forEach((atom, index) => {
      for (const [branch, child] of childRows(atom)) {
        visit(child, [...path, { atom: index, branch }])
      }
    })
  }

  visit(sample(id).build(), [])
  return out.sort()
}
