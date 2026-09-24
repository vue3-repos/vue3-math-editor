// Copy, cut and paste (see docs/design.md).
//
// Copying puts two formats on the clipboard:
// - CLIPBOARD_MIME: the selected layout atoms as JSON, so pasting inside the
//   editor reproduces them exactly;
// - text/plain: LaTeX, for pasting into other apps (and back again).
//
// Pasting prefers CLIPBOARD_MIME and otherwise reads text/plain as LaTeX,
// which also covers plain typed maths such as "(x+1)/2" or "sin(x)^2".
// Letters are pasted as typed characters, so names follow the same rules as
// typing (identifiers.ts): "Vm_init" is one variable, "sin" a function.
// Everything here is pure; MathField wires it to the browser's clipboard
// events.

import {
  GREEK_NAMES,
  bracketFunctionBefore,
  functionForSpelling,
  nameRuns,
  numberRuns,
} from './identifiers'
import { constantForLatexCommand, constantForSymbol, constantForUprightText } from './constants'
import {
  CONDITION_OPERATORS,
  combinedWithEquals,
  conditionOperator,
  conditionOperatorForCommand,
} from './operators'
import {
  type Atom,
  type GroupDelimiter,
  type Row,
  childRows,
  derivative,
  fraction,
  func,
  group,
  newAtomId,
  piecewise,
  root,
  setChildRow,
  superscript,
  symbol,
} from './layout'
import { delimiterLatex, functionLatex } from '../registry/nodes'

export const CLIPBOARD_MIME = 'application/x-semantic-math+json'

// ---------------------------------------------------------------------------
// The editor's own format
// ---------------------------------------------------------------------------

interface ClipboardPayload {
  version: 1
  atoms: Row
}

export function serializeAtoms(atoms: Row): string {
  const payload: ClipboardPayload = { version: 1, atoms }
  return JSON.stringify(payload)
}

