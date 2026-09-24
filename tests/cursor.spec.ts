import { describe, expect, it } from 'vitest'

import {
  type Cursor,
  allPositions,
  cursorAtEnd,
  cursorAtStart,
  cursorsEqual,
  isValidCursor,
  moveDown,
  moveLeft,
  moveRight,
  moveUp,
} from '../src/editor/cursor'
import {
  type Atom,
  type Row,
  derivative,
  fraction,
  func,
  group,
  root,
  row,
  superscript,
  symbol,
} from '../src/editor/layout'

function walk(tree: Row, from: Cursor, step: typeof moveRight): Cursor[] {
  const visited = [from]
  let current: Cursor | null = from

  while ((current = step(tree, current))) {
    visited.push(current)

    if (visited.length > 10_000) {
      throw new Error('walk did not terminate')
    }
  }

  return visited
}

// Compact, readable form of a cursor for assertions: "num@1" is offset 1 in
// the numerator of the atom at index 0 of the root row, and so on.
function label(c: Cursor): string {
  const path = c.path.map((s) => `${s.atom}.${s.branch}`).join('/')
  return path ? `${path}@${c.offset}` : `@${c.offset}`
}

// Equations the editor's original leaf-based caret could not fully traverse
// (see History in docs/design.md).
const reviewCases: Record<string, () => Row> = {
  'x + 1/2 + 3': () => row('x+', fraction(row('1'), row('2')), '+3'),
  'sin(x)^2 = y': () => row(func('sin'), group(row('x')), superscript(row('2')), '=y'),
  'x^2 + 1/(x+1)': () => row('x', superscript(row('2')), '+', fraction(row('1'), row('x+1'))),
}

describe('horizontal traversal of the review equations', () => {
  it('x + 1/2 + 3 stops after the fraction and reaches the end', () => {
    const tree = reviewCases['x + 1/2 + 3']()
    expect(walk(tree, cursorAtStart(), moveRight).map(label)).toEqual([
      '@0', // |x
      '@1', // x|+
      '@2', // x+|(1/2)
      '2.num@0',
      '2.num@1',
      '2.den@0',
      '2.den@1',
      '@3', // after the fraction as a whole
      '@4',
      '@5', // end of equation
    ])
  })

  it('sin(x)^2 = y has a gap before sin, after sin(x), and at the end', () => {
    const tree = reviewCases['sin(x)^2 = y']()
    expect(walk(tree, cursorAtStart(), moveRight).map(label)).toEqual([
      '@0', // before sin
      '@1', // between sin and (
      '1.body@0',
      '1.body@1',
      '@2', // after sin(x), before the superscript
      '2.sup@0',
      '2.sup@1',
      '@3', // after sin(x)^2
      '@4',
      '@5', // end of equation
    ])
  })

  it('x^2 + 1/(x+1) can leave the denominator and reach the end', () => {
    const tree = reviewCases['x^2 + 1/(x+1)']()
    const visited = walk(tree, cursorAtStart(), moveRight)
    expect(visited.map(label).slice(-3)).toEqual(['3.den@2', '3.den@3', '@4'])
    expect(cursorsEqual(visited[visited.length - 1], cursorAtEnd(tree))).toBe(true)
  })
})

describe('boundaries', () => {
  it('stays put at the start and end of the equation', () => {
    const tree = row('x+1')
    expect(moveLeft(tree, cursorAtStart())).toBeNull()
    expect(moveRight(tree, cursorAtEnd(tree))).toBeNull()
  })

  it('an empty equation has exactly one position', () => {
    expect(allPositions([])).toEqual([{ path: [], offset: 0 }])
    expect(moveLeft([], cursorAtStart())).toBeNull()
    expect(moveRight([], cursorAtStart())).toBeNull()
  })

  it('an empty child row has exactly one position', () => {
    const tree = row(fraction())
    expect(walk(tree, cursorAtStart(), moveRight).map(label)).toEqual([
      '@0',
      '0.num@0',
      '0.den@0',
      '@1',
    ])
  })

  it('enters and leaves each structure kind in reading order', () => {
    const tree = row(
      root(row('x'), row('3')),
      root(row('y')),
      group(row('a'), '|'),
      derivative(row('f'), row('t')),
    )
    expect(walk(tree, cursorAtStart(), moveRight).map(label)).toEqual([
      '@0',
      '0.index@0',
      '0.index@1',
      '0.body@0',
      '0.body@1',
      '@1',
      '1.body@0',
      '1.body@1',
      '@2',
      '2.body@0',
      '2.body@1',
      '@3',
      '3.expr@0',
      '3.expr@1',
      '3.variable@0',
      '3.variable@1',
      '@4',
    ])
  })
})

// ---------------------------------------------------------------------------
// Property tests over random trees
// ---------------------------------------------------------------------------

