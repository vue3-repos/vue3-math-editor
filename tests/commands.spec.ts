import { describe, expect, it } from 'vitest'

import { deleteEmptyGroupAtPath, deletePlaceholderAtPath, getNodeAtPath } from '../src/editor/commands'
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
