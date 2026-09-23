// Layout tree (rows of atoms) -> semantic AST.
//
// The editor only ever edits rows (see layout.ts); the semantic `AstNode`
// consumed by the MathJSON / MathML / LaTeX exporters is derived here after
// every change. The parser never throws: incomplete input becomes
// `Placeholder` nodes (an empty row, a missing operand), and anything it
// cannot make sense of is skipped and reported in `diagnostics`, with the
// atoms it covers, so the UI can mark them (MathField's `marks`).
//
// Grammar, loosest to tightest binding:
//
//   or         := xor ( '∨' xor )*
//   xor        := and ( '⊻' and )*
//   and        := not ( '∧' not )*
//   not        := '¬' not | comparison
//   comparison := additive ( ('=' | '<' | '>' | '≤' | '≥' | '≠') additive )?
//   additive   := unary ( ('+' | '-') unary )*
//   unary      := '-' unary | term
//   term       := factor ( ['*' | '·' | '×'] factor )*     implicit or explicit
//   factor     := primary superscript*
//   primary    := number | identifier | function | group | |abs| | fraction
//               | root | derivative
//
// "=" is a comparison like the others, so a condition such as x = 0 ∧ y > 1
// groups as (x = 0) ∧ (y > 1); an equation y = … is the same Equal node.
// Comparisons don't chain: in a < b < c the second one is reported (join them
// with ∧), though the row is still parsed, left to right.
//
// Representation choices (see docs/cursor-refactor.md):
// - `a + b + c` is one flat Add; `a · b · c` is one flat Multiply.
// - Subtraction is a left-associative binary `Subtract` chain:
//   `a - b - c` -> Subtract(Subtract(a, b), c), `a + b - c` ->
//   Subtract(Add(a, b), c).
// - A leading minus negates the whole following term: `-2x` ->
//   Negate(Multiply(2, x)), `-x^2` -> Negate(Power(x, 2)).
// - Names (see identifiers.ts): a run of letters, digits and underscores that
//   starts with a letter is one identifier, so `Vm_init` is one variable and
//   `ab` is not a·b (write `a*b`). A run that is exactly a function's spelling
//   (`sin`, `arcsin`) is that function; `cost` is just a name. A number before
//   a name is still a product: `2Vm` is 2·Vm. A symbol whose value is a whole
//   word (a Greek letter such as "alpha", inserted by a command) is its own
//   identifier. Function atoms (from \sin or the toolbar) are functions.
// - A superscript attaches to the factor before it: `x^2` -> Power(x, 2).
// - Numbers (see numbers.ts) may be in scientific notation: `1e-08` is one
//   Number with value 1e-8, keeping its notation for the exporters; `2e` and
//   `2e-x` are 2·e and 2·e − x.

import type { AstNode, NumberNode } from '../types/ast'
import { continuesName, functionForSpelling, startsName } from './identifiers'
import { numberAt } from './numbers'
import { CONDITION_OPERATORS, conditionOperator } from './operators'
import type { Row, StructureAtom } from './layout'

export interface ParseDiagnostic {
  message: string
  // The atoms the problem covers (all of "1.2.3", say), for marking in the UI.
  // They are consecutive atoms of one row.
  atomIds: string[]
}

export interface ParseResult {
  ast: AstNode
  diagnostics: ParseDiagnostic[]
}

