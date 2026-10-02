import { describe, expect, it } from 'vitest'

import type { Row } from '../src/editor/layout'
import { wordEquationsFromHtml } from '../src/editor/ommlReader'
import { LINEAR_FORMAT_MESSAGE, readPastedData } from '../src/editor/pasteFormats'
import {
  type PasteChoices,
  type PresentationPaste,
  type PresentationReading,
  readPresentation,
} from '../src/editor/presentationImport'
import {
  looksLikePresentationMathML,
  presentationMathMLEquations,
} from '../src/editor/presentationMathmlReader'
import { looksLikeContentMathML } from '../src/editor/mathmlImport'
import { CLIPBOARD_MIME, serializeAtoms } from '../src/editor/clipboard'
import { row } from '../src/editor/layout'
import { show } from './editorHelpers'
import {
  GLUT2,
  acc,
  bar,
  d,
  eqArr,
  f,
  func,
  nary,
  nor,
  r,
  rad,
  sSub,
  sSubSup,
  sSup,
  word,
  wordHtml,
  wordMathML,
  wordResource,
} from './wordFixtures'

const shown = (root: Row) =>
  show({ root, cursor: { path: [], offset: root.length } }).replace('‸', '')

// The paste from Word's HTML, as MathField would get it.
function wordPaste(html: string): PresentationPaste {
  const pasted = readPastedData({ html, text: 'plain text Word puts beside it' })
  if (pasted.kind !== 'presentation') throw new Error(`Read as ${pasted.kind}`)
  return pasted.paste
}

const read = (html: string, choices?: PasteChoices) => readPresentation(wordPaste(html), choices)
// The equations read, shown compactly.
const lines = (reading: PresentationReading) => reading.equations.map(shown)
const only = (omath: string, choices?: PasteChoices) => {
  const reading = read(word(omath), choices)
  expect(reading.equations).toHaveLength(1)
  return shown(reading.equations[0])
}
const kinds = (reading: PresentationReading) => reading.assumptions.map((a) => a.kind)
// [Glc] with a subscript.
const glc = (sub: string) => sSub(d(r('Glc'), '[', ']'), r(sub))
// Every assumption given the other option.
const otherwise = (reading: PresentationReading): PasteChoices =>
  new Map(reading.assumptions.map((a) => [a.id, a.options[1].id]))

