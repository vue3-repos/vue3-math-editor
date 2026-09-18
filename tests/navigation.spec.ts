import { describe, expect, it } from 'vitest'

import { climbForOperator, moveLeaf, stepCaret } from '../src/editor/navigation'
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

// Leaf paths in "z + a*b", for readability below.
const z = ['children', 0]
const a = ['children', 1, 'children', 0]
const b = ['children', 1, 'children', 1]
const ab = ['children', 1]

// 4x -> Multiply(4, x). Leaves: 4, x. Pure juxtaposition, nothing rendered
// between the two factors — the one case that should collapse.
const fourX: AstNode = {
  type: 'Multiply',
  children: [
    { type: 'Number', value: 4 },
    { type: 'Identifier', name: 'x' },
  ],
}

// x-3 -> Subtract(x, 3). Leaves: x, 3. An explicit "-" sits between them.
const xMinusThree: AstNode = {
  type: 'Subtract',
  minuend: { type: 'Identifier', name: 'x' },
  subtrahend: { type: 'Number', value: 3 },
}

// x^2 -> Power(x, 2), alone. A named slot (not a list) always pops out
// once exhausted.
const xToTheTwo: AstNode = {
  type: 'Power',
  base: { type: 'Identifier', name: 'x' },
  exponent: { type: 'Number', value: 2 },
}

// sin(x) -> FunctionCall(sin, [x]), alone. One argument: its own edge *is*
// unambiguously the edge of the whole function call.
const sinOfX: AstNode = {
  type: 'FunctionCall',
  name: 'sin',
  args: [{ type: 'Identifier', name: 'x' }],
}

// max(a, b) -> FunctionCall(max, [a, b]). Two arguments: reaching the edge
// of the *list* while still walking multiple terms should not pop out,
// same as an Add/Multiply with more than one child.
const maxOfAB: AstNode = {
  type: 'FunctionCall',
  name: 'max',
  args: [
    { type: 'Identifier', name: 'a' },
    { type: 'Identifier', name: 'b' },
  ],
}

// 1/x + 5 -> Add(Divide(1, x), 5). Leaves: 1, x, 5.
const oneOverXPlusFive: AstNode = {
  type: 'Add',
  children: [
    {
      type: 'Divide',
      numerator: { type: 'Number', value: 1 },
      denominator: { type: 'Identifier', name: 'x' },
    },
    { type: 'Number', value: 5 },
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

  it('collapses the gap between two Multiply factors — the one case with nothing rendered between them', () => {
    // "4x": right-of-4 and left-of-x are the same gap, so forward from
    // "before 4" reaches "before x" in one press, not two.
    expect(stepCaret(fourX, { path: ['children', 0], side: 'before' }, 'forward')).toEqual({
      path: ['children', 1],
      side: 'before',
    })
  })

  it('does not collapse an explicit operator\'s gap, even between two otherwise-adjacent leaves', () => {
    // The reported bug: "x-3" silently treated "right of x" (before the
    // "-") and "left of 3" (after it) as the same stop, skipping the minus
    // sign entirely. They must stay distinct, each reachable on its own.
    expect(stepCaret(xMinusThree, { path: ['minuend'], side: 'before' }, 'forward')).toEqual({
      path: ['minuend'],
      side: 'after',
    })
    // Only a further press moves on to the other operand.
    expect(stepCaret(xMinusThree, { path: ['minuend'], side: 'after' }, 'forward')).toEqual({
      path: ['subtrahend'],
      side: 'before',
    })
  })

  it('walking left across "x-3" visits all four distinct stops, matching the reported expectation', () => {
    // Exactly the reported repro: type "x-3", ArrowLeft twice from the
    // default "after 3" should land to the *right* of x (before the fix,
    // it landed to the left, having silently skipped past the "-").
    const afterThree = { path: ['subtrahend'], side: 'after' } as const
    const leftOnce = stepCaret(xMinusThree, afterThree, 'backward')
    expect(leftOnce).toEqual({ path: ['subtrahend'], side: 'before' })

    const leftTwice = stepCaret(xMinusThree, leftOnce!, 'backward')
    expect(leftTwice).toEqual({ path: ['minuend'], side: 'after' })

    // A third press reaches the true left boundary, on the other side of x.
    const leftThrice = stepCaret(xMinusThree, leftTwice!, 'backward')
    expect(leftThrice).toEqual({ path: ['minuend'], side: 'before' })
  })

  it('a second consecutive backward press moves to the neighboring leaf, landing on its own edge when not sharing a gap', () => {
    // b|after -> (flip) b|before -> (move, a/b share a Multiply gap) a|before
    // -> (move, z/a don't — separated by "+") z|after
    expect(stepCaret(zPlusAtimesB, { path: b, side: 'before' }, 'backward')).toEqual({
      path: a,
      side: 'before',
    })
    expect(stepCaret(zPlusAtimesB, { path: a, side: 'before' }, 'backward')).toEqual({
      path: z,
      side: 'after',
    })
  })

  it('stops at the equation boundary when there is nothing to pop out to either', () => {
    expect(stepCaret(zPlusAtimesB, { path: z, side: 'before' }, 'backward')).toBeNull()
    expect(stepCaret(zPlusAtimesB, { path: b, side: 'after' }, 'forward')).toBeNull()
  })

  it('treats a composite selection as one block to skip over, not dive into', () => {
    // Selecting the whole Multiply(a, b) block, with nothing after it:
    // 'before' flips to 'after' in place (no next leaf, and — unlike a
    // single-argument function — a 2-element list doesn't pop out either),
    // then a further forward press hits the right boundary.
    expect(stepCaret(zPlusAtimesB, { path: ab, side: 'before' }, 'forward')).toEqual({
      path: ab,
      side: 'after',
    })
    expect(stepCaret(zPlusAtimesB, { path: ab, side: 'after' }, 'forward')).toBeNull()

    // Backward from the block skips over it to the leaf right before it
    // ('z'), landing on z's own edge — not into the block's last leaf
    // ('b'), and not collapsed with z either, since "+" separates them.
    expect(stepCaret(zPlusAtimesB, { path: ab, side: 'before' }, 'backward')).toEqual({
      path: z,
      side: 'after',
    })
  })

  it('pops out of a single-argument function call once its argument is exhausted', () => {
    // "sin(x", caret after "x" (the default after typing it) — nothing
    // more to walk to within the argument, but the call has exactly one
    // argument, so the caret can still step out to "after the whole
    // sin(...)" instead of dead-stopping.
    expect(stepCaret(sinOfX, { path: ['args', 0], side: 'after' }, 'forward')).toEqual({
      path: [],
      side: 'after',
    })
    // From there, there truly is nothing more — genuine stop.
    expect(stepCaret(sinOfX, { path: [], side: 'after' }, 'forward')).toBeNull()
  })

  it('does not pop out of a multi-argument function call — still walking its terms', () => {
    expect(stepCaret(maxOfAB, { path: ['args', 1], side: 'after' }, 'forward')).toBeNull()
  })

  it('pops out of a power\'s exponent once it is exhausted', () => {
    expect(stepCaret(xToTheTwo, { path: ['exponent'], side: 'after' }, 'forward')).toEqual({
      path: [],
      side: 'after',
    })
  })
})