export function parseRow(row: Row): ParseResult {
  const diagnostics: ParseDiagnostic[] = []
  const ast = parseRowInto(row, diagnostics)
  return { ast, diagnostics }
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

// '+', '-', '=', '*', ',' or a condition operator's symbol ('<', '∧', …).
type Operator = string

// Every token records the atoms it was read from.
type Token = { atomIds: string[] } & (
  | { kind: 'number'; value: number; scientific?: NumberNode['scientific'] }
  | { kind: 'identifier'; name: string }
  | { kind: 'operator'; op: Operator }
  | { kind: 'function'; name: string }
  | { kind: 'structure'; atom: StructureAtom }
  | { kind: 'unknown'; value: string }
)

const OPERATOR_SYMBOLS: Record<string, Operator> = {
  '+': '+',
  '-': '-',
  '−': '-',
  '=': '=',
  '*': '*',
  '·': '*',
  '×': '*',
  ',': ',',
  ...Object.fromEntries(CONDITION_OPERATORS.map((op) => [op.symbol, op.symbol])),
}

// Loosest first: ∨, then ⊻, then ∧.
const LOGIC_LEVELS = [
  { symbol: '∨', type: 'Or' },
  { symbol: '⊻', type: 'Xor' },
  { symbol: '∧', type: 'And' },
] as const

function tokenize(row: Row, diagnostics: ParseDiagnostic[]): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < row.length) {
    const atom = row[i]

    if (atom.kind === 'function') {
      tokens.push({ kind: 'function', name: atom.name, atomIds: [atom.id] })
      i++
      continue
    }

    // A name: a letter, then letters, digits and underscores.
    if (startsName(atom)) {
      let name = ''
      const atomIds: string[] = []
      while (i < row.length && continuesName(row[i])) {
        name += (row[i] as { value: string }).value
        atomIds.push(row[i].id)
        i++
      }

      const functionName = functionForSpelling(name)
      tokens.push(
        functionName
          ? { kind: 'function', name: functionName, atomIds }
          : { kind: 'identifier', name, atomIds },
      )
      continue
    }

    if (atom.kind !== 'symbol') {
      tokens.push({ kind: 'structure', atom, atomIds: [atom.id] })
      i++
      continue
    }

    // Digits and decimal points, perhaps with an exponent, are one number.
    const number = numberAt(row, i)
    if (number) {
      const atomIds = row.slice(number.start, number.end).map((a) => a.id)
      i = number.end

      // Number() accepts "1.", ".5" and "1e-08"; ".", "1.2.3" and "1e-0.5"
      // are malformed, and "1e999" is too big for a double.
      const value = Number(number.text)

      if (!Number.isFinite(value)) {
        const problem = Number.isNaN(value) ? 'Malformed number' : 'Number out of range'
        diagnostics.push({ message: `${problem} "${number.text}"`, atomIds })
        const fallback = Number.parseFloat(number.text)
        tokens.push({ kind: 'number', value: Number.isFinite(fallback) ? fallback : 0, atomIds })
      } else if (number.exponent !== null) {
        const scientific = { mantissa: number.mantissa, exponent: Number(number.exponent) }
        tokens.push({ kind: 'number', value, scientific, atomIds })
      } else {
        tokens.push({ kind: 'number', value, atomIds })
      }
      continue
    }

    const op = OPERATOR_SYMBOLS[atom.value]
    const atomIds = [atom.id]

    if (op) {
      tokens.push({ kind: 'operator', op, atomIds })
    } else if (/^[A-Za-z]+$/.test(atom.value)) {
      tokens.push({ kind: 'identifier', name: atom.value, atomIds })
    } else {
      tokens.push({ kind: 'unknown', value: atom.value, atomIds })
    }

    i++
  }

  return tokens
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function comparisonType(op: string) {
  if (op === '=') return 'Equal' as const
  const operator = conditionOperator(op)
  return operator?.role === 'comparison' ? operator.type : null
}

function placeholder(): AstNode {
  return { type: 'Placeholder' }
}

function parseRowInto(row: Row, diagnostics: ParseDiagnostic[]): AstNode {
  if (row.length === 0) {
    return placeholder()
  }

  return new Parser(tokenize(row, diagnostics), diagnostics).parseAll()
}

class Parser {
  private index = 0

  constructor(
    private readonly tokens: Token[],
    private readonly diagnostics: ParseDiagnostic[],
  ) {}