// The atoms in a CLIPBOARD_MIME payload, with fresh ids (so pasting twice
// never duplicates an id), or null if the payload isn't valid.
export function deserializeAtoms(text: string | null | undefined): Row | null {
  if (!text) return null

  try {
    const payload = JSON.parse(text) as Partial<ClipboardPayload>
    if (payload?.version !== 1 || !isRow(payload.atoms)) return null
    return withFreshIds(payload.atoms)
  } catch {
    return null
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

function isRow(value: unknown): value is Row {
  return Array.isArray(value) && value.every(isAtom)
}

function isAtom(value: unknown): value is Atom {
  if (!isObject(value) || typeof value.id !== 'string') return false

  switch (value.kind) {
    case 'symbol':
      return typeof value.value === 'string'
    case 'function':
      return typeof value.name === 'string'
    case 'fraction':
      return isRow(value.num) && isRow(value.den)
    case 'superscript':
      return isRow(value.sup)
    case 'root':
      return isRow(value.body) && (value.index === null || isRow(value.index))
    case 'group':
      return (
        isRow(value.body) &&
        DELIMITERS.includes(value.open as string) &&
        DELIMITERS.includes(value.close as string)
      )
    case 'derivative':
      return isRow(value.expr) && isRow(value.variable)
    case 'piecewise':
      return (
        Array.isArray(value.pieces) &&
        value.pieces.length > 0 &&
        value.pieces.every(
          (piece: unknown) => isObject(piece) && isRow(piece.value) && isRow(piece.condition),
        ) &&
        (value.otherwise === null || isRow(value.otherwise))
      )
    default:
      return false
  }
}

function withFreshIds(atoms: Row): Row {
  return atoms.map((atom) => {
    let copy = { ...atom, id: newAtomId() } as Atom
    for (const [branch, child] of childRows(atom)) {
      copy = setChildRow(copy, branch, withFreshIds(child))
    }
    return copy
  })
}

// ---------------------------------------------------------------------------
// Layout -> LaTeX (text/plain)
// ---------------------------------------------------------------------------

const OPERATOR_LATEX: Record<string, string> = {
  '·': '\\cdot ',
  '*': '\\cdot ',
  '×': '\\times ',
  '−': '-',
  // < > ≤ ≥ ≠ ∧ ∨ ⊻ ¬ (a trailing space ends a command name)
  ...Object.fromEntries(
    CONDITION_OPERATORS.map((op) => [
      op.symbol,
      op.latex.startsWith('\\') ? `${op.latex} ` : op.latex,
    ]),
  ),
}

const TEXT_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '#': '\\#',
  $: '\\$',
  '%': '\\%',
  '&': '\\&',
  _: '\\_',
  '^': '\\textasciicircum{}',
  '~': '\\textasciitilde{}',
}

function symbolLatex(value: string): string {
  if (value in OPERATOR_LATEX) return OPERATOR_LATEX[value]
  if (/^[A-Za-z0-9.+\-=,]$/.test(value)) return value
  const constant = constantForSymbol(value)
  if (constant) return /[a-z]$/i.test(constant.latex) ? `${constant.latex} ` : constant.latex
  if (GREEK_NAMES.has(value)) return `\\${value} `
  if (/^[A-Za-z]+$/.test(value)) return `\\mathit{${value}}`
  return `\\text{${Array.from(value, (c) => TEXT_ESCAPES[c] ?? c).join('')}}`
}

const isOperatorAtom = (atom: Atom | undefined) =>
  atom?.kind === 'symbol' &&
  (/^[+\-−=,·*×]$/.test(atom.value) || conditionOperator(atom.value) !== undefined)

// Plain, readable LaTeX for a row (no editor markup). A name of more than
// one character is written \mathit{Vm\_init} so LaTeX treats it as one
// variable; a function spelling as the function (\sin). An empty row is
// written as \square, which latexToRow reads back as an empty row. A number
// in scientific notation is written 1\mathrm{e}{-08}: upright e, and the
// exponent braced so its sign gets no operator spacing.
export function rowToLatexSource(row: Row): string {
  const runs = new Map(nameRuns(row).map((run) => [run.start, run]))
  const scientific = new Map(
    numberRuns(row)
      .filter((run) => run.exponent !== null)
      .map((run) => [run.start, run]),
  )
  let out = ''

  for (let i = 0; i < row.length; ) {
    const number = scientific.get(i)
    if (number) {
      const chars = row
        .slice(number.start, number.end)
        .map((atom) => (atom as { value: string }).value.replace('−', '-'))
      const e = chars.findIndex((c) => c === 'e' || c === 'E')
      out += `${chars.slice(0, e).join('')}\\mathrm{${chars[e]}}{${chars.slice(e + 1).join('')}}`
      i = number.end
      continue
    }

    const run = runs.get(i)

    if (run) {
      out += nameLatex(run.name, run.functionName)
      i = run.end
      continue
    }

    out += atomLatex(row[i], row[i - 1])
    i++
  }

  return out.trim() || '\\square'
}

function nameLatex(name: string, functionName: string | null): string {
  if (functionName) {
    return functionLatex(functionName)
  }

  return name.length === 1 ? name : `\\mathit{${name.replace(/_/g, '\\_')}}`
}

function atomLatex(atom: Atom, previous: Atom | undefined): string {
  switch (atom.kind) {
    case 'symbol':
      return symbolLatex(atom.value)
    case 'function':
      return functionLatex(atom.name)
    case 'fraction':
      return `\\frac{${rowToLatexSource(atom.num)}}{${rowToLatexSource(atom.den)}}`
    case 'superscript': {
      // Attaches to the atom before it; with nothing suitable, an empty base.
      const base = previous && !isOperatorAtom(previous) ? '' : '{}'
      return `${base}^{${rowToLatexSource(atom.sup)}}`
    }
    case 'root':
      return atom.index
        ? `\\sqrt[${rowToLatexSource(atom.index)}]{${rowToLatexSource(atom.body)}}`
        : `\\sqrt{${rowToLatexSource(atom.body)}}`
    case 'group': {
      // \left( … \right), \left| … \right|, \left\lfloor … \right\rfloor, …
      const open = delimiterLatex(atom.open)
      const close = delimiterLatex(atom.close)
      const space = (d: string) => (/[a-z]$/.test(d) ? ' ' : '')
      return `\\left${open}${space(open)}${rowToLatexSource(atom.body)}\\right${close}${space(close)}`
    }
    case 'derivative':
      return `\\frac{\\mathrm{d}${rowToLatexSource(atom.expr)}}{\\mathrm{d}${rowToLatexSource(atom.variable)}}`
    case 'piecewise': {
      const lines = atom.pieces.map(
        ({ value, condition }) => `${rowToLatexSource(value)} & ${rowToLatexSource(condition)}`,
      )
      if (atom.otherwise) lines.push(`${rowToLatexSource(atom.otherwise)} & \\text{otherwise}`)
      return `\\begin{cases}${lines.join(' \\\\ ')}\\end{cases}`
    }
  }
}

// ---------------------------------------------------------------------------
// LaTeX or plain text -> layout
// ---------------------------------------------------------------------------

type Token =
  | { kind: 'command'; name: string }
  | { kind: 'char'; value: string }
  | { kind: 'open' } // {
  | { kind: 'close' } // }

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < text.length) {
    const char = text[i]

    if (char === '\\') {
      const word = /^[A-Za-z]+/.exec(text.slice(i + 1))
      if (word) {
        tokens.push({ kind: 'command', name: word[0] })
        i += 1 + word[0].length
      } else {
        // A control symbol: \, \; \! \{ \} \| \\ …
        tokens.push({ kind: 'command', name: text[i + 1] ?? '' })
        i += 2
      }
      continue
    }

    if (char === '{') tokens.push({ kind: 'open' })
    else if (char === '}') tokens.push({ kind: 'close' })
    else if (!/\s/.test(char)) tokens.push({ kind: 'char', value: char })
    i++
  }

  return tokens
}

