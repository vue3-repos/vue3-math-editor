import { describe, expect, it } from 'vitest'

import { moveLeaf } from '../src/editor/navigation'
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