  parseAll(): AstNode {
    const result = this.parseLogic(0)

    // Defensive: the grammar consumes every token kind, but anything left
    // over is reported rather than silently dropped.
    while (this.peek()) {
      this.reportUnexpected(this.next()!)
    }

    return result
  }

  // or := xor ( '∨' xor )*, xor := and ( '⊻' and )*, and := not ( '∧' not )*
  private parseLogic(level: number): AstNode {
    if (level === LOGIC_LEVELS.length) return this.parseNot()

    const { symbol, type } = LOGIC_LEVELS[level]
    const children = [this.parseLogic(level + 1)]

    while (this.peekOperator(symbol)) {
      this.next()
      children.push(this.parseLogic(level + 1))
    }

    return children.length === 1 ? children[0] : { type, children }
  }

  // not := '¬' not | comparison
  private parseNot(): AstNode {
    if (this.peekOperator('¬')) {
      this.next()
      return { type: 'Not', value: this.parseNot() }
    }

    return this.parseComparison()
  }

  // comparison := additive ( ('=' | '<' | …) additive )?
  private parseComparison(): AstNode {
    let left = this.parseAdditive()
    let count = 0

    for (;;) {
      const token = this.peek()
      const type = token?.kind === 'operator' ? comparisonType(token.op) : null
      if (!token || !type) return left

      this.next()
      if (count++ > 0) {
        this.diagnostics.push({
          message: "Comparisons can't be chained: join them with ∧",
          atomIds: token.atomIds,
        })
      }
      left = { type, left, right: this.parseAdditive() }
    }
  }

  // additive := unary ( ('+' | '-') unary )*
  private parseAdditive(): AstNode {
    let left = this.parseUnary()

    for (;;) {
      if (this.peekOperator('+')) {
        this.next()
        const right = this.parseUnary()
        left =
          left.type === 'Add'
            ? { type: 'Add', children: [...left.children, right] }
            : { type: 'Add', children: [left, right] }
        continue
      }

      if (this.peekOperator('-')) {
        this.next()
        left = { type: 'Subtract', minuend: left, subtrahend: this.parseUnary() }
        continue
      }

      return left
    }
  }

  // unary := '-' unary | term
  private parseUnary(): AstNode {
    if (this.peekOperator('-')) {
      this.next()
      return { type: 'Negate', value: this.parseUnary() }
    }

    return this.parseTerm()
  }

  // term := factor ( ['*'] factor )*
  private parseTerm(): AstNode {
    const factors = [this.parseFactor()]

    for (;;) {
      this.skipInvalid()

      if (this.peekOperator('*')) {
        this.next()
        factors.push(this.parseFactor())
        continue
      }

      if (this.startsPrimary(this.peek())) {
        factors.push(this.parseFactor())
        continue
      }

      break
    }

    return factors.length === 1 ? factors[0] : { type: 'Multiply', children: factors }
  }

  // factor := primary superscript*
  private parseFactor(): AstNode {
    let base = this.parsePrimary()

    while (this.peekStructure('superscript')) {
      base = { type: 'Power', base, exponent: this.parseSuperscript() }
    }

    return base
  }

  private parseSuperscript(): AstNode {
    const token = this.next()!
    const atom = (token as { atom: StructureAtom }).atom

    return atom.kind === 'superscript' ? this.child(atom.sup) : placeholder()
  }

  private parsePrimary(): AstNode {
    this.skipInvalid()

    const token = this.peek()

    // A missing operand: start of row before an operator, "x+" at the end,
    // or a superscript with nothing before it (parseFactor then attaches the
    // superscript to this placeholder).
    if (!token || !this.startsPrimary(token)) {
      return placeholder()
    }

    this.next()

    switch (token.kind) {
      case 'number':
        return token.scientific
          ? { type: 'Number', value: token.value, scientific: token.scientific }
          : { type: 'Number', value: token.value }
      case 'identifier':
        return { type: 'Identifier', name: token.name }
      case 'function':
        return this.parseFunction(token.name)
      case 'structure':
        return this.parseStructure(token.atom)
      default:
        return placeholder()
    }
  }