const DELIMITERS = ['(', ')', '|', '⌊', '⌋', '⌈', '⌉']
const TEXT_COMMANDS = new Set(['text', 'textrm', 'textnormal', 'textit', 'mbox', 'mathrm'])
const CASES_ENVIRONMENTS = new Set(['cases', 'dcases', 'rcases'])
const SPACING = new Set([',', ';', ':', '!', ' ', 'quad', 'qquad', 'displaystyle', 'textstyle'])
const OPERATOR_CHARS = new Set(['+', '-', '−', '=', ',', '·', '*', '×'])

// Where a row being read should stop.
interface Stop {
  close?: boolean // at "}"
  char?: string // at this character (")" or "|" or "]")
  right?: boolean // at \right
  command?: string // at this command (\rfloor)
  operator?: boolean // before a top-level operator (a fraction's denominator)
  closing?: boolean // before ")" or "]", or "|" when inside |…| (likewise)
}

class LatexReader {
  private index = 0
  // \mathrm{d} markers, to recognise \frac{\mathrm{d}…}{\mathrm{d}…}.
  private readonly uprightD = new WeakSet<Atom>()
  // How many |…| are open, so a "|" closes rather than opens.
  private absDepth = 0
  // How many \begin{cases} are open, so "&", "\\" and \end end a cell.
  private casesDepth = 0

  constructor(private readonly tokens: Token[]) {}

  readAll(): Row {
    const atoms: Row = []
    while (this.peek()) {
      atoms.push(...this.readRow({}))
      this.next() // skip a stray "}", ")" or \right
    }
    return atoms
  }

  private peek(): Token | undefined {
    return this.tokens[this.index]
  }

  private next(): Token | undefined {
    return this.tokens[this.index++]
  }

  private atStop(stop: Stop): boolean {
    const token = this.peek()
    if (!token) return true
    if (this.casesDepth > 0 && this.atCellEnd()) return true
    if (stop.close && token.kind === 'close') return true
    if (stop.right && token.kind === 'command' && token.name === 'right') return true
    if (stop.command && token.kind === 'command' && token.name === stop.command) return true
    if (token.kind === 'char') {
      if (stop.char && token.value === stop.char) return true
      if (stop.operator && OPERATOR_CHARS.has(token.value)) return true
      if (stop.closing && [')', ']'].includes(token.value)) return true
      if (stop.closing && token.value === '|' && this.absDepth > 0) return true
    }
    return false
  }

