// What maths written in a layout format means: Word's equations and
// Presentation MathML (read into the neutral tree, mathTree.ts), as the
// editor's layout rows, the ones the user would have typed.
//
// Most of it follows from fixed rules:
// - Letters written together are one name, as in the editor (Cm is one
//   variable, not C × m), however they were split into runs or <mi>s; a
//   note says so. A name's subscripts, and upright superscripts, are parts of
//   it: C_{Ca,i} is C_Ca_i, g^{max} (upright) is g__max, and so are digits
//   marked upright where they were written (κ_m^1, as the editor writes
//   kappa_m__1).
// - A decorated name is spelled with keyword parts (nameScripts.ts), and a
//   note lists each one read: a bar, hat, tilde or check over a name is
//   q̄ = q_bar; square brackets round one name its concentration, [Glc] =
//   Glc_conc; a charge as its superscript Ca²⁺ = Ca_2plus. [Glc]_i and
//   q̄_i^Glc take their scripts as parts, as any name does.
// - A full stop between two factors is multiplication (x.y, 1.2.3 as
//   1.2·3, said in a note); in a number it is a decimal point, and at the end
//   a full stop, left out.
// - Upright words that spell a function are the function; upright e is
//   Euler's number; ⅆ (Word's differential d) and an upright d make a
//   fraction such as ⅆV/ⅆt a derivative; 1.5×10^{−3} is the number 1.5e-3.
// - Greek letters are the editor's Greek letters, π the constant pi.
//
// Where it could reasonably mean two things, the reading is an *assumption*:
// it takes the likelier meaning, and the user can choose the other (the
// paste review, PasteReviewDialog.vue), by re-reading with their choices.
// An assumption's id is the same whatever is chosen, as it comes from where
// it is in the tree, and whether one is asked depends only on the tree. The
// assumptions:
// - a fraction with italic d's, dV/dt: a derivative, or a fraction;
// - an italic e raised to a power: Euler's number, or a variable e;
// - an italic word as a name's superscript, g^{max}: part of the name, or
//   a power; the same for a name with a subscript, K_c^{Glc_o}, whose
//   subscript is then one more superscript part (K_c__Glc__o);
// - digits as a name's superscript, n^4 or κ_m^1: a power (but 1 is part of
//   the name), or part of the name. Word writes every digit typed italic, so
//   this is asked of each one;
// - 1.5e−3 written as one run: the number, or 1.5·e − 3.
//
// What the editor can't write (sums, integrals, other accents, matrices,
// prime notation, a charge a name can't have, a higher-order derivative, a
// function it doesn't know) is an *omission*: left out, as an empty slot
// where it was, or kept in the form the editor can write (d²x/dt² as the
// fraction it looks like, its superscripts as powers, not asked about), and
// always said, for its line.
//
// Units aren't read: a number pasted has none, and a note says to add them.

import { constantForUprightText } from './constants'
import { continuesName, functionForSpelling, isOneName, nameRuns, numberRuns } from './identifiers'
import {
  type Atom,
  type GroupDelimiter,
  type Row,
  childRows,
  derivative,
  fraction,
  func,
  group,
  piecewise,
  root,
  row,
  superscript,
  symbol,
} from './layout'
import { type MathNode, type TextStyle, linearText, treeLatex } from './mathTree'
import type { MathMLImport } from './mathmlImport'
import { accentForMark, chargeFromText, chargeWord, nameScripts } from './nameScripts'
import { withNameKeyword } from './names'
import {
  DIFFERENTIAL_D,
  FUNCTION_APPLICATION,
  PARTIAL,
  constantSymbol,
  greekCharacter,
  greekName,
  isPrime,
  isSpace,
  operatorSymbol,
  plainCharacter,
  superscriptDigit,
} from './unicodeMath'
import { FUNCTION_REGISTRY, bracketsForFunction, getFunctionDefinition } from '../registry/nodes'

export interface PresentationPaste {
  // Where it came from: Word's clipboard HTML, or Presentation MathML text.
  source: 'word' | 'mathml'
  equations: MathNode[][]
  // Text outside the equations was left out.
  textLeftOut: boolean
  // What couldn't be read at all.
  problems: string[]
}

// The user's choice for each assumption, by id: an option's id.
export type PasteChoices = ReadonlyMap<string, string>

export type AssumptionKind =
  | 'derivative'
  | 'exponential'
  | 'name-superscript'
  | 'e-notation'
  | 'digit-superscript'

export interface PasteOption {
  id: string
  label: string
}

export interface PasteAssumption {
  id: string
  // The equation it's in.
  line: number
  kind: AssumptionKind
  question: string
  // The part of the equation, as written: LaTeX to draw it, and as text.
  latex: string
  written: string
  // The default first.
  options: readonly PasteOption[]
  chosen: string
  // The atoms it became, in this reading's equations[line].
  atomIds: string[]
}

export interface PasteOmission {
  // The equation it's in; -1 for one that couldn't be read at all.
  line: number
  what: string
  written: string
  // What happened to it, as its line's problem says.
  message: string
  atomIds: string[]
}

export interface PresentationReading extends MathMLImport {
  assumptions: PasteAssumption[]
  omissions: PasteOmission[]
  // Information about how it was read, once each.
  notes: string[]
}

export function readPresentation(
  paste: PresentationPaste,
  choices: PasteChoices = new Map(),
): PresentationReading {
  const assumptions: PasteAssumption[] = []
  const omissions: PasteOmission[] = paste.problems.map((message) => ({
    line: -1,
    what: 'an equation',
    written: '',
    message,
    atomIds: [],
  }))
  const notes = new Set<string>()
  const joined = new Set<string>()
  const periods: string[] = []
  const decorated: Record<Decoration, Set<string>> = {
    accent: new Set(),
    conc: new Set(),
    charge: new Set(),
  }
  let numbers = false

  const equations = paste.equations.filter(hasContent).map((nodes, line) => {
    const reader = new Reader(line, choices, assumptions, omissions, notes, periods)
    const equation = reader.equation(nodes)
    for (const name of reader.joinedNames(equation)) joined.add(name)
    for (const { kind, text } of reader.decoratedNames(equation)) decorated[kind].add(text)
    numbers ||= hasNumber(equation)
    return equation
  })

  const lineProblems = equations.map((_, line) =>
    unique(omissions.filter((o) => o.line === line).map((o) => o.message)),
  )

  const allNotes: string[] = []
  if (joined.size > 0) {
    allNotes.push(
      `Letters written together are read as one name: ${listed(joined, ', ')}. For a product, put · between them (type *).`,
    )
  }
  if (decorated.accent.size > 0) {
    allNotes.push(
      `Accents were read as parts of names: ${listed(decorated.accent)}. A bar, hat, tilde or check is stored as a part straight after the name’s first word.`,
    )
  }
  if (decorated.conc.size > 0) {
    allNotes.push(
      `Square brackets round one name were read as its concentration, part of the name: ${listed(decorated.conc)}. For brackets that only group, use round ones.`,
    )
  }
  if (decorated.charge.size > 0) {
    allNotes.push(`Charges were read as parts of names: ${listed(decorated.charge)}.`)
  }
  if (periods.length > 0) {
    allNotes.push(
      `A full stop between two factors was read as multiplication: ${listed(new Set(periods))}. A full stop is a decimal point only within a number (1.5, .5).`,
    )
  }
  allNotes.push(...notes)
  if (numbers) {
    allNotes.push(
      'Numbers come without units: add each number’s units after pasting (type { after it, as in 0.25{mV}).',
    )
  }
  if (paste.textLeftOut)
    allNotes.push('Only the equations were pasted; the text around them was left out.')

  return {
    equations,
    problems: unique(omissions.map((o) => o.message)),
    lineProblems,
    assumptions,
    omissions,
    notes: allNotes,
  }
}

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)]

// Up to 6 instances, for a note.
const listed = (values: ReadonlySet<string>, separator = '; ') => {
  const all = [...values]
  return all.slice(0, 6).join(separator) + (all.length > 6 ? `${separator}…` : '')
}

