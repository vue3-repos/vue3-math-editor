import { describe, expect, it } from 'vitest'

import { latexToRow } from '../src/editor/clipboard'
import { CELLML_NAMESPACE, contentMathML, exportRow, formatXml } from '../src/editor/exports'
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

describe('Content MathML in CellML mode', () => {
  const cellml = { cellml: true }

  it('declares the CellML namespace and gives every number dimensionless units by default', () => {
    expect(contentMathML(latexToRow('y=2x+1'), cellml)).toBe(
      [
        '<math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">',
        '  <apply>',
        '    <eq/>',
        '    <ci>y</ci>',
        '    <apply>',
        '      <plus/>',
        '      <apply>',
        '        <times/>',
        '        <cn cellml:units="dimensionless">2</cn>',
        '        <ci>x</ci>',
        '      </apply>',
        '      <cn cellml:units="dimensionless">1</cn>',
        '    </apply>',
        '  </apply>',
        '</math>',
      ].join('\n'),
    )
  })

  it('reaches numbers at any depth', () => {
    const mathml = contentMathML(latexToRow('\\sqrt[3]{x}+\\log(x,2)+\\frac{1}{2}'), cellml)
    expect(mathml.match(/<cn cellml:units="dimensionless">/g)).toHaveLength(4)
    expect(mathml).not.toMatch(/<cn>/)
  })

  it('is well-formed XML with the units in the CellML namespace', () => {
    const doc = new DOMParser().parseFromString(
      contentMathML(latexToRow('x=3.5'), cellml),
      'application/xml',
    )
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    const cn = doc.getElementsByTagName('cn')[0]
    expect(cn.getAttributeNS(CELLML_NAMESPACE, 'units')).toBe('dimensionless')
    expect(cn.textContent).toBe('3.5')
  })

  it('is off by default, and only changes Content MathML', () => {
    const row = latexToRow('x=2')
    expect(contentMathML(row)).not.toContain('cellml')
    expect(exportRow(row, 'mathml', cellml)).toBe(contentMathML(row, cellml))
    expect(exportRow(row, 'mathjson', cellml)).toBe(exportRow(row, 'mathjson'))
    expect(exportRow(row, 'latex', cellml)).toBe(exportRow(row, 'latex'))
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
