// Shared helpers for the editing unit tests: press keys against the pure
// editor functions, and show the result as compact text.

import { expect } from 'vitest'

import { type EditorState, emptyState } from '../src/editor/commands'
import { isValidCursor } from '../src/editor/cursor'
import { commandForKey } from '../src/editor/keymap'
import { type Row, type RowPath, childRows, rowPathsEqual } from '../src/editor/layout'
import { parseRow } from '../src/editor/parse'
import {
  collapseSelection,
  extendSelection,
  extendSelectionTo,
  navigateHorizontal,
  selectAll,
  selectionOf,
} from '../src/editor/selection'
import { getFunctionDefinition } from '../src/registry/nodes'
import { astToMathJson } from '../src/renderers/mathjson'

// Navigation keys, handled by MathField in the app.
const NAVIGATION: Record<string, (state: EditorState) => EditorState> = {
  ArrowLeft: (s) => navigateHorizontal(s, 'backward') ?? s,
  ArrowRight: (s) => navigateHorizontal(s, 'forward') ?? s,
  'Shift+ArrowLeft': (s) => extendSelection(s, 'backward'),
  'Shift+ArrowRight': (s) => extendSelection(s, 'forward'),
  'Shift+Home': (s) => extendSelectionTo(s, 'start'),
  'Shift+End': (s) => extendSelectionTo(s, 'end'),
  SelectAll: (s) => selectAll(s),
  Escape: (s) => collapseSelection(s),
}

// Press keys. Each argument is either a named key ("Backspace", "Tab",
// "Shift+Tab", "ArrowLeft", "Shift+ArrowRight", "SelectAll", …) or text typed
// one character at a time.
export function press(state: EditorState, ...parts: string[]): EditorState {
  for (const part of parts) {
    const named = part.length > 1 && /^(Shift\+)?[A-Z][a-z]+([A-Z][a-z]+)?$/.test(part)
    const keys = named ? [part] : Array.from(part)

    for (const key of keys) {
      if (NAVIGATION[key]) {
        state = NAVIGATION[key](state)
      } else {
        const shiftKey = key.startsWith('Shift+')
        const command = commandForKey({ key: shiftKey ? key.slice(6) : key, shiftKey })
        if (!command) throw new Error(`No command for key "${key}"`)
        state = command(state)
      }

      expect(isValidCursor(state.root, state.cursor), `cursor valid after "${key}"`).toBe(true)
      if (state.anchor) {
        expect(isValidCursor(state.root, state.anchor), `anchor valid after "${key}"`).toBe(true)
      }
    }
  }

  return state
}

export function type(...parts: string[]): EditorState {
  return press(emptyState(), ...parts)
}

// A compact text form of the tree:
//   fraction [num/den], superscript ^{…}, brackets (…) and |…|,
//   roots √{…} and √[index]{…}, derivative d{…}/d{…}, functions by name,
//   piecewise {value0 : cond0; …; otherwise}.
// The caret is shown as ‸; a selection as «…» (and then no caret).
export function show(state: EditorState): string {
  const selection = selectionOf(state)

  const render = (r: Row, path: RowPath): string => {
    const here = rowPathsEqual(path, state.cursor.path)
    const selected = selection && rowPathsEqual(path, selection.path)
    let out = ''

    for (let i = 0; i <= r.length; i++) {
      if (selected && i === selection.end) out += '»'
      if (!selection && here && i === state.cursor.offset) out += '‸'
      if (selected && i === selection.start) out += '«'
      if (i === r.length) break

      const atom = r[i]
      const child = (branch: string) =>
        render(childRows(atom).find(([name]) => name === branch)![1], [
          ...path,
          { atom: i, branch: branch as RowPath[number]['branch'] },
        ])

      switch (atom.kind) {
        case 'symbol':
          out += atom.value
          break
        case 'function':
          out += getFunctionDefinition(atom.name)?.latexName ?? atom.name
          break
        case 'fraction':
          out += `[${child('num')}/${child('den')}]`
          break
        case 'superscript':
          out += `^{${child('sup')}}`
          break
        case 'group':
          out += `${atom.open}${child('body')}${atom.close}`
          break
        case 'root':
          out += atom.index ? `√[${child('index')}]{${child('body')}}` : `√{${child('body')}}`
          break
        case 'derivative':
          out += `d{${child('expr')}}/d{${child('variable')}}`
          break
        case 'units':
          out += `{${child('units')}}`
          break
        case 'piecewise': {
          // {value0 : cond0; value1 : cond1; otherwise}
          const pieces = atom.pieces.map((_, i) => `${child(`value${i}`)} : ${child(`cond${i}`)}`)
          if (atom.otherwise) pieces.push(child('otherwise'))
          out += `{${pieces.join('; ')}}`
          break
        }
      }
    }

    return out
  }

  return render(state.root, [])
}

export function json(state: EditorState): unknown {
  return astToMathJson(parseRow(state.root).ast)
}
