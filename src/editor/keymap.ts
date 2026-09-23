// Which editing command a key press runs. Navigation keys (arrows,
// Home/End) are handled by MathField directly; undo/redo, Enter (new line)
// and "\" command mode by the workbench.

import {
  type Command,
  absBar,
  closeParen,
  deleteBackward,
  deleteForward,
  exitStructure,
  insertFraction,
  insertSuperscript,
  insertSymbol,
  nextPlaceholder,
  openParen,
} from './commands'

export interface KeyLike {
  key: string
  shiftKey?: boolean
}

const SYMBOL_KEYS = /^[A-Za-z0-9_.+\-=,]$/

export function commandForKey(event: KeyLike): Command | null {
  const { key } = event

  if (SYMBOL_KEYS.test(key)) return insertSymbol(key)

  switch (key) {
    case '*':
      return insertSymbol('·')
    case '/':
      return insertFraction
    case '^':
      return insertSuperscript
    case '(':
      return openParen
    case ')':
      return closeParen
    case '|':
      return absBar
    case ' ':
      return exitStructure
    case 'Backspace':
      return deleteBackward
    case 'Delete':
      return deleteForward
    case 'Tab':
      return nextPlaceholder(event.shiftKey ? 'backward' : 'forward')
    default:
      return null
  }
}