  // Inside cases: "&" (next column), "\\" (next line) or \end.
  private atCellEnd(): boolean {
    const token = this.peek()
    if (token?.kind === 'char') return token.value === '&'
    return token?.kind === 'command' && (token.name === '\\' || token.name === 'end')
  }

  // \begin{cases} … \end{cases}, after the \begin{cases}: "value & condition"
  // lines separated by \\. A condition of \text{otherwise} (or "else") makes
  // that line the otherwise; a leading \text{if} (for, when) is dropped.
  private readCases(): Atom {
    const pieces: Array<[Row, Row]> = []
    let otherwise: Row | null = null
    this.casesDepth++

    for (;;) {
      const value = this.readRow({})
      let condition: Row = []
      let isOtherwise = false

      if (this.peek()?.kind === 'char') {
        this.next() // "&"
        const word = this.readConditionWord()
        isOtherwise = word === 'otherwise'
        condition = this.readRow({})
        const spelled = condition.map((a) => (a.kind === 'symbol' ? a.value : '?')).join('')
        if (/^(otherwise|else)$/.test(spelled)) {
          isOtherwise = true
          condition = []
        }
      }

      if (isOtherwise) otherwise = value
      else if (value.length > 0 || condition.length > 0) pieces.push([value, condition])

      const token = this.next()
      if (!token || token.kind !== 'command' || token.name !== '\\') {
        if (token?.kind === 'command' && token.name === 'end') this.readText()
        break
      }
    }

    this.casesDepth--
    return piecewise(pieces.length > 0 ? pieces : [[[], []]], otherwise)
  }

  // A word at the start of a condition cell, in \text{…}: "otherwise" (or
  // "else"), or "if", "for", "when" (dropped); anything else is left unread.
  private readConditionWord(): 'otherwise' | 'if' | null {
    const token = this.peek()
    if (token?.kind !== 'command' || !TEXT_COMMANDS.has(token.name)) return null

    const start = this.index
    this.next()
    const word = this.readText().trim().replace(/[,:]$/, '').toLowerCase()
    if (word === 'otherwise' || word === 'else') return 'otherwise'
    if (['if', 'for', 'when'].includes(word)) return 'if'

    this.index = start
    return null
  }

  // Read atoms until a stop (not consumed).
  private readRow(stop: Stop): Row {
    const atoms: Row = []

    while (!this.atStop(stop)) {
      const token = this.next()!

      switch (token.kind) {
        case 'open':
          atoms.push(...this.readRow({ close: true }))
          this.next() // "}"
          break
        case 'close':
          break // unmatched: ignore
        case 'char':
          this.readChar(token.value, atoms)
          break
        case 'command':
          this.readCommand(token.name, atoms)
          break
      }
    }

    return atoms
  }

  private readChar(char: string, atoms: Row): void {
    switch (char) {
      case '(':
      case '[': {
        const body = this.readUntilChar(char === '(' ? ')' : ']')
        this.pushBrackets(atoms, body, char === '(' ? '(' : '[')
        return
      }
      case '|': {
        this.absDepth++
        const body = this.readUntilChar('|')
        this.absDepth--
        atoms.push(group(body, '|'))
        return
      }
      case ')':
      case ']':
        return // unmatched: ignore
      case '^':
        atoms.push(superscript(this.readScript()))
        return
      case '_':
        // Subscripts aren't supported: the underscore is kept literally as
        // part of the name, with its content after it (x_{12} -> x_12).
        atoms.push(symbol('_'), ...this.readScript())
        return
      case '/':
        atoms.push(this.readInfixFraction(atoms))
        return
      case '*':
        atoms.push(symbol('·'))
        return
      case '=': {
        // Plain text "<=", ">=", "!=" (and "==") are one operator.
        const previous = atoms[atoms.length - 1]
        const value = previous?.kind === 'symbol' ? previous.value : ''
        const combined = combinedWithEquals(value === '!' ? '¬' : value)
        if (combined) atoms[atoms.length - 1] = symbol(combined)
        else if (value !== '=') atoms.push(symbol('='))
        return
      }
      case '!':
        atoms.push(symbol('¬'))
        return
      case '&': {
        // "&" or "&&" is ∧ (LaTeX tables aren't read).
        const previous = atoms[atoms.length - 1]
        if (!(previous?.kind === 'symbol' && previous.value === '∧')) atoms.push(symbol('∧'))
        return
      }
      default:
        atoms.push(symbol(char === '−' ? '-' : char))
    }
  }

