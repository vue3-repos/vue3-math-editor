import { describe, expect, it } from 'vitest'

import { latexToRow, rowToLatexSource } from '../src/editor/clipboard'
import { describeCursor } from '../src/editor/cursor'
import { contentMathML } from '../src/editor/exports'
import { nameRuns } from '../src/editor/identifiers'
import { type Row, row, symbol } from '../src/editor/layout'
import { importContentMathML } from '../src/editor/mathmlImport'
import { nameAtoms, settleNames } from '../src/editor/names'
import { parseRow } from '../src/editor/parse'
import { rowToLatex } from '../src/renderers/layoutLatex'
import { json, press, show, type } from './editorHelpers'

// The row's atoms as written: a Greek letter or constant atom by its value in
// brackets, typed characters as they are.
const atoms = (root: Row) =>
  root
    .map((atom) =>
      atom.kind === 'symbol' ? (atom.value.length > 1 ? `[${atom.value}]` : atom.value) : '?',
    )
    .join('')
const names = (root: Row) => nameRuns(root).map((run) => run.name)

describe('names with Greek letters', () => {
  it('a Greek letter is a word of a name, joined by _ or followed by digits', () => {
    expect(names([symbol('alpha'), ...row('_m')])).toEqual(['alpha_m'])
    expect(names([...row('m_'), symbol('alpha')])).toEqual(['m_alpha'])
    expect(names([symbol('tau'), ...row('2')])).toEqual(['tau2'])
    // Straight next to a letter it is a name of its own: αx is α·x.
    expect(names([symbol('alpha'), ...row('x')])).toEqual(['alpha', 'x'])
    expect(json({ root: [symbol('alpha'), ...row('x')], cursor: { path: [], offset: 0 } })).toEqual(
      ['Multiply', 'alpha', 'x'],
    )
  })

  it('a typed Greek word becomes the letter once the cursor leaves the name', () => {
    const typing = type('alpha_m')
    expect(atoms(typing.root)).toBe('alpha_m') // still being typed
    const done = press(typing, '+1')
    expect(atoms(done.root)).toBe('[alpha]_m+1')
    expect(show(done)).toBe('alpha_m+1‸')
    expect(json(done)).toEqual(['Add', 'alpha_m', 1])
  })

  it('the caret steps over the letter as one', () => {
    const state = type('tau_m=1')
    const stops: string[] = []
    let at = state
    for (let i = 0; i < 5; i++) {
      at = press(at, 'ArrowLeft')
      stops.push(describeCursor(at.cursor))
    }
    expect(stops).toEqual(['root @ 4', 'root @ 3', 'root @ 2', 'root @ 1', 'root @ 0'])
    expect(atoms(at.root)).toBe('[tau]_m=1')
  })

  it('only whole words, and digits after them, are Greek', () => {
    const settled = (keys: string) => atoms(press(type(keys), '+').root).slice(0, -1)
    expect(settled('alphabet')).toBe('alphabet')
    expect(settled('alpha2')).toBe('[alpha]2')
    expect(settled('beta_eta')).toBe('[beta]_[eta]')
    expect(settled('Delta_t')).toBe('[Delta]_t')
    expect(settled('V_alpha_2')).toBe('V_[alpha]_2')
    expect(settled('Alpha_x')).toBe('Alpha_x') // no such letter
  })

  it('with Greek names off, names stay as typed, and Greek letters are spelled out', () => {
    const typed = type('alpha_m+1').root
    const off = settleNames(
      { root: row('alpha_m+1'), cursor: { path: [], offset: 9 } },
      { greekNames: false },
    )
    expect(atoms(off.root)).toBe('alpha_m+1')
    expect(rowToLatex(typed, { greekNames: false })).toContain('\\mathit{alpha}')
    expect(rowToLatex(typed, { greekNames: false })).not.toContain('\\alpha')
    expect(rowToLatex(typed)).toContain('\\alpha')
    // Both spellings are the same variable.
    expect(contentMathML(typed)).toContain('<ci>alpha_m</ci>')
    expect(contentMathML(row('alpha_m'))).toContain('<ci>alpha_m</ci>')
  })

  it('a line left is settled, the name at the cursor too', () => {
    const state = type('y=alpha')
    expect(atoms(state.root)).toBe('y=alpha')
    const left = settleNames(state, { cursorAway: true })
    expect(atoms(left.root)).toBe('y=[alpha]')
    expect(left.cursor).toEqual({ path: [], offset: 3 })
  })

  it('copies as LaTeX the way it is shown, and pastes back as the same name', () => {
    const root = press(type('alpha_m*tau'), '+').root.slice(0, -1)
    expect(rowToLatexSource(root)).toBe('\\alpha \\_m\\cdot \\tau')
    expect(rowToLatexSource(root, { greekNames: false })).toBe(
      '\\mathit{alpha\\_m}\\cdot \\mathit{tau}',
    )
    expect(names(latexToRow('\\alpha \\_m'))).toEqual(['alpha_m'])
  })

  it('Backspace after a Greek letter deletes it', () => {
    expect(show(press(type('alpha_m+'), 'Backspace', 'ArrowLeft', 'ArrowLeft', 'Backspace'))).toBe(
      '‸_m',
    )
  })
})

describe('reserved names', () => {
  it('a constant’s MathML name typed out is the constant', () => {
    expect(json(type('pi'))).toBe('Pi')
    const done = press(type('2*pi'), '*r')
    expect(atoms(done.root)).toBe('2·[pi]·r')
    expect(json(done)).toEqual(['Multiply', 2, 'Pi', 'r'])
    expect(atoms(press(type('infinity'), '+').root)).toBe('[infinity]+')
    expect(json(type('true'))).toBe('True')
  })

  it('e, and names containing a reserved name, are variables', () => {
    expect(json(type('e'))).toBe('e')
    expect(json(type('pi_m'))).toBe('pi_m')
    expect(json(type('pix'))).toBe('pix')
    expect(atoms(press(type('pi_m'), '+').root)).toBe('pi_m+')
  })

  it('nameAtoms writes names in their settled form', () => {
    expect(atoms(nameAtoms('alpha_m'))).toBe('[alpha]_m')
    expect(atoms(nameAtoms('pi'))).toBe('[pi]')
    expect(atoms(nameAtoms('alpha_m', { greekNames: false }))).toBe('alpha_m')
    expect(parseRow(nameAtoms('tau2')).ast).toEqual({ type: 'Identifier', name: 'tau2' })
  })

  it('Content MathML import writes names settled, and warns of reserved ones', () => {
    const result = importContentMathML(
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>alpha_m</ci><ci>pi</ci></apply></math>',
    )!
    expect(atoms(result.equations[0])).toBe('[alpha]_m=[pi]')
    expect(result.problems).toEqual([
      'The variable pi has a reserved name, so it reads as the constant here',
    ])
  })
})
