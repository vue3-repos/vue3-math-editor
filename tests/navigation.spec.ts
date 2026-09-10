import { describe, expect, it } from 'vitest'

import { moveLeaf, stepCaret } from '../src/editor/navigation'
import type { AstNode } from '../src/types/ast'

// z + a*b -> Add(z, Multiply(a, b)). Leaves in reading order: z, a, b.
const zPlusAtimesB: AstNode = {
  type: 'Add',
  children: [
    { type: 'Identifier', name: 'z' },
    {
      type: 'Multiply',
      children: [
        { type: 'Identifier', name: 'a' },
        { type: 'Identifier', name: 'b' },
      ],
    },
  ],
}

describe('moveLeaf', () => {
  it('forward skips a composite selection to the leaf right after it, not into it', () => {
    // Focus on the whole Multiply(a, b) subtree.
    expect(moveLeaf(zPlusAtimesB, ['children', 1], 'forward')).toBeNull()
  })

  it('backward skips a composite selection to the leaf right before it, not into it', () => {
    // Before the fix this dove into the composite's own last leaf ('b')
    // instead of skipping to what precedes the whole subtree ('z') —
    // asymmetric with forward, which always skips past a subtree rather
    // than descending into it.
    expect(moveLeaf(zPlusAtimesB, ['children', 1], 'backward')).toEqual(['children', 0])
  })

  it('returns null at the left boundary, symmetric with the right boundary', () => {
    expect(moveLeaf(zPlusAtimesB, ['children', 0], 'backward')).toBeNull()
    expect(moveLeaf(zPlusAtimesB, ['children', 1, 'children', 1], 'forward')).toBeNull()
  })
})

// Leaf paths in "z + a*b", for readability below.
const z = ['children', 0]
const a = ['children', 1, 'children', 0]
const b = ['children', 1, 'children', 1]
const ab = ['children', 1]

// a*b + z -> Add(Multiply(a, b), z). Leaves in reading order: a, b, z.
// (Same shape as zPlusAtimesB, mirrored, so the composite has something
// *after* it instead of being the last thing.)
const aTimesBPlusZ: AstNode = {
  type: 'Add',
  children: [
    {
      type: 'Multiply',
      children: [
        { type: 'Identifier', name: 'a' },
        { type: 'Identifier', name: 'b' },
      ],
    },
    { type: 'Identifier', name: 'z' },
  ],
}
const ab2 = ['children', 0]
const z2 = ['children', 1]

describe('stepCaret', () => {
  it('backward flip stays on the same leaf — "before" has no earlier duplicate to fold into', () => {
    expect(stepCaret(zPlusAtimesB, { path: b, side: 'after' }, 'backward')).toEqual({
      path: b,
      side: 'before',
    })
  })

  it('forward flip stays on the same leaf only at the true right boundary', () => {
    // b is the last leaf overall, so "after b" has no next leaf to fold
    // into and stays a genuine, distinct stop.
    expect(stepCaret(zPlusAtimesB, { path: b, side: 'before' }, 'forward')).toEqual({
      path: b,
      side: 'after',
    })
  })

  it('forward flip redirects to the next leaf\'s "before" instead of creating a redundant stop', () => {
    // The reported case: in "4x" (here "z" then "a"), right-of-z and
    // left-of-a are the same gap. Before the fix this returned
    // { path: z, side: 'after' } — a second, redundant stop distinct from
    // { path: a, side: 'before' }, needing an extra keypress to bridge.
    expect(stepCaret(zPlusAtimesB, { path: z, side: 'before' }, 'forward')).toEqual({
      path: a,
      side: 'before',
    })
  })

  it('a second consecutive backward press moves to the neighboring leaf', () => {
    // b|after -> (flip) b|before -> (move) a|before -> (move) z|before
    expect(stepCaret(zPlusAtimesB, { path: b, side: 'before' }, 'backward')).toEqual({
      path: a,
      side: 'before',
    })
    expect(stepCaret(zPlusAtimesB, { path: a, side: 'before' }, 'backward')).toEqual({
      path: z,
      side: 'before',
    })
  })

  it('stops at the equation boundary in either direction', () => {
    expect(stepCaret(zPlusAtimesB, { path: z, side: 'before' }, 'backward')).toBeNull()
    expect(stepCaret(zPlusAtimesB, { path: b, side: 'after' }, 'forward')).toBeNull()
  })

  it('treats a composite selection as one block to skip over, not dive into', () => {
    // Selecting the whole Multiply(a, b) block, with nothing after it:
    // 'before' flips to 'after' in place (no next leaf to redirect to),
    // then a further forward press hits the right boundary.
    expect(stepCaret(zPlusAtimesB, { path: ab, side: 'before' }, 'forward')).toEqual({
      path: ab,
      side: 'after',
    })
    expect(stepCaret(zPlusAtimesB, { path: ab, side: 'after' }, 'forward')).toBeNull()

    // Backward from the block skips over it to the leaf right before it
    // ('z'), not into its own last leaf ('b') — same as moveLeaf itself.
    expect(stepCaret(zPlusAtimesB, { path: ab, side: 'before' }, 'backward')).toEqual({
      path: z,
      side: 'before',
    })
  })

  it('collapses a composite\'s own trailing stop into the next leaf\'s, same as a plain leaf', () => {
    // Here the Multiply(a, b) block is *not* last — "after the whole
    // block" and "before z" are the same gap, so forward from the block's
    // leading edge skips both its internal gap (between a and b) and the
    // redundant trailing one, landing directly on z — in one press, not
    // three.
    expect(stepCaret(aTimesBPlusZ, { path: ab2, side: 'before' }, 'forward')).toEqual({
      path: z2,
      side: 'before',
    })
  })
})
