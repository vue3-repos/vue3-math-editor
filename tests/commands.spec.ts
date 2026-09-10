import { describe, expect, it } from 'vitest'

import {
  convertIdentifierToFunctionCallAtPath,
  deleteEmptyGroupAtPath,
  deletePlaceholderAtPath,
  firstChildPath,
  getNodeAtPath,
  insertImplicitFactorAtPath,
} from '../src/editor/commands'
import type { AstNode } from '../src/types/ast'

// Backspacing an empty "()" should remove it in one step, whether focus is
// on the placeholder inside the parens or on the group itself. Before this
// fix, deleting the inner placeholder only collapsed the group down to a
// bare placeholder left in place — a second backspace was needed to drop
// that placeholder from its parent's children.
describe('deleteEmptyGroupAtPath', () => {
  it('removes an empty group from a variadic parent (2 * () -> 2)', () => {
    const ast: AstNode = {
      type: 'Multiply',
      children: [
        { type: 'Number', value: 2 },
        { type: 'Group', value: { type: 'Placeholder' } },
      ],
    }

    const result = deleteEmptyGroupAtPath(ast, ['children', 1])

    expect(result.ast).toEqual({ type: 'Number', value: 2 })
  })

  it('collapses a lone empty group to a bare placeholder', () => {
    const ast: AstNode = { type: 'Group', value: { type: 'Placeholder' } }

    const result = deleteEmptyGroupAtPath(ast, [])

    expect(result.ast).toEqual({ type: 'Placeholder' })
    expect(result.focusedPath).toEqual([])
  })
})

describe('handleBackspace-style redirect from an empty group\'s inner placeholder', () => {
  it('deletePlaceholderAtPath alone would strand an orphan placeholder as a sibling', () => {
    // This documents the bug deleteEmptyGroupAtPath fixes: calling the
    // generic placeholder-delete on the *inner* placeholder's path only
    // climbs one level (to the group), so the empty term survives as a
    // bare placeholder inside the Multiply instead of being dropped.
    const ast: AstNode = {
      type: 'Multiply',
      children: [
        { type: 'Number', value: 2 },
        { type: 'Group', value: { type: 'Placeholder' } },
      ],
    }

    const result = deletePlaceholderAtPath(ast, ['children', 1, 'value'])

    expect(getNodeAtPath(result.ast, ['children', 1])).toEqual({ type: 'Placeholder' })
    expect((result.ast as { children: AstNode[] }).children).toHaveLength(2)
  })
})

describe('firstChildPath', () => {
  // Drilling in (ArrowDown) with the whole equation selected resolves the
  // root node's first child path. "Equal" was missing from the switch, so
  // it fell through to the default `null` and drill-in from the root did
  // nothing — even though sibling logic (childKeysForNode) already knew
  // "Equal" has "left"/"right" children.
  it('drills into the left-hand side of an Equal node', () => {
    const equal: AstNode = {
      type: 'Equal',
      left: { type: 'Derivative', expression: { type: 'Identifier', name: 'x' }, variable: { type: 'Identifier', name: 't' } },
      right: { type: 'Number', value: 5 },
    }

    expect(firstChildPath(equal)).toEqual(['left'])
  })
})

describe('insertImplicitFactorAtPath', () => {
  // The reported bug: "2+t", focus on t, ArrowLeft (caret side 'before'),
  // type "3" should give 2 + 3t, not 2 + t3 — there was previously no way
  // to insert a new factor to the *left* of an existing term at all.
  it('wraps a plain leaf in an implicit multiply, before or after, per side', () => {
    const twoPlusT: AstNode = {
      type: 'Add',
      children: [
        { type: 'Number', value: 2 },
        { type: 'Identifier', name: 't' },
      ],
    }

    const before = insertImplicitFactorAtPath(
      twoPlusT,
      ['children', 1],
      { type: 'Number', value: 3 },
      'before',
    )
    expect(getNodeAtPath(before.ast, ['children', 1])).toEqual({
      type: 'Multiply',
      children: [
        { type: 'Number', value: 3 },
        { type: 'Identifier', name: 't' },
      ],
    })
    expect(before.focusedPath).toEqual(['children', 1, 'children', 0])

    const after = insertImplicitFactorAtPath(
      twoPlusT,
      ['children', 1],
      { type: 'Number', value: 3 },
      'after',
    )
    expect(getNodeAtPath(after.ast, ['children', 1])).toEqual({
      type: 'Multiply',
      children: [
        { type: 'Identifier', name: 't' },
        { type: 'Number', value: 3 },
      ],
    })
    expect(after.focusedPath).toEqual(['children', 1, 'children', 1])
  })

  it('inserts a before/after sibling when focus is already inside a Multiply', () => {
    const twoTimesT: AstNode = {
      type: 'Multiply',
      children: [
        { type: 'Number', value: 2 },
        { type: 'Identifier', name: 't' },
      ],
    }

    const before = insertImplicitFactorAtPath(
      twoTimesT,
      ['children', 1],
      { type: 'Number', value: 3 },
      'before',
    )
    expect(before.ast).toEqual({
      type: 'Multiply',
      children: [
        { type: 'Number', value: 2 },
        { type: 'Number', value: 3 },
        { type: 'Identifier', name: 't' },
      ],
    })
    expect(before.focusedPath).toEqual(['children', 1])

    const after = insertImplicitFactorAtPath(
      twoTimesT,
      ['children', 1],
      { type: 'Number', value: 3 },
      'after',
    )
    expect(after.ast).toEqual({
      type: 'Multiply',
      children: [
        { type: 'Number', value: 2 },
        { type: 'Identifier', name: 't' },
        { type: 'Number', value: 3 },
      ],
    })
    expect(after.focusedPath).toEqual(['children', 2])
  })
})

describe('convertIdentifierToFunctionCallAtPath', () => {
  // Typing "2x(+4" should give 2*x(□+4), not 2*x(x+4). The identifier is
  // consumed as the function's *name*, so it must not also survive as a
  // copy of itself in the argument list.
  it('starts the argument list with a placeholder instead of the identifier itself', () => {
    const ast: AstNode = {
      type: 'Multiply',
      children: [
        { type: 'Number', value: 2 },
        { type: 'Identifier', name: 'x' },
      ],
    }

    const result = convertIdentifierToFunctionCallAtPath(ast, ['children', 1])

    expect(getNodeAtPath(result.ast, ['children', 1])).toEqual({
      type: 'FunctionCall',
      name: 'x',
      args: [{ type: 'Placeholder' }],
    })
    expect(result.focusedPath).toEqual(['children', 1, 'args', 0])
  })
})