describe('climbForOperator', () => {
  it('splits a different-typed variadic parent at a mid-list caret instead of wrapping it whole', () => {
    // The reported bug: "4x" with the caret before "x", typing "+" — used
    // to climb straight past the Multiply (wrapping it whole, giving
    // "4x+3"), discarding that the caret sat strictly between its two
    // factors. It should report a split at that gap instead.
    const climb = climbForOperator(fourX, ['children', 1], 'before', 2, 'Add')
    expect(climb.splitAt).toEqual({ parentPath: [], index: 1 })
    expect(climb.siblingParent).toBe(false)
  })

  it('does not split when the caret is at the variadic parent\'s own edge', () => {
    // Caret after "x" (the last factor) — this is the ordinary "append
    // after the whole product" case ("4*t-3" style), not a mid-list split.
    const climb = climbForOperator(fourX, ['children', 1], 'after', 2, 'Add')
    expect(climb.splitAt).toBeNull()
    expect(climb.path).toEqual([])
  })

  it('never auto-escapes a structural slot, no matter what lies beyond it globally', () => {
    // "x^2" alone: there's nothing else in the whole equation, but
    // escaping is still not this function's call to make — inferring
    // "safe to escape" from global emptiness is exactly what let "sin(x"
    // + "+1" wrongly escape to "sin(x)+1" instead of "sin(x+1)". Climbing
    // always stays inside; reaching the outside is `stepCaret`'s job (see
    // its "pops out of a power's exponent" case above).
    const climb = climbForOperator(xToTheTwo, ['exponent'], 'after', 2, 'Add')
    expect(climb.path).toEqual(['exponent'])
    expect(climb.splitAt).toBeNull()
  })

  it('stays inside a structural slot when something else exists to protect', () => {
    // "1/x + 5", focused on the denominator: "5" sits outside the
    // fraction, so escaping the Divide here would wrongly disturb it.
    // Typing "+3" must stay inside, building "1/(x+3) + 5".
    const climb = climbForOperator(
      oneOverXPlusFive,
      ['children', 0, 'denominator'],
      'after',
      2,
      'Add',
    )
    expect(climb.path).toEqual(['children', 0, 'denominator'])
    expect(climb.splitAt).toBeNull()
  })

  it('stays inside a function\'s sole argument even when it is the whole equation', () => {
    // "sin(x" + "+1": must build "sin(x+1)", not escape to "sin(x)+1".
    const climb = climbForOperator(sinOfX, ['args', 0], 'after', 2, 'Add')
    expect(climb.path).toEqual(['args', 0])
    expect(climb.splitAt).toBeNull()
  })
})