// Small deterministic PRNG so failures are reproducible from the seed.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomRow(rand: () => number, depth: number): Row {
  const length = Math.floor(rand() * 5)
  const atoms: Atom[] = []

  for (let i = 0; i < length; i++) {
    const pick = depth > 0 ? Math.floor(rand() * 9) : 0
    const child = () => randomRow(rand, depth - 1)

    switch (pick) {
      case 1:
        atoms.push(fraction(child(), child()))
        break
      case 2:
        atoms.push(superscript(child()))
        break
      case 3:
        atoms.push(root(child(), rand() < 0.5 ? child() : null))
        break
      case 4:
        atoms.push(group(child()))
        break
      case 5:
        atoms.push(derivative(child(), child()))
        break
      case 6:
        atoms.push(func('sin'))
        break
      default:
        atoms.push(symbol('xyz+-=123'[Math.floor(rand() * 9)]))
    }
  }

  return atoms
}

describe('traversal invariants (random trees)', () => {
  const trees = Array.from({ length: 300 }, (_, seed) => randomRow(mulberry32(seed + 1), 3))

  it('→ from the start visits every position exactly once, in order, ending at the end', () => {
    for (const tree of trees) {
      const visited = walk(tree, cursorAtStart(), moveRight)
      expect(visited).toEqual(allPositions(tree))
      expect(cursorsEqual(visited[visited.length - 1], cursorAtEnd(tree))).toBe(true)
    }
  })

  it('← from the end retraces exactly the same positions in reverse', () => {
    for (const tree of trees) {
      expect(walk(tree, cursorAtEnd(tree), moveLeft)).toEqual(allPositions(tree).reverse())
    }
  })

  it('← undoes → and → undoes ← at every position', () => {
    for (const tree of trees) {
      for (const position of allPositions(tree)) {
        const right = moveRight(tree, position)
        if (right) expect(moveLeft(tree, right)).toEqual(position)

        const left = moveLeft(tree, position)
        if (left) expect(moveRight(tree, left)).toEqual(position)
      }
    }
  })

  it('every position is valid, and ↑/↓ always land on a valid position', () => {
    for (const tree of trees) {
      for (const position of allPositions(tree)) {
        expect(isValidCursor(tree, position)).toBe(true)

        for (const moved of [moveUp(tree, position), moveDown(tree, position)]) {
          if (moved) expect(isValidCursor(tree, moved)).toBe(true)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Vertical movement
// ---------------------------------------------------------------------------

describe('vertical movement', () => {
  const inNum = (offset: number): Cursor => ({ path: [{ atom: 0, branch: 'num' }], offset })
  const inDen = (offset: number): Cursor => ({ path: [{ atom: 0, branch: 'den' }], offset })

  it('moves between numerator and denominator, clamping the offset', () => {
    const tree = row(fraction(row('x+1'), row('2')))
    expect(moveDown(tree, inNum(3))).toEqual(inDen(1))
    expect(moveUp(tree, inDen(1))).toEqual(inNum(1))
    expect(moveUp(tree, inNum(0))).toBeNull()
    expect(moveDown(tree, inDen(0))).toBeNull()
  })

  it('uses a supplied offset picker (e.g. matching the caret x position)', () => {
    const tree = row(fraction(row('x+1'), row('23')))
    expect(moveDown(tree, inNum(0), (target) => target.length)).toEqual(inDen(2))
  })

  it('escapes to the nearest enclosing structure with a row in that direction', () => {
    // (a/b) / c, cursor in the inner denominator "b".
    const tree = row(fraction(row(fraction(row('a'), row('b'))), row('c')))
    const innerDen: Cursor = {
      path: [
        { atom: 0, branch: 'num' },
        { atom: 0, branch: 'den' },
      ],
      offset: 1,
    }
    expect(moveUp(tree, innerDen)).toEqual({
      path: [
        { atom: 0, branch: 'num' },
        { atom: 0, branch: 'num' },
      ],
      offset: 1,
    })
    expect(moveDown(tree, innerDen)).toEqual(inDen(1))
  })

  it('has no vertical move in the root row, a superscript, or a square root', () => {
    const tree = row('x', superscript(row('2')), root(row('y')))
    expect(moveUp(tree, cursorAtStart())).toBeNull()
    expect(moveDown(tree, { path: [{ atom: 1, branch: 'sup' }], offset: 0 })).toBeNull()
    expect(moveUp(tree, { path: [{ atom: 2, branch: 'body' }], offset: 0 })).toBeNull()
  })

  it('moves between an nth root index and its body', () => {
    const tree = row(root(row('x'), row('3')))
    expect(moveDown(tree, { path: [{ atom: 0, branch: 'index' }], offset: 1 })).toEqual({
      path: [{ atom: 0, branch: 'body' }],
      offset: 1,
    })
  })
})