  // Brackets round `body`. Round brackets straight after floor or ceil(ing)
  // written as a name (typed letters, \operatorname{floor}) are that
  // function's brackets instead: "floor(x)" is ⌊x⌋. Square brackets are round.
  private pushBrackets(atoms: Row, body: Row, open: GroupDelimiter | '['): void {
    const bracket = open === '(' ? bracketFunctionBefore(atoms, atoms.length) : null

    if (bracket) {
      atoms.splice(bracket.start, atoms.length - bracket.start, group(body, bracket.open))
    } else {
      atoms.push(group(body, open === '[' ? '(' : open))
    }
  }

  private readUntilChar(close: string): Row {
    const body = this.readRow({ char: close })
    this.next() // the closing character (if any)
    return body
  }

  // "a/b" in plain text: the operand before the slash (back to the previous
  // operator, as when typing "/") over the operand after it (up to the next
  // operator).
  private readInfixFraction(atoms: Row): Atom {
    let start = atoms.length
    while (start > 0 && !isOperatorAtom(atoms[start - 1])) start--

    let numerator = atoms.splice(start)
    const only = numerator[0]
    if (numerator.length === 1 && only.kind === 'group' && only.open === '(') numerator = only.body

    let denominator = this.readRow({ operator: true, closing: true, close: true, right: true })
    const single = denominator[0]
    if (denominator.length === 1 && single.kind === 'group' && single.open === '(') {
      denominator = single.body
    }

    return fraction(numerator, denominator)
  }

  // The argument of ^ or _: a braced group, one command, a run of digits, or
  // one character.
  private readScript(): Row {
    const token = this.peek()
    if (!token) return []

    if (token.kind === 'char' && /[0-9]/.test(token.value)) {
      let digits = ''
      while (
        this.peek()?.kind === 'char' &&
        /[0-9.]/.test((this.peek() as { value: string }).value)
      ) {
        digits += (this.next() as { value: string }).value
      }
      return Array.from(digits, (d) => symbol(d))
    }

    return this.readArgument()
  }

  // A macro argument: {…}, or a single token.
  private readArgument(): Row {
    const token = this.peek()
    if (!token) return []

    if (token.kind === 'open') {
      this.next()
      const body = this.readRow({ close: true })
      this.next()
      return body
    }

    const atoms: Row = []
    this.next()
    if (token.kind === 'char') this.readChar(token.value, atoms)
    else if (token.kind === 'command') this.readCommand(token.name, atoms)
    return atoms
  }

  // The raw text of a {…} argument (for \mathrm, \text, \operatorname).
  private readText(): string {
    if (this.peek()?.kind !== 'open') {
      const token = this.next()
      return token?.kind === 'char' ? token.value : ''
    }

    this.next()
    let text = ''
    let depth = 0

    while (this.peek()) {
      const token = this.next()!
      if (token.kind === 'close' && depth === 0) break
      if (token.kind === 'open') depth++
      if (token.kind === 'close') depth--
      if (token.kind === 'char') text += token.value
      if (token.kind === 'command') text += token.name.length === 1 ? token.name : ''
    }

    return text
  }