describe('Word equations (OMML in clipboard HTML)', () => {
  it('finds each equation in Word’s HTML, without the fallback pictures', () => {
    const html = word(r('x=1'), r('y=2'))
    const found = wordEquationsFromHtml(html)!
    expect(found.equations).toHaveLength(2)
    expect(found.textLeftOut).toBe(false)
    expect(found.problems).toEqual([])
    expect(lines(read(html))).toEqual(['x=1', 'y=2'])
  })

  it('reads a whole example as written: dV/dt = −(I_ion − I_stim)/C_m', () => {
    const reading = read(wordResource('membrane.html'))
    expect(lines(reading)).toEqual(['d{V}/d{t}=-[I_ion-I_stim/C_m]', 'I_ion=g_K·n^{4}(V-E_K)'])
    // n⁴ is italic, as Word writes what is typed: a power, most likely, but
    // it could be part of the name.
    expect(kinds(reading)).toEqual(['digit-superscript'])
    expect(reading.assumptions[0].chosen).toBe('power')
    expect(reading.omissions).toEqual([])
    expect(reading.problems).toEqual([])
  })

  it('says when the text around the equations was left out', () => {
    const html = wordHtml(
      '<p class=MsoNormal>The membrane potential obeys<o:p></o:p></p>',
      `<p class=MsoNormal><!--[if gte msEquation 12]><m:oMath>${r('x=1')}</m:oMath><![endif]--><![if !msEquation]><img src="x.png"><![endif]></p>`,
    )
    const reading = read(html)
    expect(lines(reading)).toEqual(['x=1'])
    expect(reading.notes.some((note) => /text around them was left out/.test(note))).toBe(true)
  })

  it('splits an equation array into one equation a line, without its alignment or numbers', () => {
    const html = word(eqArr(`${r('a&amp;=1')}`, `${r('b&amp;=2#')}${d(r('2'))}`))
    expect(lines(read(html))).toEqual(['a=1', 'b=2'])
  })

  it('reads Word’s HTML when it isn’t well-formed XML', () => {
    // An unclosed tag inside the equation.
    const html = word(`${r('x')}<m:r>=<span>1</m:r>`)
    expect(lines(read(html))).toEqual(['x=1'])
  })

  describe('names', () => {
    it('reads letters written together as one name, and says so', () => {
      const reading = read(word(r('Cm=2kx')))
      expect(lines(reading)).toEqual(['Cm=2kx'])
      expect(reading.assumptions).toEqual([])
      expect(reading.notes[0]).toMatch(/one name: Cm, kx/)
    })

    it('reads a name’s subscripts as its parts', () => {
      expect(only(`${sSub(r('I'), r('ion'))}${r('=')}${sSub(r('C'), r('Ca,i'))}`)).toBe(
        'I_ion=C_Ca_i',
      )
      // The base joins the letters before it.
      expect(only(`${r('N')}${sSub(r('a'), r('i'))}`)).toBe('Na_i')
    })

    it('puts a product between a name with parts and a name after it', () => {
      expect(only(`${sSub(r('C'), r('m'))}${r('V')}`)).toBe('C_m·V')
      expect(only(`${sSub(r('x'), r('1'))}${r('2')}`)).toBe('x_1·2')
    })

    it('reads Greek letters as the editor’s', () => {
      expect(only(`${sSub(r('α'), r('m'))}${r('=')}${sSub(r('τ'), r('ϵ'))}${r('+φ')}`)).toBe(
        'alpha_m=tau_epsilon+varphi',
      )
    })

    it('reads ∞ in a subscript as inf', () => {
      const reading = read(word(`${sSub(r('n'), r('∞'))}${r('=1')}`))
      expect(lines(reading)).toEqual(['n_inf=1'])
      expect(reading.notes.some((note) => /∞/.test(note))).toBe(true)
    })

    it('leaves out a subscript that can’t be part of a name, and says so', () => {
      const reading = read(word(`${sSub(r('x'), r('i+1'))}${r('=2')}`))
      expect(lines(reading)).toEqual(['x=2'])
      expect(reading.omissions.map((o) => o.what)).toEqual([
        'a subscript that isn’t part of a name',
      ])
      expect(reading.lineProblems[0][0]).toMatch(/x_\(i\+1\)/)
    })

    it('reads an upright superscript word as part of the name, an italic one as an assumption', () => {
      expect(only(`${sSup(r('g'), r('max', 'p'))}`)).toBe('g__max')
      const reading = read(word(`${sSup(r('g'), r('max'))}${r('=1')}`))
      expect(lines(reading)).toEqual(['g__max=1'])
      expect(kinds(reading)).toEqual(['name-superscript'])
      expect(lines(read(word(`${sSup(r('g'), r('max'))}${r('=1')}`), otherwise(reading)))).toEqual([
        'g^{max}=1',
      ])
      // A single letter is a power.
      expect(only(sSup(r('x'), r('n')))).toBe('x^{n}')
    })

    it('asks whether a name with a subscript, as a superscript, is part of the name', () => {
      const k = (sub: string) => sSup(sSub(r('K'), r('c')), sSub(r('Glc'), r(sub)))
      const reading = read(word(k('o')))
      expect(lines(reading)).toEqual(['K_c__Glc__o'])
      expect(kinds(reading)).toEqual(['name-superscript'])
      expect(reading.assumptions[0].options.map((o) => o.label)).toEqual([
        'Part of the name: K_c with the superscript Glc_o (K_c__Glc__o)',
        'A power: K_c to the power Glc_o',
      ])
      expect(lines(read(word(k('o')), otherwise(reading)))).toEqual(['K_c^{Glc_o}'])

      // K_c^{Glc_o}/K_c^{Glc_i} = 1: asked of each, the same whatever is chosen.
      const html = word(`${f(k('o'), k('i'))}${r('=1')}`)
      const both = read(html)
      expect(lines(both)).toEqual(['[K_c__Glc__o/K_c__Glc__i]=1'])
      expect(kinds(both)).toEqual(['name-superscript', 'name-superscript'])
      const powers = read(html, otherwise(both))
      expect(powers.assumptions.map((a) => a.id)).toEqual(both.assumptions.map((a) => a.id))

      // Upright: part of the name, without asking.
      const upright = read(word(sSup(sSub(r('K'), r('c')), sSub(r('Glc', 'p'), r('o', 'p')))))
      expect(lines(upright)).toEqual(['K_c__Glc__o'])
      expect(upright.assumptions).toEqual([])
    })

    it('asks whether digits on a name are a power or part of it', () => {
      const html = word(sSubSup(r('x'), r('i'), r('2')))
      const reading = read(html)
      expect(lines(reading)).toEqual(['x_i^{2}'])
      expect(kinds(reading)).toEqual(['digit-superscript'])
      expect(reading.assumptions[0].question).toBe('A power, or part of the name?')
      expect(reading.assumptions[0].options.map((o) => o.label)).toEqual([
        'A power: x_i to the power 2',
        'Part of the name: x_i with the superscript 2 (x_i__2)',
      ])
      expect(lines(read(html, otherwise(reading)))).toEqual(['x_i__2'])
    })

    it('reads a superscript 1 as part of the name, unless chosen otherwise', () => {
      const one = word(sSubSup(r('κ'), r('m'), r('1')))
      const reading = read(one)
      expect(lines(reading)).toEqual(['kappa_m__1'])
      expect(reading.assumptions.map((a) => [a.kind, a.chosen])).toEqual([
        ['digit-superscript', 'name'],
      ])
      expect(reading.assumptions[0].options[0].label).toBe(
        'Part of the name: κ_m with the superscript 1 (kappa_m__1)',
      )
      expect(lines(read(one, otherwise(reading)))).toEqual(['kappa_m^{1}'])
      // 2 is a power, until chosen otherwise.
      const two = word(sSubSup(r('κ'), r('m'), r('2')))
      expect(lines(read(two))).toEqual(['kappa_m^{2}'])
      expect(lines(read(two, otherwise(read(two))))).toEqual(['kappa_m__2'])
    })

    it('reads digits marked upright as part of the name, without asking', () => {
      const reading = read(
        word(`${sSup(r('x'), r('1', 'p'))}${r('=')}${sSup(r('y'), r('12', 'p'))}`),
      )
      expect(lines(reading)).toEqual(['x__1=y__12'])
      expect(reading.assumptions).toEqual([])
      // Two parts, with a comma between them (x__1__2).
      expect(only(sSup(r('x'), r('1,2', 'p')))).toBe('x__1__2')
    })

    it('asks about digits on a name in brackets or with scripts, whatever else is chosen', () => {
      // [Glc]², and g^{max} squared: the question about the 2 is asked
      // whether g^{max} is a name or a power.
      expect(kinds(read(word(sSup(d(r('Glc'), '[', ']'), r('2')))))).toEqual(['digit-superscript'])
      const html = word(sSup(sSup(r('g'), r('max')), r('2')))
      const first = read(html)
      expect(kinds(first)).toEqual(['name-superscript', 'digit-superscript'])
      const second = read(html, otherwise(first))
      expect(second.assumptions.map((a) => a.id)).toEqual(first.assumptions.map((a) => a.id))
      // A power of a power, whatever is chosen for the 2.
      expect(lines(second)).toEqual(['g^{max}^{2}'])
      // Brackets round more than a name: a power, not asked.
      expect(read(word(sSup(d(r('x+y')), r('2')))).assumptions).toEqual([])
      // The same for a Unicode superscript ² after it.
      const unicode = word(`${sSup(r('g'), r('max'))}${r('²=1')}`)
      const named = read(unicode)
      expect(kinds(named)).toEqual(['name-superscript', 'digit-superscript'])
      const powered = read(unicode, otherwise(named))
      expect(powered.assumptions.map((a) => a.id)).toEqual(named.assumptions.map((a) => a.id))
      expect(lines(powered)).toEqual(['g^{max}^{2}=1'])
    })
  })

  describe('derivatives', () => {
    it('reads ⅆ (Word’s \\dd) and an upright d as certain', () => {
      expect(only(`${f(r('ⅆV'), r('ⅆt'))}${r('=1')}`)).toBe('d{V}/d{t}=1')
      expect(only(`${f(`${r('d', 'p')}${r('V')}`, `${r('d', 'p')}${r('t')}`)}`)).toBe('d{V}/d{t}')
      expect(read(word(f(r('ⅆV'), r('ⅆt')))).assumptions).toEqual([])
    })

    it('asks about a fraction of italic d’s', () => {
      const html = word(`${f(r('dV'), r('dt'))}${r('=1')}`)
      const reading = read(html)
      expect(lines(reading)).toEqual(['d{V}/d{t}=1'])
      expect(kinds(reading)).toEqual(['derivative'])
      expect(reading.assumptions[0].options.map((o) => o.id)).toEqual(['derivative', 'fraction'])
      expect(reading.assumptions[0].atomIds).toHaveLength(3)
      expect(lines(read(html, otherwise(reading)))).toEqual(['[dV/dt]=1'])
    })

    it('reads d/dt before brackets as the derivative of what’s in them', () => {
      const html = word(`${f(r('d'), r('dt'))}${d(r('x+y'))}`)
      const reading = read(html)
      expect(lines(reading)).toEqual(['d{x+y}/d{t}'])
      expect(lines(read(html, otherwise(reading)))).toEqual(['[d/dt](x+y)'])
    })

    it('reads ∂ as an ordinary derivative, and says so', () => {
      const reading = read(word(f(r('∂u'), r('∂x'))))
      expect(lines(reading)).toEqual(['d{u}/d{x}'])
      expect(reading.notes.some((note) => /partial/.test(note))).toBe(true)
    })

    it('keeps a second-order derivative as a fraction, and says so', () => {
      const reading = read(
        word(f(`${sSup(r('ⅆ'), r('2'))}${r('x')}`, `${r('ⅆ')}${sSup(r('t'), r('2'))}`)),
      )
      expect(lines(reading)).toEqual(['[d^{2}x/dt^{2}]'])
      expect(reading.omissions.map((o) => o.what)).toEqual(['a second-order derivative'])
      expect(reading.omissions[0].message).toBe(
        "A second-order derivative ((ⅆ^2x)/(ⅆt^2)) isn't supported: it was kept as a fraction.",
      )
      // Its superscripts are powers, not asked about.
      expect(reading.assumptions).toEqual([])
    })

    it('names the order of a higher-order derivative, in any form', () => {
      const third = read(
        word(f(`${sSup(r('ⅆ'), r('3'))}${r('V')}`, `${r('ⅆ')}${sSup(r('t'), r('3'))}`)),
      )
      expect(lines(third)).toEqual(['[d^{3}V/dt^{3}]'])
      expect(third.omissions.map((o) => o.what)).toEqual(['a third-order derivative'])
      expect(third.assumptions).toEqual([])

      const fourth = read(word(f(`${sSup(r('ⅆ'), r('4'))}${r('V')}`, sSup(r('ⅆt'), r('4')))))
      expect(fourth.omissions.map((o) => o.what)).toEqual(['an order-4 derivative'])
      expect(fourth.assumptions).toEqual([])

      // The operator form, d²/dt² (x): the fraction, times what follows.
      const operator = read(
        word(
          `${f(sSup(r('d', 'p'), r('2')), `${r('d', 'p')}${sSup(r('t'), r('2'))}`)}${d(r('x'))}`,
        ),
      )
      expect(lines(operator)).toEqual(['[d^{2}/dt^{2}](x)'])
      expect(operator.omissions.map((o) => o.what)).toEqual(['a second-order derivative'])
      expect(operator.omissions[0].written).toMatch(/\(x\)$/)
      expect(operator.assumptions).toEqual([])

      // Unicode superscript digits.
      const unicode = read(word(f(r('ⅆ²x'), r('ⅆt²'))))
      expect(lines(unicode)).toEqual(['[d^{2}x/dt^{2}]'])
      expect(unicode.omissions.map((o) => o.what)).toEqual(['a second-order derivative'])
      expect(unicode.assumptions).toEqual([])
    })

    it('says a fraction of italic d’s only looks like a higher-order derivative', () => {
      const reading = read(
        word(f(`${sSup(r('d'), r('2'))}${r('x')}`, `${r('d')}${sSup(r('t'), r('2'))}`)),
      )
      expect(lines(reading)).toEqual(['[d^{2}x/dt^{2}]'])
      expect(reading.assumptions).toEqual([])
      expect(reading.omissions[0].message).toMatch(
        /^\(d\^2x\)\/\(dt\^2\) looks like a second-order derivative, which isn't supported: it was kept as a fraction\.$/,
      )
    })

    it('reads orders that differ as an ordinary fraction, asking about its digits', () => {
      const reading = read(word(f(`${sSup(r('ⅆ'), r('2'))}${r('x')}`, r('ⅆt'))))
      expect(lines(reading)).toEqual(['[d^{2}x/dt]'])
      expect(reading.omissions).toEqual([])
      expect(kinds(reading)).toEqual(['digit-superscript'])
      // d²x/dt³ too.
      const mismatched = read(
        word(f(`${sSup(r('ⅆ'), r('2'))}${r('x')}`, `${r('ⅆ')}${sSup(r('t'), r('3'))}`)),
      )
      expect(mismatched.omissions).toEqual([])
      expect(kinds(mismatched)).toEqual(['digit-superscript', 'digit-superscript'])
    })

    it('leaves a fraction that isn’t a derivative as it is', () => {
      expect(only(f(r('d'), r('2')))).toBe('[d/2]')
      expect(only(f(r('a+b'), r('c')))).toBe('[a+b/c]')
    })
  })

  describe('numbers, constants and functions', () => {
    it('reads ×10 to a power as scientific notation', () => {
      expect(only(`${r('k=1.5×')}${sSup(r('10'), r('−3'))}`)).toBe('k=1.5e-3')
      // On its own, a power of ten.
      expect(only(`${r('k=')}${sSup(r('10'), r('3'))}`)).toBe('k=10^{3}')
    })

    it('asks about 1.5e−3 written as a run', () => {
      const html = word(r('k=1.5e−3'))
      const reading = read(html)
      expect(lines(reading)).toEqual(['k=1.5e-3'])
      expect(kinds(reading)).toEqual(['e-notation'])
      expect(lines(read(html, otherwise(reading)))).toEqual(['k=1.5·e-3'])
    })

    it('asks whether an italic e to a power is Euler’s number', () => {
      const html = word(`${r('y=A')}${sSup(r('e'), r('−kt'))}`)
      const reading = read(html)
      expect(lines(reading)).toEqual(['y=Aexponentiale^{-kt}'])
      expect(kinds(reading)).toEqual(['exponential'])
      expect(lines(read(html, otherwise(reading)))).toEqual(['y=A·e^{-kt}'])
      // Upright, it is.
      expect(only(sSup(r('e', 'p'), r('x')))).toBe('exponentiale^{x}')
    })

    it('asks about digits on an italic e, whatever is chosen for e', () => {
      const html = word(sSup(r('e'), r('2')))
      const reading = read(html)
      expect(kinds(reading)).toEqual(['exponential', 'digit-superscript'])
      expect(lines(reading)).toEqual(['exponentiale^{2}'])
      const [exponential, digits] = reading.assumptions.map((a) => a.id)
      const variable = (digit: string) =>
        read(
          html,
          new Map([
            [exponential, 'variable'],
            [digits, digit],
          ]),
        )
      expect(kinds(variable('power'))).toEqual(['exponential', 'digit-superscript'])
      expect(lines(variable('power'))).toEqual(['e^{2}'])
      expect(lines(variable('name'))).toEqual(['e__2'])
      // Euler's number keeps its power, whatever the answer.
      expect(lines(read(html, new Map([[digits, 'name']])))).toEqual(['exponentiale^{2}'])
    })

    it('reads π, ∞ and the minus sign', () => {
      expect(only(r('y=2πr−∞'))).toBe('y=2pir-infinity')
    })

    it('reads functions, their powers and log’s base', () => {
      expect(only(`${r('y=')}${func(r('sin', 'p'), r('x'))}`)).toBe('y=sin(x)')
      expect(only(func(sSup(r('sin', 'p'), r('2')), r('2x')))).toBe('sin^{2}(2x)')
      expect(only(func(sSub(r('log', 'p'), r('b')), r('x')))).toBe('log(x,b)')
      expect(only(func(r('exp', 'p'), d(r('−t'))))).toBe('exp(-t)')
      expect(only(func(r('floor', 'p'), d(r('x'))))).toBe('⌊x⌋')
    })

    it('reads sin⁻¹ as arcsin', () => {
      const reading = read(word(func(sSup(r('sin', 'p'), r('−1')), r('x'))))
      expect(lines(reading)).toEqual(['arcsin(x)'])
      expect(reading.notes.some((note) => /arcsin/.test(note))).toBe(true)
    })

    it('says a function of the user’s own isn’t supported', () => {
      const reading = read(word(func(r('f'), d(r('x')))))
      expect(lines(reading)).toEqual(['f(x)'])
      expect(reading.omissions.map((o) => o.what)).toEqual(['the function f'])
    })

    it('reads brackets, absolute values and roots', () => {
      expect(only(`${d(r('a+b'))}${r('c')}`)).toBe('(a+b)c')
      expect(only(d(r('x'), '|', '|'))).toBe('|x|')
      // Square brackets round one name are its concentration (below);
      // round anything else, brackets.
      expect(only(d(r('x+y'), '[', ']'))).toBe('(x+y)')
      expect(only(`${rad(r('x'))}${r('+')}${rad(r('y'), r('3'))}`)).toBe('√{x}+√[3]{y}')
    })

    it('says a number’s units are to be added, and reads a units word as a variable', () => {
      const reading = read(word(`${r('V=−85')}${r('mV', 'p')}`))
      expect(lines(reading)).toEqual(['V=-85mV'])
      expect(reading.notes.some((note) => note.startsWith('mV after a number'))).toBe(true)
      expect(reading.notes.some((note) => /without units/.test(note))).toBe(true)
      // In the same run as the number, too.
      const together = read(word(r('t=5 ms', 'p')))
      expect(together.notes.some((note) => note.startsWith('ms after a number'))).toBe(true)
    })
  })

  describe('piecewise', () => {
    it('reads a brace round an equation array as cases', () => {
      const cases = d(
        eqArr(`${r('5,')}${nor(' if ')}${r('t&lt;1')}`, `${r('0,')}${nor(' otherwise')}`),
        '{',
        '',
      )
      expect(only(`${r('y=')}${cases}`)).toBe('y={5 : t<1; 0}')
    })
  })

  describe('what can’t be written', () => {
    it('leaves a sum out as an empty slot, and says so for its line', () => {
      const reading = read(word(`${r('y=')}${nary('∑', r('i=1'), r('n'), sSub(r('x'), r('i')))}`))
      expect(lines(reading)).toEqual(['y=()'])
      expect(reading.omissions).toHaveLength(1)
      const [omission] = reading.omissions
      expect(omission.what).toBe('a sum')
      expect(omission.written).toBe('∑_(i=1)^(n) x_i')
      expect(omission.atomIds).toHaveLength(1)
      expect(reading.lineProblems).toEqual([
        ["A sum (∑_(i=1)^(n) x_i) isn't supported: it was left out, as an empty slot."],
      ])
      expect(reading.problems).toEqual(reading.lineProblems[0])
    })

    it('says so for an integral, an accent and prime notation', () => {
      const integral = read(word(nary('∫', r('0'), r('1'), r('x'))))
      expect(integral.omissions.map((o) => o.what)).toEqual(['an integral'])
      const dot = read(word(`${acc(r('V'))}${r('=1')}`))
      expect(lines(dot)).toEqual(['()=1'])
      expect(dot.omissions.map((o) => o.what)).toEqual(['a dot accent'])
      expect(dot.omissions[0].written).toBe('V\u0307')
      const prime = read(word(r('V′=1')))
      expect(lines(prime)).toEqual(['V=1'])
      expect(prime.omissions.map((o) => o.what)).toEqual(['prime notation'])
    })

    it('keeps a symbol it doesn’t know, and says so', () => {
      const reading = read(word(r('a±b')))
      expect(lines(reading)).toEqual(['a±b'])
      expect(reading.omissions.map((o) => o.what)).toEqual(['the symbol ±'])
    })
  })

  describe('accents, brackets and charges, as parts of names', () => {
    const notes = (reading: PresentationReading) => reading.notes.join('\n')

    it('reads an accent over a name as part of it, with its scripts', () => {
      const reading = read(word(`${sSub(acc(r('q'), '̅'), r('i'))}${r('=1')}`))
      expect(lines(reading)).toEqual(['q_bar_i=1'])
      expect(reading.assumptions).toEqual([])
      expect(reading.omissions).toEqual([])
      expect(notes(reading)).toMatch(/Accents were read as parts of names: q̅_i as q_bar_i\./)
      // Each accent, in its combining or spacing form, and Word's default hat.
      expect(only(acc(r('x'), '̃'))).toBe('x_tilde')
      expect(only(acc(r('x'), 'ˇ'))).toBe('x_check')
      expect(only(acc(r('x'), '¯'))).toBe('x_bar')
      expect(only(acc(r('x'), null))).toBe('x_hat')
      expect(only(acc(r('Glc'), '̅'))).toBe('Glc_bar')
    })

    it('reads κ̂_m^GLUT2 with an upright GLUT2 without asking', () => {
      const reading = read(word(sSubSup(acc(r('κ'), null), r('m'), r('GLUT2', 'p'))))
      expect(lines(reading)).toEqual(['kappa_hat_m__GLUT2'])
      expect(reading.assumptions).toEqual([])
      expect(reading.omissions).toEqual([])
      expect(notes(reading)).toMatch(/κ̂_m\^\(GLUT2\) as kappa_hat_m__GLUT2/)
    })

    it('reads a bar over a name as an accent, and one under it as left out', () => {
      expect(only(bar(r('x'), 'top'))).toBe('x_bar')
      const under = read(word(`${bar(r('x'))}${r('=1')}`))
      expect(lines(under)).toEqual(['()=1'])
      expect(under.omissions.map((o) => o.what)).toEqual(['an underbar'])
      expect(read(word(bar(r('x'), 'bot'))).omissions.map((o) => o.what)).toEqual(['an underbar'])
    })

    it('leaves out an accent over anything but a name, with what was said about it', () => {
      const sum = read(word(`${acc(r('x+y'), '̅')}${r('=1')}`))
      expect(lines(sum)).toEqual(['()=1'])
      expect(sum.omissions.map((o) => o.what)).toEqual(['an accent'])
      expect(sum.lineProblems[0][0]).toMatch(/^An accent \(\(x\+y\)̅\) isn't supported/)

      // What was asked or noted about the part left out goes with it.
      const asked = read(word(acc(`${r('x+')}${sSup(r('g'), r('max'))}`, '̅')))
      expect(asked.assumptions).toEqual([])
      expect(asked.omissions.map((o) => o.what)).toEqual(['an accent'])
      const noted = read(word(acc(`${r('5')}${r('mV', 'p')}`, '̅')))
      expect(noted.notes.some((note) => /mV after a number/.test(note))).toBe(false)
    })

    it('reads square brackets round one name as its concentration', () => {
      const reading = read(
        word(`${sSub(d(r('Glc'), '[', ']'), r('i'))}${r('=')}${d(r('x'), '[', ']')}`),
      )
      expect(lines(reading)).toEqual(['Glc_conc_i=x_conc'])
      expect(notes(reading)).toMatch(
        /Square brackets round one name were read as its concentration, part of the name: \[Glc\]_i as Glc_conc_i; \[x\] as x_conc\./,
      )
      // Brackets written as text, too.
      expect(only(`${r('[Glc]')}${r('+1')}`)).toBe('Glc_conc+1')
      // A name after a decorated one is multiplied by it.
      expect(only(`${d(r('Glc'), '[', ']')}${r('x')}`)).toBe('Glc_conc·x')
    })

    it('reads a charge as part of the name', () => {
      const reading = read(word(`${sSup(r('Ca'), r('2+'))}${r('+')}${sSup(r('Cl'), r('−'))}`))
      expect(lines(reading)).toEqual(['Ca_2plus+Cl_minus'])
      expect(reading.assumptions).toEqual([])
      expect(notes(reading)).toMatch(
        /Charges were read as parts of names: Ca\^\(2\+\) as Ca_2plus; Cl\^− as Cl_minus\./,
      )
      expect(only(sSubSup(r('Ca'), r('i'), r('2+')))).toBe('Ca_2plus_i')
      expect(only(sSup(r('Na'), r('+')))).toBe('Na_plus')
      expect(only(sSup(r('Na'), r('1+')))).toBe('Na_plus')
      expect(only(sSub(d(sSup(r('Ca'), r('2+')), '[', ']'), r('i')))).toBe('Ca_2plus_conc_i')
      // A sign before digits is a power.
      expect(only(sSup(r('x'), r('−1')))).toBe('x^{-1}')
      // The charge goes before the subscript, so a keyword there stays a
      // part (as the editor writes x_plus_bar).
      for (const [sub, sup, name] of [
        ['bar', '+', 'x_plus_bar'],
        ['minus', '+', 'x_plus_minus'],
        ['plus', '+', 'x_plus_plus'],
        ['minus', '2+', 'x_2plus_minus'],
      ]) {
        const charged = read(word(sSubSup(r('x'), r(sub), r(sup))))
        expect(lines(charged)).toEqual([name])
        expect(charged.omissions).toEqual([])
        expect(notes(charged)).not.toMatch(/drawn decorated/)
      }
    })

    it('leaves out a charge a name can’t have', () => {
      for (const charge of ['0+', '+2']) {
        const reading = read(word(`${sSup(r('Ca'), r(charge))}${r('=1')}`))
        expect(lines(reading)).toEqual(['Ca=1'])
        expect(reading.omissions.map((o) => o.what)).toEqual(['a charge'])
      }
    })

    it('says when a subscript is a keyword, and is drawn as a decoration', () => {
      const reading = read(word(sSub(r('x'), r('bar'))))
      expect(lines(reading)).toEqual(['x_bar'])
      expect(notes(reading)).toMatch(
        /x_\(bar\) was read as the name x_bar, which is drawn decorated/,
      )
      // Not when it is a part like any other.
      expect(notes(read(word(sSub(r('g'), r('Na,bar')))))).not.toMatch(/drawn decorated/)
    })
  })

  describe('full stops', () => {
    it('reads one between two factors as multiplication, and says so', () => {
      const reading = read(word(r('y=x.5+1.2.3')))
      expect(lines(reading)).toEqual(['y=x·5+1.2·3'])
      expect(reading.notes.join('\n')).toMatch(
        /A full stop between two factors was read as multiplication: x\.5 as x·5; 1\.2\.3 as 1\.2·3\./,
      )
      expect(only(r('x.y'))).toBe('x·y')
      expect(only(r('2.x'))).toBe('2·x')
      expect(only(r('3 . 2'))).toBe('3·2')
      expect(only(r('1. 5'))).toBe('1·5')
      expect(only(`${glc('i')}${r('.')}${glc('o')}`)).toBe('Glc_conc_i·Glc_conc_o')
      expect(only(`${sSup(r('x'), r('2'))}${r('.y')}`)).toBe('x^{2}·y')
      // A function's argument stops at it, but takes a decimal point.
      expect(only(`${r('sin', 'p')}${r('x.y')}`)).toBe('sin(x)·y')
      expect(only(`${r('sin', 'p')}${r('1.5')}`)).toBe('sin(1.5)')
      // A long structure next to it isn't quoted whole.
      const long = read(word(`${r('y=x.')}${f(r('a+b+c+d'), r('1+e+f+g+h'))}`))
      expect(long.notes.join('\n')).toMatch(/multiplication: x\.… as x·…\./)
    })

    it('keeps decimal points, and leaves out a full stop at the end', () => {
      for (const number of ['1.5', '.5', 'x+.5', 'y=(.5)']) {
        expect(only(r(number))).toBe(number)
      }
      expect(only(sSup(r('x'), r('2.5')))).toBe('x^{2.5}')
      expect(only(r('y=x.'))).toBe('y=x')
      expect(only(r('y=x.+1'))).toBe('y=x+1')
      const reading = read(word(r('k=1.5')))
      expect(reading.notes.join('\n')).not.toMatch(/full stop/)
      // 1.e−3 is still a number in scientific notation.
      expect(kinds(read(word(r('k=1.e−3'))))).toEqual(['e-notation'])
    })
  })

  it('reads GLUT2 transport as written, asking only about superscripts', () => {
    const reading = read(word(...GLUT2))
    expect(lines(reading)).toEqual([
      'v_m__GLUT2=kappa_hat_m__GLUT2·[Glc_conc_i-Q_GLUT2__eq·Glc_conc_o/1+[Glc_conc_i/k_i__GLUT2]+[Glc_conc_o/k_o__GLUT2]+[Glc_conc_i·Glc_conc_o/k_io__GLUT2]]',
      '[q_bar_i__Glc/1+[q_bar_i/kappa_m__1]+[q_bar_o/kappa_m^{2}]]',
    ])
    expect(new Set(kinds(reading))).toEqual(new Set(['name-superscript', 'digit-superscript']))
    expect(kinds(reading).filter((kind) => kind === 'digit-superscript')).toHaveLength(2)
    expect(reading.omissions).toEqual([])
    expect(reading.problems).toEqual([])
    const notes = reading.notes.join('\n')
    expect(notes).toMatch(
      /Accents were read as parts of names: κ̂_m\^\(GLUT2\) as kappa_hat_m__GLUT2; q̅_i\^\(Glc\) as q_bar_i__Glc; q̅_i as q_bar_i; q̅_o as q_bar_o\./,
    )
    expect(notes).toMatch(/\[Glc\]_i as Glc_conc_i; \[Glc\]_o as Glc_conc_o\./)
    expect(notes).toMatch(/full stop between two factors/)
  })

  it('gives each assumption the same id whatever is chosen', () => {
    const html = word(
      `${f(r('d'), r('dt'))}${d(`${sSup(r('e'), r('x'))}${r('+')}${sSup(r('g'), r('max'))}${r('+')}${sSup(r('n'), r('4'))}${r('+')}${r('y²')}`)}`,
    )
    const first = read(html)
    expect(kinds(first)).toEqual([
      'derivative',
      'exponential',
      'name-superscript',
      'digit-superscript',
      'digit-superscript',
    ])
    const second = read(html, otherwise(first))
    expect(second.assumptions.map((a) => a.id).sort()).toEqual(
      first.assumptions.map((a) => a.id).sort(),
    )
    expect(second.assumptions.every((a) => a.chosen === a.options[1].id)).toBe(true)
  })
})

describe('Presentation MathML', () => {
  const sample = wordMathML(
    '<mml:mfrac><mml:mrow><mml:mi>d</mml:mi><mml:mi>V</mml:mi></mml:mrow><mml:mrow><mml:mi>d</mml:mi><mml:mi>t</mml:mi></mml:mrow></mml:mfrac><mml:mo>=</mml:mo><mml:mo>-</mml:mo><mml:mfrac><mml:mrow><mml:msub><mml:mrow><mml:mi>I</mml:mi></mml:mrow><mml:mrow><mml:mi>i</mml:mi><mml:mi>o</mml:mi><mml:mi>n</mml:mi></mml:mrow></mml:msub></mml:mrow><mml:mrow><mml:msub><mml:mrow><mml:mi>C</mml:mi></mml:mrow><mml:mrow><mml:mi>m</mml:mi></mml:mrow></mml:msub></mml:mrow></mml:mfrac>',
  )

  it('is told apart from Content MathML', () => {
    expect(looksLikePresentationMathML(sample)).toBe(true)
    expect(
      looksLikePresentationMathML('<math><apply><plus/><ci>x</ci><cn>1</cn></apply></math>'),
    ).toBe(false)
    expect(looksLikePresentationMathML('x+1')).toBe(false)
    // Today's Content MathML check also matches it, which is why it is checked first.
    expect(looksLikeContentMathML(sample)).toBe(true)
  })

  it('reads Word’s MathML, letter by letter, as the same names', () => {
    const pasted = readPastedData({ text: sample })
    expect(pasted.kind).toBe('presentation')
    if (pasted.kind !== 'presentation') return
    const reading = readPresentation(pasted.paste)
    expect(lines(reading)).toEqual(['d{V}/d{t}=-[I_ion/C_m]'])
    expect(kinds(reading)).toEqual(['derivative'])
  })

  it('reads fences, functions and entities', () => {
    const equations = presentationMathMLEquations(
      '<math><mi>sin</mi><mo>&ApplyFunction;</mo><mfenced><mrow><mi>x</mi><mo>&minus;</mo><mn>1</mn></mrow></mfenced><mo>&InvisibleTimes;</mo><mi>y</mi></math>',
    )!
    expect(
      lines(readPresentation({ source: 'mathml', equations, textLeftOut: false, problems: [] })),
    ).toEqual(['sin(x-1)·y'])
  })

  const readMathML = (body: string) => {
    const equations = presentationMathMLEquations(`<math>${body}</math>`)!
    return readPresentation({ source: 'mathml', equations, textLeftOut: false, problems: [] })
  }

  it('reads an accent over a name as part of it', () => {
    expect(looksLikePresentationMathML('<math><mover><mi>x</mi><mo>^</mo></mover></math>')).toBe(
      true,
    )
    for (const mark of ['¯', '&#x305;', '&#x304;']) {
      const reading = readMathML(
        `<mover accent="true"><mi>q</mi><mo>${mark}</mo></mover><mo>=</mo><mn>1</mn>`,
      )
      expect(lines(reading)).toEqual(['q_bar=1'])
      expect(reading.omissions).toEqual([])
    }
    expect(lines(readMathML('<msub><mover><mi>κ</mi><mo>^</mo></mover><mi>m</mi></msub>'))).toEqual(
      ['kappa_hat_m'],
    )
    // Dots, and a bar under, are left out.
    expect(readMathML('<mover><mi>V</mi><mo>˙</mo></mover>').omissions.map((o) => o.what)).toEqual([
      'a dot accent',
    ])
    expect(
      readMathML('<munder><mi>x</mi><mo>_</mo></munder>').omissions.map((o) => o.what),
    ).toEqual(['an underbar'])
    // A sum's limits stay a sum.
    expect(
      readMathML('<munderover><mo>∑</mo><mi>i</mi><mi>n</mi></munderover>').omissions.map(
        (o) => o.what,
      ),
    ).toEqual(['a sum'])
  })

  it('reads square brackets round one name as its concentration', () => {
    expect(
      lines(
        readMathML('<msub><mfenced open="[" close="]"><mi>Glc</mi></mfenced><mi>i</mi></msub>'),
      ),
    ).toEqual(['Glc_conc_i'])
    expect(
      lines(readMathML('<msub><mrow><mo>[</mo><mi>Glc</mi><mo>]</mo></mrow><mi>i</mi></msub>')),
    ).toEqual(['Glc_conc_i'])
  })

  it('reads a name with a subscript, as a superscript, as part of the name', () => {
    expect(
      lines(
        readMathML(
          '<msup><msub><mi>K</mi><mi>c</mi></msub><msub><mi>Glc</mi><mi>o</mi></msub></msup>',
        ),
      ),
    ).toEqual(['K_c__Glc__o'])
  })

  it('reads full stops and decimal points by their tokens', () => {
    expect(lines(readMathML('<mi>x</mi><mo>.</mo><mi>y</mi>'))).toEqual(['x·y'])
    expect(lines(readMathML('<mi>y</mi><mo>=</mo><mi>x</mi><mo>.</mo>'))).toEqual(['y=x'])
    expect(lines(readMathML('<mn>1.5</mn><mo>+</mo><mn>.5</mn>'))).toEqual(['1.5+.5'])
  })

  it('reads digits marked upright as part of a name, and asks about others', () => {
    const upright = readMathML('<msup><mi>x</mi><mi mathvariant="normal">1</mi></msup>')
    expect(lines(upright)).toEqual(['x__1'])
    expect(upright.assumptions).toEqual([])
    // <mn>1</mn>, and <mi>12</mi> (upright only by MathML's default).
    const number = readMathML('<msup><mi>x</mi><mn>1</mn></msup>')
    expect(kinds(number)).toEqual(['digit-superscript'])
    expect(lines(number)).toEqual(['x__1'])
    const identifier = readMathML('<msup><mi>x</mi><mi>12</mi></msup>')
    expect(kinds(identifier)).toEqual(['digit-superscript'])
    expect(lines(identifier)).toEqual(['x^{12}'])
  })

  it('reads a one-column table as one equation a row', () => {
    const equations = presentationMathMLEquations(
      '<math><mtable><mtr><mtd><mi>x</mi><mo>=</mo><mn>1</mn></mtd></mtr><mtr><mtd><mi>y</mi><mo>=</mo><mn>2</mn></mtd></mtr></mtable></math>',
    )!
    expect(equations).toHaveLength(2)
  })
})

describe('readPastedData', () => {
  const html = word(r('x=1'))

  it('prefers the editor’s own format', () => {
    const own = serializeAtoms(row('a+b'))
    const pasted = readPastedData({ own, html, text: 'x' })
    expect(pasted.kind).toBe('atoms')
    expect(pasted.kind === 'atoms' && shown(pasted.atoms)).toBe('a+b')
    expect(CLIPBOARD_MIME).toBeTruthy()
  })

  it('reads Word’s HTML before its text', () => {
    const pasted = readPastedData({ html, text: wordMathML('<mml:mi>z</mml:mi>') })
    expect(pasted.kind === 'presentation' && pasted.paste.source).toBe('word')
  })

  it('ignores HTML without Word’s equations', () => {
    const pasted = readPastedData({ html: '<p>x+1</p>', text: 'x+1' })
    expect(pasted.kind === 'atoms' && shown(pasted.atoms)).toBe('x+1')
  })

  it('reads Presentation MathML before Content MathML', () => {
    expect(readPastedData({ text: wordMathML('<mml:mi>z</mml:mi>') }).kind).toBe('presentation')
    expect(readPastedData({ text: '<apply><plus/><ci>x</ci><cn>1</cn></apply>' }).kind).toBe(
      'content-mathml',
    )
  })

  it('says how to copy MathML from Word when it gets Word’s linear format', () => {
    expect(readPastedData({ text: '(ⅆ𝑉)/(ⅆ𝑡)=−(𝐼_ion−𝐼_stim)/𝐶_𝑚' })).toEqual({
      kind: 'unreadable',
      message: LINEAR_FORMAT_MESSAGE,
    })
  })

  it('reads anything else as LaTeX or typed maths', () => {
    const pasted = readPastedData({ text: '\\frac{1}{2}' })
    expect(pasted.kind === 'atoms' && shown(pasted.atoms)).toBe('[1/2]')
  })
})
