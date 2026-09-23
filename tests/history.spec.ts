import { describe, expect, it } from 'vitest'

import { type EditInfo, History, OTHER_EDIT, undoGroup } from '../src/editor/history'

// A history over strings with a hand-driven clock, plus an "editor" that
// checkpoints before each edit the way the workbench does.
function setup(pauseMs = 1000) {
  let time = 0
  let text = ''
  const history = new History<string>({ pauseMs, now: () => time })

  const edit = (next: string, info: EditInfo, line = 0) => {
    history.checkpoint(() => text, undoGroup(line, info))
    text = next
  }

  const typeChars = (chars: string, line = 0) => {
    for (const char of chars) edit(text + char, { kind: 'type', text: char }, line)
  }

  return {
    history,
    edit,
    typeChars,
    wait: (ms: number) => (time += ms),
    get text() {
      return text
    },
    undo: () => (text = history.undo(text) ?? text),
    redo: () => (text = history.redo(text) ?? text),
  }
}

describe('undoGroup', () => {
  it('groups typing per line, starting a new step at an operator', () => {
    expect(undoGroup(0, { kind: 'type', text: 'x' })).toEqual({ key: 'type:0', fresh: false })
    expect(undoGroup(2, { kind: 'type', text: 'x' })).toEqual({ key: 'type:2', fresh: false })
    for (const op of ['+', '-', '=', '·', ',']) {
      expect(undoGroup(0, { kind: 'type', text: op }).fresh).toBe(true)
    }
  })

  it('starts a new step when typing replaces a selection', () => {
    expect(undoGroup(0, { kind: 'type', text: 'x', replacedSelection: true }).fresh).toBe(true)
  })

  it('groups repeated deletes by direction; a deleted selection is its own step', () => {
    expect(undoGroup(0, { kind: 'deleteBackward' }).key).toBe('deleteBackward:0')
    expect(undoGroup(0, { kind: 'deleteForward' }).key).toBe('deleteForward:0')
    expect(undoGroup(0, { kind: 'deleteBackward', replacedSelection: true }).key).toBeNull()
    expect(undoGroup(0, OTHER_EDIT).key).toBeNull()
  })
})

describe('History', () => {
  it('coalesces consecutive typing into one step', () => {
    const t = setup()
    t.typeChars('Vm_init')
    expect(t.text).toBe('Vm_init')
    t.undo()
    expect(t.text).toBe('')
    expect(t.history.canUndo).toBe(false)
    t.redo()
    expect(t.text).toBe('Vm_init')
  })

  it('takes back one operator and what follows it at a time', () => {
    const t = setup()
    t.typeChars('x+1=2')
    t.undo()
    expect(t.text).toBe('x+1')
    t.undo()
    expect(t.text).toBe('x')
    t.undo()
    expect(t.text).toBe('')
  })

  it('starts a new step after a pause', () => {
    const t = setup(1000)
    t.typeChars('ab')
    t.wait(1001)
    t.typeChars('c')
    t.undo()
    expect(t.text).toBe('ab')
  })

  it('keeps typing together across short pauses', () => {
    const t = setup(1000)
    t.typeChars('a')
    t.wait(900)
    t.typeChars('b')
    t.wait(900)
    t.typeChars('c')
    t.undo()
    expect(t.text).toBe('')
  })

  it('starts a new step after breakGroup (a cursor move)', () => {
    const t = setup()
    t.typeChars('ab')
    t.history.breakGroup()
    t.typeChars('c')
    t.undo()
    expect(t.text).toBe('ab')
  })

  it('does not group typing on different lines', () => {
    const t = setup()
    t.typeChars('a', 0)
    t.typeChars('b', 1)
    t.undo()
    expect(t.text).toBe('a')
  })

  it('keeps typing and deleting in separate steps, and groups repeated deletes', () => {
    const t = setup()
    t.typeChars('abcd')
    for (let i = 0; i < 3; i++) t.edit(t.text.slice(0, -1), { kind: 'deleteBackward' })
    expect(t.text).toBe('a')
    t.undo()
    expect(t.text).toBe('abcd')
    t.undo()
    expect(t.text).toBe('')
  })

  it('makes every other edit a step of its own', () => {
    const t = setup()
    t.edit('a', OTHER_EDIT)
    t.edit('ab', OTHER_EDIT)
    t.undo()
    expect(t.text).toBe('a')
  })

  it('a new edit clears redo, and never joins the step before an undo', () => {
    const t = setup()
    t.typeChars('ab')
    t.undo()
    t.typeChars('x')
    expect(t.history.canRedo).toBe(false)
    t.typeChars('y')
    t.undo()
    expect(t.text).toBe('')
  })

  it('keeps at most `limit` steps', () => {
    const history = new History<number>({ limit: 3 })
    for (let i = 0; i < 5; i++) history.checkpoint(() => i)
    expect(history.undo(5)).toBe(4)
    expect(history.undo(4)).toBe(3)
    expect(history.undo(3)).toBe(2)
    expect(history.undo(2)).toBeNull()
  })
})