  private readCommand(name: string, atoms: Row): void {
    if (SPACING.has(name)) return

    // \leq, \land, \lnot, … (\not= then reads as ≠, see readChar).
    const operator = conditionOperatorForCommand(name)
    if (operator) {
      atoms.push(symbol(operator.symbol))
      return
    }

    switch (name) {
      case 'begin': {
        const environment = this.readText()
        if (CASES_ENVIRONMENTS.has(environment)) atoms.push(this.readCases())
        return
      }
      case 'end':
        this.readText() // a stray \end
        return
      case 'frac':
      case 'dfrac':
      case 'tfrac': {
        const num = this.readArgument()
        const den = this.readArgument()
        const d = (r: Row) => r[0] !== undefined && this.uprightD.has(r[0])
        atoms.push(d(num) && d(den) ? derivative(num.slice(1), den.slice(1)) : fraction(num, den))
        return
      }

      case 'sqrt': {
        let index: Row | null = null
        if (this.peek()?.kind === 'char' && (this.peek() as { value: string }).value === '[') {
          this.next()
          index = this.readUntilChar(']')
        }
        atoms.push(root(this.readArgument(), index))
        return
      }

      case 'left': {
        const delimiter = this.next()
        const name =
          delimiter?.kind === 'char'
            ? delimiter.value
            : delimiter?.kind === 'command'
              ? delimiter.name
              : ''
        const body = this.readRow({ right: true })
        this.next() // \right
        this.next() // its delimiter
        const open = name === '|' ? '|' : name === 'lfloor' ? '⌊' : name === 'lceil' ? '⌈' : '('
        this.pushBrackets(atoms, body, open)
        return
      }

      // \lfloor x \rfloor and \lceil x \rceil without \left/\right.
      case 'lfloor':
      case 'lceil': {
        const body = this.readRow({ command: name === 'lfloor' ? 'rfloor' : 'rceil' })
        this.next() // \rfloor, \rceil
        atoms.push(group(body, name === 'lfloor' ? '⌊' : '⌈'))
        return
      }
      case 'rfloor':
      case 'rceil':
        return // unmatched

      case 'right':
        return // unmatched

      case 'cdot':
      case 'ast':
        atoms.push(symbol('·'))
        return
      case 'times':
        atoms.push(symbol('×'))
        return
      case 'square':
      case 'Box':
        return // an empty slot
      case '{':
      case '}':
      case '|':
        atoms.push(symbol(name))
        return

      case 'mathrm':
      case 'operatorname':
      case 'mathit':
      case 'text':
      case 'textrm':
      case 'mathbf': {
        const text = this.readText()
        this.readNamed(name, text, atoms)
        return
      }
    }

    const spelled = functionForSpelling(name)
    if (spelled) {
      atoms.push(func(spelled))
      return
    }

    const constant = constantForLatexCommand(name)
    atoms.push(symbol(constant ?? name)) // \pi, \infty (constants), \alpha, …
  }

  private readNamed(command: string, text: string, atoms: Row): void {
    if (!text) return

    // The e of a number in scientific notation, as rowToLatexSource writes
    // it (1\mathrm{e}{-08}): straight before a brace. An upright E likewise.
    if (command === 'mathrm' && (text === 'E' || (text === 'e' && this.peek()?.kind === 'open'))) {
      atoms.push(symbol(text))
      return
    }

    // \mathrm{e} otherwise is Euler's number; \mathrm{NaN}, \mathrm{true}, …
    const constant = command === 'mathrm' ? constantForUprightText(text) : undefined
    if (constant) {
      atoms.push(symbol(constant))
      return
    }

    if (command === 'mathrm' && text === 'd') {
      const d = symbol('d')
      this.uprightD.add(d)
      atoms.push(d)
      return
    }

    if (command === 'operatorname' || command === 'mathrm') {
      atoms.push(func(functionForSpelling(text) ?? text))
      return
    }

    if (command === 'text' || command === 'textrm') {
      atoms.push(...Array.from(text, (c) => symbol(c)))
      return
    }

    atoms.push(...Array.from(text, (c) => symbol(c))) // \mathit{Vm_init}: typed characters
  }
}

// Read LaTeX (or plain typed maths) into layout atoms.
export function latexToRow(text: string): Row {
  return new LatexReader(tokenize(text)).readAll()
}
