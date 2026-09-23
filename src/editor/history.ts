// Undo/redo history, with consecutive typing coalesced into one undo step.
//
// The history stores snapshots of whatever state the caller keeps (the
// workbench stores all lines plus the active line). Before an edit is applied
// the caller calls `checkpoint`, naming the undo group the edit belongs to:
// an edit in the same group as the previous one, soon enough after it, joins
// that step instead of starting a new one. Anything else that happens in
// between (moving the cursor, clicking, switching lines, undo itself) must
// call `breakGroup`, so a group only ever covers edits made one after another
// at the same place.
//
// Which edits group together is decided by `undoGroup` below.

// What kind of edit a key press made (reported by MathField).
export interface EditInfo {
  kind: 'type' | 'deleteBackward' | 'deleteForward' | 'other'
  // For 'type': the character inserted.
  text?: string
  // The edit replaced or deleted a selection.
  replacedSelection?: boolean
  // For 'type': a sign typed as part of a number's exponent ("1e-08"), which
  // doesn't start a new step the way an operator does.
  exponentSign?: boolean
}

export const OTHER_EDIT: EditInfo = { kind: 'other' }

export interface UndoGroup {
  // Edits with the same key, one after another, share an undo step; null
  // means the edit is always a step of its own.
  key: string | null
  // Start a new step even if the previous edit had the same key.
  fresh: boolean
}

// Characters that begin a new undo step when typed, so undoing takes back
// one operator and what was typed after it: typing "x+1=2" and undoing
// gives "x+1", then "x", then nothing. They play the part of the spaces
// between words in a text editor.
const OPERATORS = new Set(['+', '-', '=', '·', ',', '<', '>', '≤', '≥', '≠', '∧', '∨', '⊻', '¬'])

export function undoGroup(line: number, edit: EditInfo): UndoGroup {
  switch (edit.kind) {
    case 'type':
      // Typing over a selection starts a new step; what's typed next joins it.
      return {
        key: `type:${line}`,
        fresh: !!edit.replacedSelection || (OPERATORS.has(edit.text ?? '') && !edit.exponentSign),
      }
    case 'deleteBackward':
    case 'deleteForward':
      // Deleting a selection is a step of its own; repeated Backspace (or
      // Delete) presses group.
      return edit.replacedSelection
        ? { key: null, fresh: true }
        : { key: `${edit.kind}:${line}`, fresh: false }
    default:
      return { key: null, fresh: true }
  }
}

export interface HistoryOptions {
  // Most undo steps kept.
  limit?: number
  // A pause longer than this (ms) between edits starts a new step.
  pauseMs?: number
  now?: () => number
}

export class History<S> {
  private undoStack: S[] = []
  private redoStack: S[] = []
  private openGroup: string | null = null
  private lastEditAt = -Infinity

  private readonly limit: number
  private readonly pauseMs: number
  private readonly now: () => number

  constructor(options: HistoryOptions = {}) {
    this.limit = options.limit ?? 200
    this.pauseMs = options.pauseMs ?? 1000
    this.now = options.now ?? (() => Date.now())
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  // Record the state before an edit. `snapshot` is only called when a new
  // undo step starts.
  checkpoint(snapshot: () => S, group: UndoGroup = { key: null, fresh: true }): void {
    const time = this.now()
    const joins =
      group.key !== null &&
      !group.fresh &&
      group.key === this.openGroup &&
      time - this.lastEditAt <= this.pauseMs

    this.lastEditAt = time
    this.openGroup = group.key

    if (joins) return

    this.undoStack.push(snapshot())
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack = []
  }

  // The next edit starts a new undo step.
  breakGroup(): void {
    this.openGroup = null
  }

  // The state to go back to, given the current one; null if there is none.
  undo(current: S): S | null {
    const previous = this.undoStack.pop()
    if (previous === undefined) return null
    this.redoStack.push(current)
    this.breakGroup()
    return previous
  }

  redo(current: S): S | null {
    const next = this.redoStack.pop()
    if (next === undefined) return null
    this.undoStack.push(current)
    this.breakGroup()
    return next
  }
}
