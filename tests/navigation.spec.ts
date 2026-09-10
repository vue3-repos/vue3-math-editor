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

describe('stepCaret', () => {
  it('first flips side in place, without jumping to a different leaf', () => {
    expect(stepCaret(zPlusAtimesB, { path: b, side: 'after' }, 'backward')).toEqual({
      path: b,
      side: 'before',
    })
    expect(stepCaret(zPlusAtimesB, { path: z, side: 'before' }, 'forward')).toEqual({
      path: z,
      side: 'after',
    })
  })

  it('a second consecutive press in the same direction moves to the neighboring leaf', () => {
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

  it('steps across a composite selection using moveLeaf\'s skip-over-block behavior', () => {
    // Selecting the whole Multiply(a, b) block: 'before' flips to 'after' in
    // place first, then a further forward press hits the right boundary.
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
})
