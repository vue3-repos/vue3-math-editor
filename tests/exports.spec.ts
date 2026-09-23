import { describe, expect, it } from 'vitest'

import { latexToRow } from '../src/editor/clipboard'
import { contentMathML, exportRow, formatXml } from '../src/editor/exports'
import { selectedAtoms } from '../src/editor/selection'
import { press, type } from './editorHelpers'

describe('formatXml', () => {
  it('indents nested elements and keeps text elements on one line', () => {
    expect(formatXml('<a>\n  <b/>   <c> x </c><d><e>1</e></d>\n</a>')).toBe(
      ['<a>', '  <b/>', '  <c>x</c>', '  <d>', '    <e>1</e>', '  </d>', '</a>'].join('\n'),
    )
  })

  it('is idempotent', () => {
    const once = contentMathML(latexToRow('y=\\sqrt[3]{x}+\\log(x,2)'))
    expect(formatXml(once)).toBe(once)
  })
})

describe('Content MathML', () => {
  it('is a complete, indented <math> document', () => {
    expect(contentMathML(latexToRow('x+1'))).toBe(
      [
        '<math xmlns="http://www.w3.org/1998/Math/MathML">',
        '  <apply>',
        '    <plus/>',
        '    <ci>x</ci>',
        '    <cn>1</cn>',
        '  </apply>',
        '</math>',
      ].join('\n'),
    )
  })

  it('keeps nested qualifiers such as degree and logbase', () => {
    const mathml = contentMathML(latexToRow('\\sqrt[3]{x}+\\log(x,2)'))
    expect(mathml).toContain('<degree>\n        <cn>3</cn>\n      </degree>')
    expect(mathml).toContain('<logbase>\n        <cn>2</cn>\n      </logbase>')
  })
})

describe('exportRow', () => {
  const equation = () => latexToRow('y=\\frac{1}{x}+1')

  it('LaTeX matches what copy puts on the clipboard', () => {
    expect(exportRow(equation(), 'latex')).toBe('y=\\frac{1}{x}+1')
  })

  it('MathJSON is the indented JSON of the parsed equation', () => {
    const text = exportRow(equation(), 'mathjson')
    expect(JSON.parse(text)).toEqual(['Equal', 'y', ['Add', ['Divide', 1, 'x'], 1]])
    expect(text).toContain('\n  ')
  })

  it('MathML is the Content MathML document', () => {
    expect(exportRow(equation(), 'mathml')).toBe(contentMathML(equation()))
  })

  it('exports a selection on its own', () => {
    const state = press(type('y=a+b'), 'Shift+ArrowLeft', 'Shift+ArrowLeft', 'Shift+ArrowLeft')
    const atoms = selectedAtoms(state)
    expect(JSON.parse(exportRow(atoms, 'mathjson'))).toEqual(['Add', 'a', 'b'])
    expect(exportRow(atoms, 'latex')).toBe('a+b')
    expect(exportRow(atoms, 'mathml')).toContain('<plus/>')
  })

  it('fills an incomplete selection with placeholders', () => {
    const state = press(type('a+b'), 'Shift+ArrowLeft', 'Shift+ArrowLeft')
    expect(JSON.parse(exportRow(selectedAtoms(state), 'mathjson'))).toEqual([
      'Add',
      ['Missing'],
      'b',
    ])
  })
})