  // name(args), name^n(args) or name x.
  private parseFunction(name: string): AstNode {
    const powers: AstNode[] = []

    while (this.peekStructure('superscript')) {
      powers.push(this.parseSuperscript())
    }

    let args: AstNode[]
    const next = this.peek()

    if (next?.kind === 'structure' && next.atom.kind === 'group' && next.atom.open === '(') {
      this.next()
      args = this.parseArguments(next.atom.body)
    } else if (next && this.startsPrimary(next)) {
      // "sin x": the argument is the next factor.
      args = [this.parseFactor()]
    } else {
      args = [placeholder()]
    }

    let result: AstNode = { type: 'FunctionCall', name, args }

    // sin^2(x) means (sin(x))^2.
    for (const exponent of powers) {
      result = { type: 'Power', base: result, exponent }
    }

    return result
  }

  // Split a function's bracket body at top-level commas.
  private parseArguments(body: Row): AstNode[] {
    const args: Row[] = [[]]

    for (const atom of body) {
      if (atom.kind === 'symbol' && atom.value === ',') {
        args.push([])
      } else {
        args[args.length - 1].push(atom)
      }
    }

    return args.map((arg) => this.child(arg))
  }

  private parseStructure(atom: StructureAtom): AstNode {
    switch (atom.kind) {
      case 'fraction':
        return {
          type: 'Divide',
          numerator: this.child(atom.num),
          denominator: this.child(atom.den),
        }
      case 'group':
        return atom.open === '|'
          ? { type: 'Abs', value: this.child(atom.body) }
          : { type: 'Group', value: this.child(atom.body) }
      case 'root':
        return {
          type: 'Root',
          radicand: this.child(atom.body),
          degree: atom.index ? this.child(atom.index) : null,
        }
      case 'derivative':
        return {
          type: 'Derivative',
          expression: this.child(atom.expr),
          variable: this.child(atom.variable),
        }
      case 'piecewise':
        // Prototype: the layout and caret work, but a piecewise isn't parsed
        // or exported yet.
        return placeholder()
      case 'superscript':
        // Unreachable: superscripts never start a primary (see startsPrimary).
        return { type: 'Power', base: placeholder(), exponent: this.child(atom.sup) }
    }
  }

  private child(row: Row): AstNode {
    return parseRowInto(row, this.diagnostics)
  }

  // --- token helpers -------------------------------------------------------

  private peek(): Token | undefined {
    return this.tokens[this.index]
  }

  private next(): Token | undefined {
    return this.tokens[this.index++]
  }

  private peekOperator(op: Operator): boolean {
    const token = this.peek()
    return token?.kind === 'operator' && token.op === op
  }

  private peekStructure(kind: StructureAtom['kind']): boolean {
    const token = this.peek()
    return token?.kind === 'structure' && token.atom.kind === kind
  }

  // Whether a token can begin an operand. A superscript can't: it attaches
  // to whatever precedes it.
  private startsPrimary(token: Token | undefined): boolean {
    if (!token) return false

    switch (token.kind) {
      case 'number':
      case 'identifier':
      case 'function':
        return true
      case 'structure':
        return token.atom.kind !== 'superscript'
      default:
        return false
    }
  }

  // Skip glyphs that can never start or join an expression (an unknown
  // symbol, a comma outside a function's brackets), so one stray glyph
  // doesn't hide the rest of the row.
  private skipInvalid(): void {
    while (this.peek()?.kind === 'unknown' || this.peekOperator(',')) {
      this.reportUnexpected(this.next()!)
    }
  }

  private reportUnexpected(token: Token): void {
    const text =
      token.kind === 'operator' ? token.op : token.kind === 'unknown' ? token.value : token.kind
    this.diagnostics.push({ message: `Unexpected "${text}"`, atomIds: token.atomIds })
  }
}