const hasContent = (nodes: readonly MathNode[]) =>
  nodes.some((node) => node.kind !== 'text' || /[^\s &#]/.test(node.text))

// Every row of an equation, at any depth.
function* allRows(root: Row): Generator<Row> {
  yield root
  for (const atom of root) for (const [, child] of childRows(atom)) yield* allRows(child)
}

const hasNumber = (equation: Row) => [...allRows(equation)].some((r) => numberRuns(r).length > 0)

// Every atom's id, at any depth.
function atomIds(atoms: Row): string[] {
  return atoms.flatMap((atom) => [
    atom.id,
    ...childRows(atom).flatMap(([, child]) => atomIds(child)),
  ])
}

// ---------------------------------------------------------------------------
// Items: a row's nodes with their text split into characters, and brackets
// written as characters matched, so that what spans runs (a name in two runs,
// brackets in separate <mo>s) reads as one.
// ---------------------------------------------------------------------------

interface CharItem {
  kind: 'char'
  char: string
  style: TextStyle
  token?: string
  // The whole text it is part of, without spaces.
  text: string
  path: string
}

// An upright word that is a function's name or a constant (NaN, true, false).
interface WordItem {
  kind: 'word'
  role: 'function' | 'constant'
  value: string
  text: string
  path: string
}

interface NodeItem {
  kind: 'node'
  node: Exclude<MathNode, { kind: 'text' }>
  path: string
}

interface BracketItem {
  kind: 'bracket'
  open: string
  // '' if it was never closed.
  close: string
  items: Item[]
  path: string
}

type Item = CharItem | WordItem | NodeItem | BracketItem

const PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '⌊': '⌋',
  '⌈': '⌉',
  '⟨': '⟩',
  '|': '|',
}
const CLOSERS = new Set(Object.values(PAIRS))

function flatten(nodes: readonly MathNode[], path: string): Item[] {
  return nodes.flatMap((node, index): Item[] => {
    const here = `${path}.${index}`
    if (node.kind !== 'text') return [{ kind: 'node', node, path: here }]

    const compact = Array.from(node.text)
      .filter((c) => !isSpace(c))
      .join('')
    if (node.style === 'upright' && node.token !== 'mtext' && /^[A-Za-z]{2,}$/.test(compact)) {
      const name = functionForSpelling(compact)
      if (name) return [{ kind: 'word', role: 'function', value: name, text: compact, path: here }]
    }
    if (node.style === 'upright' && compact !== 'e') {
      const constant = constantForUprightText(compact)
      if (constant)
        return [{ kind: 'word', role: 'constant', value: constant, text: compact, path: here }]
    }
    return Array.from(node.text, (char, k) => ({
      kind: 'char' as const,
      char,
      style: node.style,
      token: node.token,
      text: compact,
      path: `${here}.${k}`,
    }))
  })
}

function matchBrackets(items: Item[]): Item[] {
  const top: Item[] = []
  const open: Array<{ char: string; path: string; items: Item[] }> = []
  const current = () => (open.length ? open[open.length - 1].items : top)
  const close = (char: string) => {
    const frame = open.pop()!
    current().push({
      kind: 'bracket',
      open: frame.char,
      close: char,
      items: frame.items,
      path: frame.path,
    })
  }

  for (const item of items) {
    if (item.kind === 'char') {
      const char = item.char
      if (char === '|' && open[open.length - 1]?.char === '|') {
        close('|')
        continue
      }
      if (char in PAIRS) {
        open.push({ char, path: item.path, items: [] })
        continue
      }
      if (CLOSERS.has(char)) {
        let at = open.length - 1
        while (at >= 0 && PAIRS[open[at].char] !== char) at--
        if (at >= 0) {
          while (open.length > at + 1) close('')
          close(char)
        }
        // Otherwise a closing bracket with nothing to close: left out.
        continue
      }
    }
    current().push(item)
    // A brace before a table is a piecewise definition's: it has no closing
    // brace, and ends with the table.
    const frame = open[open.length - 1]
    if (
      frame?.char === '{' &&
      frame.items.length === 1 &&
      item.kind === 'node' &&
      item.node.kind === 'table'
    ) {
      close('')
    }
  }

  while (open.length) close('')
  return top
}

// The text of nodes that are only text (without spaces), else null.
function textOf(nodes: readonly MathNode[] | null): string | null {
  if (!nodes || nodes.length === 0) return null
  let out = ''
  for (const node of nodes) {
    if (node.kind !== 'text') return null
    out += Array.from(node.text)
      .filter((c) => !isSpace(c))
      .map((c) => plainCharacter(c).character)
      .join('')
  }
  return out
}

const isUpright = (nodes: readonly MathNode[]) =>
  nodes.every((node) => node.kind === 'text' && node.style === 'upright')

// A character of a name: a letter, digit, underscore or Greek letter.
const isNameCharacter = (char: string) =>
  /^[A-Za-z0-9_]$/.test(char) || (!!greekName(char) && greekName(char) !== 'pi')

// Text that can be a name: starts with a letter, then name characters.
const isNameText = (text: string) => {
  const [first, ...rest] = Array.from(text)
  return (
    !!first &&
    (/^[A-Za-z]$/.test(first) || isNameCharacter(first)) &&
    !/^[0-9_]$/.test(first) &&
    rest.every(isNameCharacter)
  )
}

// Text that can be parts of a name (a subscript, or a superscript), comma
// separated: Ca,i.
const isNameParts = (text: string) =>
  text.split(',').every((part) => part.length > 0 && Array.from(part).every(isNameCharacter))

// A superscript that is a name with a subscript, Glc_o (K_c^{Glc_o}): its
// text as parts, comma separated (Glc,o), else null. A name's scripts can't
// nest, so the subscript is one more superscript part: K_c__Glc__o.
function subscriptedNameText(sup: readonly MathNode[]): string | null {
  const [only] = sup
  if (sup.length !== 1 || only.kind !== 'scripts' || only.sup || !only.sub) return null
  const base = textOf(only.base)
  const sub = textOf(only.sub)
  if (base === null || sub === null || !isNameText(base) || !isNameParts(sub)) return null
  return `${base},${sub}`
}

const hasLetter = (text: string) =>
  Array.from(text).some((c) => /[A-Za-z]/.test(c) || !!greekName(c))

// A name's parts, from their text (isNameParts): letters, digits and the
// editor's Greek letters, with each comma as `count` underscores (1 between
// subscripts, 2 between superscripts). Not read as maths, so that a part
// which spells a function (g^{max}) is still letters.
const nameParts = (text: string, count: number): Row =>
  Array.from(text).flatMap((char) =>
    char === ','
      ? Array.from({ length: count }, () => symbol('_'))
      : [symbol(greekName(char) ?? char)],
  )

// Text marked upright where it was written (mathTree.ts), not by default: a
// superscript the editor wrote as part of a name, <mi mathvariant="normal">1</mi>.
const isExplicitlyUpright = (nodes: readonly MathNode[]) =>
  nodes.length > 0 &&
  nodes.every(
    (node) =>
      node.kind === 'text' && node.explicit && node.style === 'upright' && node.token !== 'mn',
  )

const DIFFERENTIALS = new Set(['d', DIFFERENTIAL_D, PARTIAL])

// Whether a base, as written, can be read as one name, whatever is chosen
// for the assumptions inside it: text that is a name (or a differential), an
// accent over one, a name in square brackets, or one with scripts of its own.
// What is asked about a superscript on it depends on this, not on the atoms it
// became, so the questions don't change as the user chooses.
function canBeName(nodes: readonly MathNode[]): boolean {
  const text = textOf(nodes)
  if (text !== null) {
    const bare = /^\[.*\]$/.test(text) ? text.slice(1, -1) : text
    return isNameText(bare) || DIFFERENTIALS.has(bare)
  }
  const [only] = nodes
  if (nodes.length !== 1) return false
  switch (only.kind) {
    case 'scripts':
    case 'accent':
      return canBeName(only.base)
    case 'fenced':
      return only.open === '[' && only.close === ']' && only.items.length === 1
        ? canBeName(only.items[0])
        : false
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// Higher-order derivatives: d²x/dt², written with a superscript on each d
// (as scripts, or Unicode superscript digits). The editor writes only
// first-order derivatives, so one is kept as the fraction it looks like, and
// its superscripts are powers, not questions about names.
// ---------------------------------------------------------------------------

type OrderToken =
  | { kind: 'char'; char: string; italic: boolean; path: string }
  | { kind: 'node'; node: MathNode; path: string }

// A row's characters (without spaces) and other nodes, with their paths as
// the reader gives them (flatten).
function orderTokens(nodes: readonly MathNode[], path: string): OrderToken[] {
  return nodes.flatMap((node, index): OrderToken[] => {
    const here = `${path}.${index}`
    if (node.kind !== 'text') return [{ kind: 'node', node, path: here }]
    return Array.from(node.text).flatMap((char, k): OrderToken[] => {
      if (isSpace(char)) return []
      const plain = plainCharacter(char)
      const italic = plain.italic ?? node.style === 'italic'
      return [{ kind: 'char', char: plain.character, italic, path: `${here}.${k}` }]
    })
  })
}

interface Order {
  order: number
  // Where its superscript is: a scripts node, or each superscript digit.
  paths: string[]
  // An italic d, which may be a variable.
  italic: boolean
}

const differentialItalic = (char: string, italic: boolean) => char === 'd' && italic

const charOf = (token: OrderToken | undefined) => (token?.kind === 'char' ? token.char : '')

// Superscript digits at tokens [start, …): the order and its paths.
function superscriptOrder(tokens: readonly OrderToken[], start: number) {
  let digits = ''
  const paths: string[] = []
  for (let k = start; k < tokens.length; k++) {
    const digit = superscriptDigit(charOf(tokens[k]))
    if (digit === undefined) break
    digits += digit
    paths.push(tokens[k].path)
  }
  return { digits, paths }
}

// The digits of a superscript-only scripts node, if that is what it is.
function scriptsDigits(node: MathNode): string | null {
  if (node.kind !== 'scripts' || node.sub || !node.sup) return null
  const digits = textOf(node.sup)
  return digits !== null && /^[0-9]+$/.test(digits) ? digits : null
}

// A numerator that starts with dⁿ: the order, and whether nothing follows
// (the operator form, dⁿ/dtⁿ (…)).
function numeratorOrder(tokens: readonly OrderToken[]): (Order & { operator: boolean }) | null {
  const [first] = tokens
  if (first?.kind === 'char' && DIFFERENTIALS.has(first.char)) {
    const { digits, paths } = superscriptOrder(tokens, 1)
    if (!digits) return null
    const italic = differentialItalic(first.char, first.italic)
    return { order: Number(digits), paths, italic, operator: tokens.length === 1 + paths.length }
  }
  if (first?.kind === 'node' && first.node.kind === 'scripts') {
    const digits = scriptsDigits(first.node)
    const base = orderTokens(first.node.base, '')
    const [d] = base
    if (digits === null || base.length !== 1 || d.kind !== 'char' || !DIFFERENTIALS.has(d.char))
      return null
    const italic = differentialItalic(d.char, d.italic)
    return { order: Number(digits), paths: [first.path], italic, operator: tokens.length === 1 }
  }
  return null
}

// A denominator that is d, then one name, with a superscript n: dtⁿ.
function denominatorOrder(tokens: readonly OrderToken[]): Order | null {
  // dt with the superscript as scripts (ⅆ then t², or dt²), or Unicode
  // superscript digits at the end.
  const last = tokens[tokens.length - 1]
  const lastDigits = last?.kind === 'node' ? scriptsDigits(last.node) : null
  let k = tokens.length
  while (k > 0 && superscriptDigit(charOf(tokens[k - 1])) !== undefined) k--
  const { digits, paths, head } =
    last?.kind === 'node' && last.node.kind === 'scripts' && lastDigits !== null
      ? {
          digits: lastDigits,
          paths: [last.path],
          head: [...tokens.slice(0, -1), ...orderTokens(last.node.base, '')],
        }
      : { ...superscriptOrder(tokens, k), head: tokens.slice(0, k) }
  const [d, ...name] = head
  if (!digits || d?.kind !== 'char' || !DIFFERENTIALS.has(d.char)) return null
  const text = name.map((token) => (token.kind === 'char' ? token.char : '\0')).join('')
  if (!isNameText(text)) return null
  return { order: Number(digits), paths, italic: differentialItalic(d.char, d.italic) }
}

// The order of a fraction that is an order-n derivative, dⁿx/dtⁿ (n ≥ 2, the
// same above and below), or null.
function derivativeOrder(
  node: MathNode & { kind: 'fraction' },
  path: string,
): (Order & { operator: boolean }) | null {
  const top = numeratorOrder(orderTokens(node.num, `${path}.n`))
  const bottom = denominatorOrder(orderTokens(node.den, `${path}.d`))
  if (!top || !bottom || top.order < 2 || top.order !== bottom.order) return null
  return { ...top, paths: [...top.paths, ...bottom.paths], italic: top.italic || bottom.italic }
}

const ORDINALS: Record<number, string> = { 2: 'second', 3: 'third' }

// "a second-order derivative", "an order-4 derivative".
const orderName = (order: number) =>
  ORDINALS[order] ? `a ${ORDINALS[order]}-order derivative` : `an order-${order} derivative`

function itemsText(items: readonly Item[]): string {
  return items
    .map((item) => {
      switch (item.kind) {
        case 'char':
          return item.char
        case 'word':
          return item.text
        case 'node':
          return linearText([item.node])
        case 'bracket':
          return `${item.open}${itemsText(item.items)}${item.close}`
      }
    })
    .join('')
}

// Plain text for a row, for an option's label: dV, I_ion, (x+1).
export function atomsText(atoms: Row): string {
  const wrap = (r: Row) => {
    const text = atomsText(r)
    return r.length > 1 ? `(${text})` : text
  }
  return atoms
    .map((atom) => {
      switch (atom.kind) {
        case 'symbol':
          return (
            greekCharacter(atom.value) ??
            { pi: 'π', exponentiale: 'e', infinity: '∞', notanumber: 'NaN' }[atom.value] ??
            atom.value
          )
        case 'function':
          return getFunctionDefinition(atom.name)?.latexName ?? atom.name
        case 'fraction':
          return `${wrap(atom.num)}/${wrap(atom.den)}`
        case 'superscript':
          return `^${wrap(atom.sup)}`
        case 'group':
          return `${atom.open}${atomsText(atom.body)}${atom.close}`
        case 'root':
          return `√${wrap(atom.body)}`
        case 'derivative':
          return `d${wrap(atom.expr)}/d${wrap(atom.variable)}`
        case 'piecewise':
          return '{…}'
        case 'units':
          return ''
      }
    })
    .join('')
}

// The text node a character came from (its path, without the character's
// place in it).
const textNodeOf = (item: CharItem) => item.path.slice(0, item.path.lastIndexOf('.'))

const isSymbol = (atom: Atom | undefined, value?: string): atom is Atom & { kind: 'symbol' } =>
  atom?.kind === 'symbol' && (value === undefined || atom.value === value)

// The plain number (no exponent) the atoms end with, if they do.
function plainNumberAtEnd(atoms: Row) {
  const runs = numberRuns(atoms)
  const last = runs[runs.length - 1]
  return last && last.end === atoms.length && last.exponent === null ? last : null
}

const bracketBody = (atoms: Row): Row => {
  const only = atoms[0]
  return atoms.length === 1 && only.kind === 'group' && only.open === '(' ? only.body : atoms
}

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const OPERATOR_SYMBOLS = new Set([
  '+',
  '-',
  '=',
  ',',
  '·',
  '×',
  '<',
  '>',
  '≤',
  '≥',
  '≠',
  '∧',
  '∨',
  '⊻',
  '¬',
])
const isOperator = (atom: Atom | undefined) => isSymbol(atom) && OPERATOR_SYMBOLS.has(atom.value)

// a/b written with a slash: the operand before it (back to the operator
// before) over the operand after it (to the next operator), as typing "/"
// makes.
function slashFractions(atoms: Row): Row {
  const out: Row = []
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i]
    if (!isSymbol(atom, '/')) {
      out.push(atom)
      continue
    }
    let start = out.length
    while (start > 0 && !isOperator(out[start - 1])) start--
    const num = out.splice(start)
    let end = i + 1
    while (end < atoms.length && !isOperator(atoms[end]) && !isSymbol(atoms[end], '/')) end++
    out.push(fraction(bracketBody(num), bracketBody(atoms.slice(i + 1, end))))
    i = end - 1
  }
  return out
}

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

type Differential = 'certain' | 'partial' | 'upright' | 'italic'

interface FunctionHead {
  name: string
  sup: Row | null
  // log's base.
  base: Row | null
}

// Adds atoms to a row being read. `scripted`: they end with a name with a
// subscript or superscript part, or a decoration, so a name character after
// them would join that name; a · goes between. `separate`: they don't join a
// name before them either. `joined`: they carry on the name before them (its
// superscript part, from a Unicode superscript digit), with nothing between.
type Push = (atoms: Row, how?: { scripted?: boolean; separate?: boolean; joined?: boolean }) => void

// What withNameKeyword added to a name.
type Decoration = 'accent' | 'conc' | 'charge'

const PARTIAL_NOTE =
  'A partial derivative (∂) was read as an ordinary one: CellML has no partial derivatives.'

class Reader {
  // The letters that were italic, for the note about names.
  private readonly italic = new WeakSet<Atom>()
  // Each d, and how sure it is to be a differential.
  private readonly differentials = new WeakMap<Atom, Differential>()
  // The atoms of each keyword a decoration became (bar, conc, 2plus), and the
  // decorated name as written, for the notes.
  private readonly keywords = new WeakMap<Atom, { kind: Decoration; written: string }>()
  // The paths of the superscripts of higher-order derivatives (d²x/dt²):
  // powers, not asked about.
  private readonly orders = new Set<string>()

  constructor(
    private readonly line: number,
    private readonly choices: PasteChoices,
    private readonly assumptions: PasteAssumption[],
    private readonly omissions: PasteOmission[],
    private readonly notes: Set<string>,
    // Each full stop read as multiplication, as written and as read.
    private readonly periods: string[],
  ) {}

  equation(nodes: readonly MathNode[]): Row {
    return this.row(nodes, `${this.line}`)
  }

  // The names in an equation with two or more letters written together that
  // were italic (as Word writes letters), for the note.
  joinedNames(equation: Row): string[] {
    const names: string[] = []
    for (const r of allRows(equation)) {
      for (const run of nameRuns(r)) {
        if (run.functionName) continue
        let letters = 0
        for (let i = run.start; i < run.end && !isSymbol(r[i], '_'); i++) {
          if (this.italic.has(r[i]) && /^[A-Za-z]$/.test((r[i] as { value: string }).value))
            letters++
        }
        if (letters >= 2) names.push(atomsText(r.slice(run.start, run.end)))
      }
    }
    return names
  }

  // The names in an equation that a decoration was read into, for the
  // notes: q̅_i^(Glc) as q_bar_i__Glc, one for each kind of decoration in it.
  decoratedNames(equation: Row): Array<{ kind: Decoration; text: string }> {
    const found: Array<{ kind: Decoration; text: string }> = []
    for (const r of allRows(equation)) {
      for (const run of nameRuns(r)) {
        const seen = new Set<Decoration>()
        for (const atom of r.slice(run.start, run.end)) {
          const keyword = this.keywords.get(atom)
          if (!keyword || seen.has(keyword.kind)) continue
          seen.add(keyword.kind)
          found.push({ kind: keyword.kind, text: `${keyword.written} as ${run.name}` })
        }
      }
    }
    return found
  }

  // `named` is `atoms` with a keyword added (withNameKeyword): its new atoms
  // are that decoration's, of the name written `written`.
  private decorated(atoms: Row, named: Row, kind: Decoration, written: string) {
    const old = new Set(atoms)
    for (const atom of named) if (!old.has(atom)) this.keywords.set(atom, { kind, written })
    this.wrote(named, written)
  }

  // A decorated name's atoms became part of something larger, written
  // `written` (its scripts, or brackets round it): the notes quote that.
  private wrote(atoms: Row, written: string) {
    for (const atom of atoms) {
      const keyword = this.keywords.get(atom)
      if (keyword) keyword.written = written
    }
  }

  private row(nodes: readonly MathNode[], path: string): Row {
    return this.sequence(matchBrackets(flatten(nodes, path)))
  }

  private sequence(items: Item[]): Row {
    const out: Row = []
    let joins = false
    const push: Push = (atoms, how = {}) => {
      if (atoms.length === 0) return
      const previous = out[out.length - 1]
      if (
        !how.joined &&
        ((joins && continuesName(atoms[0])) ||
          (how.separate && continuesName(previous) && continuesName(atoms[0])))
      ) {
        out.push(symbol('·'))
      }
      out.push(...atoms)
      joins = !!how.scripted
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      switch (item.kind) {
        case 'char':
          i = this.char(items, i, out, push)
          break
        case 'word':
          if (item.role === 'constant') push([symbol(item.value)])
          else i = this.takeFunction(items, i, push, { name: item.value, sup: null, base: null })
          break
        case 'bracket': {
          const { atoms, scripted } = this.bracket(item)
          push(atoms, { separate: true, scripted })
          break
        }
        case 'node':
          i = this.node(item, items, i, out, push)
          break
      }
    }

    return slashFractions(out)
  }

  // ---- Assumptions and omissions -------------------------------------------

  private decide(
    path: string,
    kind: AssumptionKind,
    question: string,
    written: { latex: string; text: string },
    options: PasteOption[],
  ): { chosen: string; became: (atoms: Row) => void } {
    const id = `${path}:${kind}`
    const asked = this.choices.get(id)
    const chosen = options.some((option) => option.id === asked) ? asked! : options[0].id
    const assumption: PasteAssumption = {
      id,
      line: this.line,
      kind,
      question,
      latex: written.latex,
      written: written.text,
      options,
      chosen,
      atomIds: [],
    }
    this.assumptions.push(assumption)
    return { chosen, became: (atoms) => (assumption.atomIds = atomIds(atoms)) }
  }

  private omit(what: string, written: string, message: string, atoms: Row = []) {
    this.omissions.push({ line: this.line, what, written, message, atomIds: atomIds(atoms) })
  }

  // What can't be written, left out: an empty slot where it was.
  private slot(push: Push, what: string, written: string) {
    const empty = group([])
    push([empty], { separate: true })
    this.omit(
      what,
      written,
      `${capitalised(what)} (${written}) isn't supported: it was left out, as an empty slot.`,
      [empty],
    )
  }

  // ---- Characters --------------------------------------------------------

  private char(items: Item[], i: number, out: Row, push: Push): number {
    const item = items[i] as CharItem
    const plain = plainCharacter(item.char)
    const char = plain.character
    const style: TextStyle =
      plain.italic === null ? item.style : plain.italic ? 'italic' : 'upright'

    // Spaces, and the alignment points of an equation array.
    if (isSpace(char) || char === '&') return i
    // An equation number, #(1): left out.
    if (char === '#') {
      const next = items[i + 1]
      const number =
        next?.kind === 'bracket' || (next?.kind === 'node' && next.node.kind === 'fenced')
      return number ? i + 1 : i
    }
    if (char === FUNCTION_APPLICATION) return this.functionApplication(items, i, out, push)

    const sup = superscriptDigit(char)
    if (sup !== undefined) return this.superscriptDigits(items, i, out, push)

    if (isPrime(char)) {
      const runs = nameRuns(out)
      const last = runs[runs.length - 1]
      const name = last && last.end === out.length ? out.slice(last.start) : []
      this.omit(
        'prime notation',
        `${atomsText(name)}${char}`,
        `Prime notation (${atomsText(name)}${char}) isn't supported: the prime was left out. Write a derivative as d(☐)/d(☐) instead.`,
        name,
      )
      return i
    }

    if (char === DIFFERENTIAL_D || char === PARTIAL) {
      const d = symbol('d')
      this.differentials.set(d, char === PARTIAL ? 'partial' : 'certain')
      push([d])
      return i
    }

    if ((char === 'e' || char === 'E') && this.scientific(items, i, out, push, item, style))
      return i
    if (char === 'e' && style === 'upright' && item.text === 'e') {
      push([symbol('exponentiale')])
      return i
    }

    const greek = greekName(char)
    if (greek) {
      push([symbol(greek)])
      return i
    }
    const constant = constantSymbol(char)
    if (constant) {
      push([symbol(constant)])
      return i
    }
    const operator = operatorSymbol(char)
    if (operator) {
      push([symbol(operator)])
      return i
    }
    if (char === '/') {
      push([symbol('/')])
      return i
    }

    if (/^[A-Za-z]$/.test(char)) {
      const letter = symbol(char)
      if (style === 'italic') this.italic.add(letter)
      if (char === 'd') this.differentials.set(letter, style === 'upright' ? 'upright' : 'italic')
      // An upright word straight after a number: its units, most likely.
      if (style === 'upright' && plainNumberAtEnd(out) !== null) {
        let word = ''
        for (let j = i; items[j]?.kind === 'char'; j++) {
          const next = items[j] as CharItem
          if (textNodeOf(next) !== textNodeOf(item) || !/^[A-Za-z]$/.test(next.char)) break
          word += next.char
        }
        this.notes.add(
          `${word} after a number was read as a variable, multiplied by it; if it is the number’s units, delete it and add them as units.`,
        )
      }
      push([letter])
      return i
    }

    if (char === '.') return this.period(items, i, out, push)

    if (/^[0-9_]$/.test(char)) {
      push([symbol(char)])
      return i
    }

    // Anything else: kept, for the editor to mark.
    const unknown = symbol(char)
    push([unknown])
    this.omit(
      `the symbol ${char}`,
      char,
      `The symbol ${char} isn't supported: it was kept, and is marked as a problem.`,
      [unknown],
    )
    return i
  }

  // Unicode superscript digits, x²: after a name, a power or part of it (the
  // digit-superscript assumption); otherwise a power. Whether to ask goes by
  // what was written before them (g^{max}², a base that can be a name), not
  // what it became, so the questions don't change as the user chooses; if it
  // didn't become one name, they are a power whatever the answer.
  private superscriptDigits(items: Item[], i: number, out: Row, push: Push): number {
    const item = items[i] as CharItem
    let digits = ''
    let written = ''
    let j = i
    while (items[j]?.kind === 'char') {
      const char = (items[j] as CharItem).char
      const digit = superscriptDigit(char)
      if (digit === undefined) break
      digits += digit
      written += char
      j++
    }

    const runs = nameRuns(out)
    const last = runs[runs.length - 1]
    const named = !!last && last.end === out.length && !last.functionName
    if (!named || this.orders.has(item.path)) {
      const before = items[i - 1]
      const atoms = [superscript(row(digits))]
      if (
        !this.orders.has(item.path) &&
        before?.kind === 'node' &&
        (before.node.kind === 'scripts' || before.node.kind === 'accent') &&
        canBeName(before.node.base)
      ) {
        const { became } = this.digitSuperscript(
          item.path,
          {
            latex: `${treeLatex([before.node])}^{${digits}}`,
            text: `${itemsText([before])}${written}`,
          },
          out.slice(-1),
          digits,
        )
        became(atoms)
      }
      push(atoms)
      return j - 1
    }

    const name = out.slice(last.start)
    const text = `${atomsText(name)}${written}`
    const { chosen, became } = this.digitSuperscript(
      item.path,
      {
        latex: `${treeLatex([{ kind: 'text', text: atomsText(name), style: 'italic' }])}^{${digits}}`,
        text,
      },
      name,
      digits,
    )
    const atoms =
      chosen === 'name' ? [symbol('_'), symbol('_'), ...row(digits)] : [superscript(row(digits))]
    if (chosen === 'name') push(atoms, { joined: true, scripted: true })
    else push(atoms)
    became([...name, ...atoms])
    return j - 1
  }

  // Digits as a name's superscript, κ_m^1: a power, or part of the name? A
  // power, most likely, but a superscript 1 is seldom a power.
  private digitSuperscript(
    path: string,
    written: { latex: string; text: string },
    name: Row,
    digits: string,
  ) {
    const base = atomsText(name)
    const stored = name.map((atom) => (atom.kind === 'symbol' ? atom.value : '')).join('')
    const power = { id: 'power', label: `A power: ${base} to the power ${digits}` }
    const part = {
      id: 'name',
      label: `Part of the name: ${base} with the superscript ${digits} (${stored}__${digits})`,
    }
    return this.decide(
      path,
      'digit-superscript',
      'A power, or part of the name?',
      written,
      digits === '1' ? [part, power] : [power, part],
    )
  }

  // A full stop: in a number, a decimal point (1.5, .5); at the end, or
  // before an operator, a full stop, left out (y = x.); between two factors,
  // multiplication (x.y, [Glc]_i.[Glc]_o, 1.2.3 as 1.2·3), and said in a
  // note.
  private period(items: Item[], i: number, out: Row, push: Push): number {
    const item = items[i] as CharItem
    const charAt = (j: number) =>
      items[j]?.kind === 'char' ? plainCharacter((items[j] as CharItem).char).character : null
    const spaced = (j: number) => {
      const char = charAt(j)
      return char !== null && isSpace(char)
    }

    if (item.token === 'mn') {
      push([symbol('.')])
      return i
    }

    let next = i + 1
    while (spaced(next)) next++
    const after = charAt(next)
    if (!items[next] || (after !== null && /^[=,;:+\-−·⋅*×/^<>≤≥≠∧∨&#′″'’]$/.test(after))) return i

    const previous = out[out.length - 1]
    const number = plainNumberAtEnd(out)
    const wholeNumber = number !== null && !number.mantissa.includes('.')
    const digitAfter = /^[0-9]$/.test(charAt(i + 1) ?? '')
    const exponentAfter =
      /^[eE]$/.test(charAt(i + 1) ?? '') &&
      (/^[0-9]$/.test(charAt(i + 2) ?? '') ||
        (/^[+\-−]$/.test(charAt(i + 2) ?? '') && /^[0-9]$/.test(charAt(i + 3) ?? '')))
    const decimal =
      item.token !== 'mo' &&
      !spaced(i - 1) &&
      !spaced(i + 1) &&
      ((digitAfter &&
        (out.length === 0 || isOperator(previous) || isSymbol(previous, '/') || wholeNumber)) ||
        (exponentAfter && wholeNumber))
    if (decimal) {
      push([symbol('.')])
      return i
    }
    // Nothing before it to multiply.
    if (out.length === 0) return i

    push([symbol('·')])
    this.periods.push(this.periodText(items, i))
    return i
  }

  // A full stop read as multiplication, with the factors either side of it,
  // as written and as read: "x.5 as x·5".
  private periodText(items: Item[], i: number): string {
    const factor = (item: Item | undefined) =>
      item?.kind === 'char'
        ? /^[A-Za-z0-9.]$/.test(plainCharacter(item.char).character) || !!greekName(item.char)
        : !!item && item.kind !== 'word'
    const space = (item: Item | undefined) => item?.kind === 'char' && isSpace(item.char)
    const reach = (from: number, step: 1 | -1) => {
      let j = from
      while (space(items[j + step])) j += step
      for (let n = 0; n < 6 && factor(items[j + step]); n++) {
        j += step
        if (items[j].kind !== 'char') break
      }
      return j
    }
    // A factor that is a structure (a fraction, brackets) is quoted only if
    // it is short; a longer one is "…", so the note stays readable.
    const quoted = (from: number, to: number) =>
      items
        .slice(from, to)
        .map((item) => {
          const text = itemsText([item])
          return item.kind === 'char' || Array.from(text).length <= 16 ? text : '…'
        })
        .join('')
        .trim()
    const start = reach(i, -1)
    const end = reach(i, 1)
    const before = quoted(start, i)
    const after = quoted(i + 1, end + 1)
    return `${quoted(start, end + 1)} as ${before}·${after}`
  }

  // 1.5e-3, the e of a number in scientific notation: certain in an <mn>,
  // otherwise an assumption (it could be 1.5·e − 3). True if it was.
  private scientific(
    items: Item[],
    i: number,
    out: Row,
    push: Push,
    item: CharItem,
    style: TextStyle,
  ): boolean {
    const number = plainNumberAtEnd(out)
    if (!number) return false
    const charAt = (j: number) => (items[j]?.kind === 'char' ? (items[j] as CharItem).char : '')
    let j = i + 1
    const sign = /^[+\-−]$/.test(charAt(j)) ? charAt(j++) : ''
    if (!/^[0-9]$/.test(charAt(j))) return false
    let digits = ''
    while (/^[0-9]$/.test(charAt(j))) digits += charAt(j++)

    const e = symbol(item.char)
    if (item.token === 'mn') {
      push([e])
      return true
    }

    const text = `${number.mantissa}${item.char}${sign.replace('−', '-')}${digits}`
    const { chosen, became } = this.decide(
      item.path,
      'e-notation',
      'A number in scientific notation?',
      { latex: `\\mathrm{${text}}`, text },
      [
        { id: 'number', label: `The number ${text}` },
        {
          id: 'product',
          label: `${number.mantissa} × ${item.char} ${sign || '+'} ${digits}, with a variable ${item.char}`,
        },
      ],
    )
    if (style === 'italic') this.italic.add(e)
    const atoms = chosen === 'number' ? [e] : [symbol('·'), e]
    push(atoms)
    became([...out.slice(number.start, number.end), ...atoms])
    return true
  }

  // ---- Functions ---------------------------------------------------------

  // Function application (U+2061) after a name: the name is a function's,
  // applied to what follows.
  private functionApplication(items: Item[], i: number, out: Row, push: Push): number {
    const runs = nameRuns(out)
    const last = runs[runs.length - 1]
    if (!last || last.end !== out.length) return i
    const name = out.slice(last.start)

    if (last.functionName) {
      out.splice(last.start)
      return this.takeFunction(items, i, push, { name: last.functionName, sup: null, base: null })
    }

    const end = this.nextFactor(items, i + 1)
    if (end === i + 1) return i
    const argument = this.sequence(items.slice(i + 1, end))
    const brackets = group(bracketBody(argument))
    push([brackets])
    this.userFunction(atomsText(name), `${atomsText(name)}${atomsText([brackets])}`, [
      ...name,
      brackets,
    ])
    return end - 1
  }

  private userFunction(name: string, written: string, atoms: Row) {
    this.omit(
      `the function ${name}`,
      written,
      `The function ${name} (${written}) isn't one the editor knows, and functions of your own aren't supported: ${name} was read as a variable, times the brackets after it.`,
      atoms,
    )
  }

  // Where the next factor starts and ends: brackets, a structure, or a name
  // or number (with any scripts), as a function's argument or what d/dt
  // applies to. `start` if there is none.
  private nextFactor(items: Item[], start: number): number {
    let j = start
    const skippable = (item: Item | undefined) =>
      item?.kind === 'char' && (isSpace(item.char) || item.char === FUNCTION_APPLICATION)
    while (skippable(items[j])) j++
    const item = items[j]
    if (!item) return start
    if (item.kind === 'bracket' || item.kind === 'node') return j + 1
    if (item.kind === 'word')
      return item.role === 'constant' ? j + 1 : Math.max(j + 1, this.nextFactor(items, j + 1))

    const charAt = (k: number) =>
      items[k]?.kind === 'char' ? plainCharacter((items[k] as CharItem).char).character : ''
    // A full stop only as a decimal point, with a digit after it (and a digit
    // or nothing of the factor before it): sin x.y is sin(x)·y.
    const factorCharacter = (k: number) => {
      const char = charAt(k)
      if (char === '.')
        return /^[0-9]$/.test(charAt(k + 1)) && (k === j || /^[0-9]$/.test(charAt(k - 1)))
      return !!char && (isNameCharacter(char) || !!constantSymbol(char) || greekName(char) === 'pi')
    }
    if (!factorCharacter(j)) return start
    let k = j
    while (factorCharacter(k)) k++
    while (items[k]?.kind === 'node' && (items[k] as NodeItem).node.kind === 'scripts') k++
    return k
  }

  // A function's name, and what it is applied to: the next factor.
  private takeFunction(items: Item[], i: number, push: Push, head: FunctionHead): number {
    const end = this.nextFactor(items, i + 1)
    const argument = end > i + 1 ? this.sequence(items.slice(i + 1, end)) : null
    push(this.applied(head, argument), { separate: true })
    return end > i + 1 ? end - 1 : i
  }

  // The atoms for a function applied to an argument, as the editor writes
  // it: sin(x), sin^{2}(x), log(x,b), ⌊x⌋.
  private applied(head: FunctionHead, argument: Row | null): Row {
    const body = argument ? bracketBody(argument) : null
    const power = head.sup ? [superscript(head.sup)] : []
    const brackets = bracketsForFunction(head.name)
    if (brackets && body) {
      return [
        group(body, brackets.open as GroupDelimiter, brackets.close as GroupDelimiter),
        ...power,
      ]
    }
    const args = body && head.base ? [...body, symbol(','), ...head.base] : body
    return [func(head.name), ...power, ...(args ? [group(args)] : [])]
  }

  // A function's name, as written: sin, sin², sin⁻¹ (arcsin), log_b. Null
  // if it isn't a function the editor knows.
  private functionHead(nodes: readonly MathNode[], path: string): FunctionHead | null {
    const name = textOf(nodes)
    if (name !== null) {
      const known = functionForSpelling(name)
      return known ? { name: known, sup: null, base: null } : null
    }

    const [only] = nodes
    if (nodes.length !== 1 || only.kind !== 'scripts') return null
    const known = functionForSpelling(textOf(only.base) ?? '')
    if (!known) return null

    let head: FunctionHead = { name: known, sup: null, base: null }
    const sup = textOf(only.sup)
    const inverse = FUNCTION_REGISTRY[`a${known}`]
    if (only.sup && /^[-−]1$/.test(sup ?? '') && inverse) {
      head = { ...head, name: inverse.name }
      this.notes.add(
        `${getFunctionDefinition(known)?.latexName}⁻¹ was read as ${inverse.latexName}, the inverse function.`,
      )
    } else if (only.sup) {
      head.sup = this.row(only.sup, `${path}.0.p`)
    }
    if (only.sub && known === 'log') {
      head.base = this.row(only.sub, `${path}.0.s`)
    } else if (only.sub) {
      const written = linearText(nodes)
      this.omit(
        'a subscript on a function',
        written,
        `A subscript on a function (${written}) isn't supported: it was left out.`,
      )
    }
    return head
  }

  // ---- Structures --------------------------------------------------------

  private node(item: NodeItem, items: Item[], i: number, out: Row, push: Push): number {
    const { node, path } = item
    switch (node.kind) {
      case 'fraction':
        return this.fraction(node, path, items, i, push)
      case 'scripts':
        return this.scripts(node, path, items, i, out, push)
      case 'radical':
        push([
          root(
            this.row(node.body, `${path}.r`),
            node.index ? this.row(node.index, `${path}.i`) : null,
          ),
        ])
        return i
      case 'fenced': {
        const { atoms, scripted } = this.fenced(node, path)
        push(atoms, { separate: node.open !== '', scripted })
        return i
      }
      case 'accent':
        this.accent(node, path, push)
        return i
      case 'function': {
        const unsupported = node.name.find((n) => n.kind === 'unsupported')
        if (unsupported?.kind === 'unsupported') {
          this.slot(push, unsupported.what, linearText([node]))
          return i
        }
        const head = this.functionHead(node.name, `${path}.fn`)
        const argument = this.row(node.argument, `${path}.a`)
        if (head) {
          push(this.applied(head, argument), { separate: true })
          return i
        }
        const name = this.row(node.name, `${path}.fn`)
        const brackets = group(bracketBody(argument))
        push([...name, brackets], { separate: true })
        this.userFunction(atomsText(name), linearText([node]), [...name, brackets])
        return i
      }
      case 'table':
        this.slot(push, 'a matrix', linearText([node]))
        return i
      case 'unsupported':
        this.slot(push, node.what, node.written)
        return i
    }
  }

  // A fraction, or a derivative: d over d and a variable's name.
  private fraction(
    node: MathNode & { kind: 'fraction' },
    path: string,
    items: Item[],
    i: number,
    push: Push,
  ): number {
    if (!node.bar) {
      this.slot(push, 'a stacked expression without a fraction bar', linearText([node]))
      return i
    }

    // d²x/dt², worked out from the tree first, so that its superscripts are
    // powers: not one the editor writes.
    const order = derivativeOrder(node, path)
    if (order) {
      for (const at of order.paths) this.orders.add(at)
      const end = order.operator ? this.nextFactor(items, i + 1) : i + 1
      const written = linearText([node]) + itemsText(items.slice(i + 1, end))
      const what = orderName(order.order)
      this.omit(
        what,
        written,
        order.italic
          ? `${written} looks like ${what}, which isn't supported: it was kept as a fraction.`
          : `${capitalised(what)} (${written}) isn't supported: it was kept as a fraction.`,
      )
    }

    const num = this.row(node.num, `${path}.n`)
    const den = this.row(node.den, `${path}.d`)
    const plain = () => {
      push([fraction(num, den)])
      return i
    }
    if (order) return plain()

    const top = this.differentials.get(num[0])
    const bottom = this.differentials.get(den[0])
    if (!top || !bottom) return plain()
    const variable = den.slice(1)

    // d²x/dt (the orders differ), or d with a superscript read as part of
    // a name: a fraction.
    if (
      num[1]?.kind === 'superscript' ||
      isSymbol(num[1], '_') ||
      variable[variable.length - 1]?.kind === 'superscript'
    ) {
      return plain()
    }
    if (variable.length === 0 || !isOneName(variable)) return plain()

    // The operator form, d/dt (…): the derivative of the factor after it.
    const operator = num.length === 1
    const end = operator ? this.nextFactor(items, i + 1) : i + 1
    if (operator && end === i + 1) return plain()
    const followed = operator ? itemsText(items.slice(i + 1, end)) : ''

    const certain = top !== 'italic' && bottom !== 'italic'
    let chosen = 'derivative'
    let became: ((atoms: Row) => void) | null = null
    if (!certain) {
      const expression = operator ? followed : atomsText(num.slice(1))
      const decision = this.decide(
        path,
        'derivative',
        'A derivative, or a fraction?',
        {
          latex: treeLatex([node]) + (operator ? `\\,${followed}` : ''),
          text: linearText([node]) + followed,
        },
        [
          {
            id: 'derivative',
            label: `The derivative of ${expression} with respect to ${atomsText(variable)}`,
          },
          {
            id: 'fraction',
            label: operator
              ? `The fraction d/${atomsText(den)}, times ${followed}`
              : `The fraction ${atomsText(num)} over ${atomsText(den)}`,
          },
        ],
      )
      chosen = decision.chosen
      became = decision.became
    }
    if (top === 'partial' || bottom === 'partial') this.notes.add(PARTIAL_NOTE)

    if (chosen === 'fraction') {
      const atoms = [fraction(num, den)]
      push(atoms)
      became?.(atoms)
      return i
    }

    const expression = operator ? this.sequence(items.slice(i + 1, end)) : num.slice(1)
    const atoms = [derivative(bracketBody(expression), variable)]
    push(atoms, { separate: true })
    became?.(atoms)
    return operator ? end - 1 : i
  }

  // A base with a subscript, a superscript or both: a name's parts, a power,
  // a function's power or base, a number's power of ten.
  private scripts(
    node: MathNode & { kind: 'scripts' },
    path: string,
    items: Item[],
    i: number,
    out: Row,
    push: Push,
  ): number {
    const base = textOf(node.base)
    const supText = textOf(node.sup)

    // sin², log_b: a function's name.
    if (base && functionForSpelling(base)) {
      const head = this.functionHead([node], path)
      if (head) return this.takeFunction(items, i, push, head)
    }

    // 1.5×10^{−3}: the number 1.5e-3.
    if (base === '10' && !node.sub && supText && /^[+\-−]?[0-9]+$/.test(supText)) {
      const times = out[out.length - 1]
      if ((isSymbol(times, '×') || isSymbol(times, '·')) && plainNumberAtEnd(out.slice(0, -1))) {
        out.pop()
        out.push(...row(`e${supText.replace('−', '-')}`))
        return i
      }
    }

    // e^x: Euler's number, if upright (or ⅇ); italic, most likely.
    if ((base === 'e' || base === 'ⅇ') && !node.sub && node.sup) {
      const power = this.row(node.sup, `${path}.p`)
      if (base === 'ⅇ' || isUpright(node.base)) {
        push([symbol('exponentiale'), superscript(power)], { separate: true })
        return i
      }
      const written = linearText([node])
      const { chosen, became } = this.decide(
        path,
        'exponential',
        'Is e Euler’s number?',
        { latex: treeLatex([node]), text: written },
        [
          { id: 'constant', label: `Euler’s number: ${written} is exp(${atomsText(power)})` },
          { id: 'variable', label: 'A variable called e, raised to that power' },
        ],
      )
      const e = symbol(chosen === 'constant' ? 'exponentiale' : 'e')
      if (chosen === 'variable') this.italic.add(e)
      // e²: digits, asked about as on any name whatever is chosen for e
      // (unless written upright on purpose, as the editor writes e__1), and
      // part of the name only if e is a variable.
      const digits = textOf(node.sup)
      const plainDigits = digits !== null && /^[0-9]+$/.test(digits) && !this.orders.has(path)
      const upright = plainDigits && isExplicitlyUpright(node.sup)
      const digit =
        plainDigits && !upright
          ? this.digitSuperscript(
              path,
              { latex: treeLatex([node]), text: written },
              [symbol('e')],
              digits,
            )
          : null
      const part = chosen === 'variable' && (upright || digit?.chosen === 'name')
      const atoms = part ? [e, symbol('_'), symbol('_'), ...row(digits!)] : [e, superscript(power)]
      push(atoms, { separate: true, scripted: part })
      became(atoms)
      digit?.became(atoms)
      return i
    }

    // A name, with its scripts as parts of it: written as text, or an
    // accent over a name (q̄_i), a name in square brackets ([Glc]_i), a name
    // with scripts of its own.
    const atoms = this.row(node.base, `${path}.b`)
    if (isOneName(atoms)) {
      let scripted = atoms.some((atom) => this.keywords.has(atom))
      // x_{bar}^{+}: a charge goes straight after the base, before the
      // subscript's parts, so that a subscript which is a keyword (bar,
      // minus) stays a part after it, as the editor writes x_plus_bar.
      const rest = node.sub && node.sup ? this.leadingCharge(node, atoms) : null
      if (rest) scripted = true
      if (node.sub) scripted = this.subscriptPart(node, path, atoms) || scripted
      if (rest?.length) scripted = this.superscriptPart(node, path, atoms, rest) || scripted
      else if (node.sup && !rest) scripted = this.superscriptPart(node, path, atoms) || scripted
      this.wrote(atoms, linearText([node]))
      push(atoms, { scripted, separate: !(base && isNameText(base)) })
      return i
    }

    // Anything else, raised to a power. Digits are still asked about if it
    // could have been a name, so the questions are the same whatever is
    // chosen inside it, but they are a power whatever the answer.
    const digits = textOf(node.sup)
    if (
      digits !== null &&
      /^[0-9]+$/.test(digits) &&
      canBeName(node.base) &&
      !isExplicitlyUpright(node.sup!) &&
      !this.orders.has(path)
    ) {
      const { became } = this.digitSuperscript(
        path,
        { latex: treeLatex([node]), text: linearText([node]) },
        atoms,
        digits,
      )
      became(atoms)
    }
    if (node.sub) {
      const written = linearText([node])
      this.omit(
        'a subscript on something other than a name',
        written,
        `A subscript on something other than a name (${written}) isn't supported: the subscript was left out.`,
        atoms,
      )
    }
    if (node.sup) atoms.push(superscript(this.row(node.sup, `${path}.p`)))
    push(atoms, { separate: atoms[0]?.kind !== 'superscript' })
    return i
  }

  // A name's subscript as a part of it (_part), if it can be; true if so.
  private subscriptPart(node: MathNode & { kind: 'scripts' }, path: string, atoms: Row): boolean {
    let text = textOf(node.sub)
    // n_∞, as steady states are written: n_inf, as CellML names them.
    if (text && text.includes('∞') && isNameParts(text.replace(/∞/g, 'inf'))) {
      const written = linearText([{ ...node, sup: null }])
      this.notes.add(
        `∞ in a name’s subscript was read as inf: ${written} is ${text.replace(/∞/g, 'inf')} after the underscore.`,
      )
      text = text.replace(/∞/g, 'inf')
    }
    if (text && isNameParts(text)) {
      const start = atoms.length + 1
      atoms.push(symbol('_'), ...nameParts(text, 1))
      // x_{bar}: the subscript is a keyword where a decoration goes.
      const read = nameScripts(atoms.map((atom) => (atom.kind === 'symbol' ? atom.value : '')))
      if (read && [read.accent, read.charge, read.conc].some((d) => d && d.text[0] >= start)) {
        const name = atoms.map((atom) => (atom.kind === 'symbol' ? atom.value : '')).join('')
        this.notes.add(
          `${linearText([{ ...node, sup: null }])} was read as the name ${name}, which is drawn decorated: bar, hat, tilde, check, conc or a charge (2plus) straight after a name’s first word is a decoration, not a subscript.`,
        )
      }
      return true
    }
    const written = linearText([{ ...node, sup: null }])
    this.omit(
      'a subscript that isn’t part of a name',
      written,
      `A subscript that can’t be part of a name (${written}) isn't supported: the subscript was left out.`,
      atoms,
    )
    return false
  }

  // The name `atoms` with the charge written `written` in place, as the
  // superscript of `node`. False, with nothing changed, if it isn't a charge
  // or the name can't take it.
  private charged(node: MathNode & { kind: 'scripts' }, atoms: Row, written: string): boolean {
    const charge = chargeFromText(written)
    const named = charge && withNameKeyword(atoms, chargeWord(charge.count, charge.sign))
    if (!named) return false
    this.decorated(atoms, named, 'charge', linearText([node]))
    atoms.splice(0, atoms.length, ...named)
    return true
  }

  // A superscript that starts with a charge on the base, read before the
  // subscript: what is left of the superscript after it (nothing, or the
  // parts after a comma, Ca_i^{2+,max}), or null, with nothing changed, if
  // it doesn't start with one.
  private leadingCharge(node: MathNode & { kind: 'scripts' }, atoms: Row): MathNode[] | null {
    const split = splitAt(node.sup!, /,/)
    if (split && split[1].length > 0 && this.charged(node, atoms, textOf(split[0]) ?? '')) {
      return split[1]
    }
    const text = textOf(node.sup)
    return text !== null && this.charged(node, atoms, text) ? [] : null
  }

  // A name's superscript: a part of it (__part), its charge, or a power.
  // True if it is in the name. `sup` is what is left of the superscript, after
  // a charge before a comma (Ca^{2+,max}).
  private superscriptPart(
    node: MathNode & { kind: 'scripts' },
    path: string,
    atoms: Row,
    sup: MathNode[] = node.sup!,
  ): boolean {
    const text = textOf(sup)
    const word = text !== null && isNameParts(text) && hasLetter(text)
    const letters = text ? Array.from(text.replace(/,/g, '')).length : 0
    const power = () => superscript(this.row(sup, `${path}.p`))
    const part = () => [symbol('_'), symbol('_'), ...nameParts(text ?? '', 2)]
    const charged = (written: string) => this.charged(node, atoms, written)

    // Ca^{2+,max}: a charge, then parts (as the editor writes Ca_2plus__max).
    const split = sup === node.sup ? splitAt(sup, /,/) : null
    if (split && split[1].length > 0 && charged(textOf(split[0]) ?? '')) {
      this.superscriptPart(node, path, atoms, split[1])
      return true
    }

    if (word && isUpright(sup)) {
      atoms.push(...part())
      return true
    }

    // Ca^{2+}: a charge, part of the name (Ca_2plus). One that isn't a
    // name's (Ca^{0+}, Ca^{+2}), or can't go in it, is left out.
    if (text !== null && charged(text)) return true
    if (text !== null && /^([0-9]*[+\-−]+|\+[0-9]+)$/.test(text)) {
      const written = linearText([node])
      this.omit(
        'a charge',
        written,
        `A charge as a superscript (${written}) isn't supported: it was left out.`,
        atoms,
      )
      return false
    }

    // K_c^{Glc_o}: a name with a subscript, part of the name (K_c__Glc__o)
    // if upright, and otherwise asked about, as a word is.
    const nested = text === null ? subscriptedNameText(sup) : null
    if (nested !== null) {
      const scripts = sup[0] as MathNode & { kind: 'scripts' }
      const named = () => [symbol('_'), symbol('_'), ...nameParts(nested, 2)]
      if (isUpright(scripts.base) && isUpright(scripts.sub!)) {
        atoms.push(...named())
        return true
      }
      const base = atomsText(atoms)
      const stored = atoms.map((atom) => (atom.kind === 'symbol' ? atom.value : '')).join('')
      const written = linearText(sup)
      const { chosen, became } = this.decide(
        path,
        'name-superscript',
        'Part of the name, or a power?',
        { latex: treeLatex([node]), text: linearText([node]) },
        [
          {
            id: 'name',
            label: `Part of the name: ${base} with the superscript ${written} (${stored}__${nested.replace(/,/g, '__')})`,
          },
          { id: 'power', label: `A power: ${base} to the power ${written}` },
        ],
      )
      atoms.push(...(chosen === 'name' ? named() : [power()]))
      became(atoms)
      return chosen === 'name'
    }

    if (word && letters >= 2) {
      const base = atomsText(atoms)
      const written = linearText([node])
      const { chosen, became } = this.decide(
        path,
        'name-superscript',
        'Part of the name, or a power?',
        { latex: treeLatex([node]), text: written },
        [
          { id: 'name', label: `Part of the name: ${base} with the superscript ${text}` },
          { id: 'power', label: `A power: ${base} to the power ${text}` },
        ],
      )
      atoms.push(...(chosen === 'name' ? part() : [power()]))
      became(atoms)
      return chosen === 'name'
    }

    // κ_m^1: digits, part of the name if they were written upright on
    // purpose (as the editor writes them, x^{1,2} for x__1__2, with the
    // commas between them as they come), a power of a higher-order
    // derivative's d, and otherwise asked about.
    if (text !== null && /^[0-9]+(,[0-9]+)*$/.test(text)) {
      const commas = (node: MathNode) => node.kind === 'text' && /^,+$/.test(node.text)
      const digits = sup.filter((node) => !commas(node))
      if (isExplicitlyUpright(digits)) {
        atoms.push(...part())
        return true
      }
    }
    if (text !== null && /^[0-9]+$/.test(text)) {
      if (!this.orders.has(path)) {
        const { chosen, became } = this.digitSuperscript(
          path,
          { latex: treeLatex([node]), text: linearText([node]) },
          atoms,
          text,
        )
        atoms.push(...(chosen === 'name' ? part() : [power()]))
        became(atoms)
        return chosen === 'name'
      }
    }

    atoms.push(power())
    return false
  }

  // An accent over a name, as part of it: q̄ is q_bar (bar, hat, tilde or
  // check). Over anything else, or another accent, it is left out with what
  // it is over, and what was said while reading that goes too.
  private accent(node: MathNode & { kind: 'accent' }, path: string, push: Push) {
    const omissions = this.omissions.length
    const assumptions = this.assumptions.length
    const periods = this.periods.length
    const notes = [...this.notes]

    const base = this.row(node.base, `${path}.a`)
    const kind = node.position === 'over' ? accentForMark(node.mark) : null
    const named = kind && isOneName(base) ? withNameKeyword(base, kind) : null
    if (named) {
      this.decorated(base, named, 'accent', linearText([node]))
      push(named, { scripted: true, separate: true })
      return
    }

    this.omissions.splice(omissions)
    this.assumptions.splice(assumptions)
    this.periods.splice(periods)
    this.notes.clear()
    for (const note of notes) this.notes.add(note)
    this.slot(push, node.what, linearText([node]))
  }

  // [Glc]: square brackets round one name, its concentration (Glc_conc).
  // Null if `body` isn't one name, or can't take conc.
  private concentration(body: Row, written: string): Row | null {
    const named = isOneName(body) ? withNameKeyword(body, 'conc') : null
    if (named) this.decorated(body, named, 'conc', written)
    return named
  }

  // Brackets, as characters matched: ( ), [ ] (round one name, its
  // concentration; otherwise as round brackets), | |, ⌊ ⌋, ⌈ ⌉, and { round a
  // table (a piecewise definition). `scripted`: they became a decorated name.
  private bracket(item: BracketItem): { atoms: Row; scripted: boolean } {
    const [only] = item.items
    if (
      item.open === '{' &&
      item.items.length === 1 &&
      only.kind === 'node' &&
      only.node.kind === 'table'
    ) {
      return { atoms: [this.piecewise(only.node, only.path)], scripted: false }
    }
    const body = this.sequence(item.items)
    const conc =
      item.open === '[' && item.close === ']'
        ? this.concentration(body, `[${itemsText(item.items)}]`)
        : null
    if (conc) return { atoms: conc, scripted: true }
    return { atoms: [this.delimited(item.open, body)], scripted: false }
  }

  private fenced(
    node: MathNode & { kind: 'fenced' },
    path: string,
  ): { atoms: Row; scripted: boolean } {
    const [only] = node.items
    if (
      node.open === '{' &&
      node.items.length === 1 &&
      only.length === 1 &&
      only[0].kind === 'table'
    ) {
      return { atoms: [this.piecewise(only[0], `${path}.f0.0`)], scripted: false }
    }
    const body = node.items.flatMap((nodes, k) => {
      const part = this.row(nodes, `${path}.f${k}`)
      return k === 0 ? part : [symbol(','), ...part]
    })
    const conc =
      node.open === '[' && node.close === ']' && node.items.length === 1
        ? this.concentration(body, linearText([node]))
        : null
    if (conc) return { atoms: conc, scripted: true }
    if (node.open === '' && node.close === '') return { atoms: body, scripted: false }
    return { atoms: [this.delimited(node.open, body)], scripted: false }
  }

  private delimited(open: string, body: Row): Atom {
    switch (open) {
      case '|':
      case '‖':
        return group(body, '|')
      case '⌊':
        return group(body, '⌊')
      case '⌈':
        return group(body, '⌈')
      default:
        return group(body, '(')
    }
  }

  // A brace round a table: one piece a row, its value then its condition (in
  // a second column, or after &, "if" or the last comma); a row whose
  // condition is "otherwise", or the last with none, is the otherwise.
  private piecewise(table: MathNode & { kind: 'table' }, path: string): Atom {
    const pieces: Array<[Row, Row]> = []
    let otherwise: Row | null = null

    table.rows.forEach((cells, r) => {
      const [value, condition] = pieceParts(cells)
      const here = `${path}.t${r}`
      const valueRow = this.row(value, `${here}.v`)
      const words = conditionWords(condition)
      const last = r === table.rows.length - 1
      if (words.otherwise || (words.nodes.length === 0 && last && r > 0)) {
        otherwise = valueRow
        return
      }
      pieces.push([valueRow, this.row(words.nodes, `${here}.c`)])
    })

    if (pieces.length === 0) return piecewise([[otherwise ?? [], []]], null)
    return piecewise(pieces, otherwise)
  }
}

// ---------------------------------------------------------------------------
// Piecewise rows
// ---------------------------------------------------------------------------

// Nodes split at the first (or last) match of `pattern` in a text node at
// the top level, without the match; null if there is none.
function splitAt(
  nodes: readonly MathNode[],
  pattern: RegExp,
  last = false,
): [MathNode[], MathNode[]] | null {
  const order = nodes.map((_, i) => i)
  if (last) order.reverse()
  for (const i of order) {
    const node = nodes[i]
    if (node.kind !== 'text') continue
    const matches = Array.from(
      node.text.matchAll(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`)),
    )
    const match = last ? matches[matches.length - 1] : matches[0]
    if (!match || match.index === undefined) continue
    const before = node.text.slice(0, match.index)
    const after = node.text.slice(match.index + match[0].length)
    return [
      [...nodes.slice(0, i), ...(before.trim() ? [{ ...node, text: before }] : [])],
      [...(after.trim() ? [{ ...node, text: after }] : []), ...nodes.slice(i + 1)],
    ]
  }
  return null
}

function pieceParts(cells: MathNode[][]): [MathNode[], MathNode[]] {
  if (cells.length >= 2) return [withoutTrailingComma(cells[0]), cells.slice(1).flat()]
  const [cell = []] = cells
  const [value, condition] = splitAt(cell, /&/) ??
    splitAt(cell, /\b(if|for|when)\b/i) ??
    splitAt(cell, /,/, true) ?? [cell, []]
  return [withoutTrailingComma(value), condition]
}

// A value without the comma written after it, before its condition: "5, if".
function withoutTrailingComma(nodes: MathNode[]): MathNode[] {
  const last = nodes[nodes.length - 1]
  if (last?.kind !== 'text') return nodes
  const text = last.text.replace(/[\s\u00a0]*,[\s\u00a0]*$/, '')
  return [...nodes.slice(0, -1), ...(text ? [{ ...last, text }] : [])]
}

// A condition without a leading "if" (for, when) or comma, and whether it
// says "otherwise" (or "else").
function conditionWords(nodes: MathNode[]): { nodes: MathNode[]; otherwise: boolean } {
  const text = linearText(nodes).replace(/[\s &]/g, '')
  if (/^,?(otherwise|else)$/i.test(text)) return { nodes: [], otherwise: true }
  const [first, ...rest] = nodes
  if (first?.kind !== 'text') return { nodes, otherwise: false }
  const stripped = first.text.replace(/^[\s &,]*((if|for|when)\b)?[\s ]*/i, '')
  return { nodes: stripped ? [{ ...first, text: stripped }, ...rest] : rest, otherwise: false }
}
