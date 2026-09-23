// Layout tree (rows of atoms) -> semantic AST.
//
// The editor only ever edits rows (see layout.ts); the semantic `AstNode`
// consumed by the MathJSON / MathML / LaTeX exporters is derived here after
// every change. The parser never throws: incomplete input becomes
// `Placeholder` nodes (an empty row, a missing operand), and anything it
// cannot make sense of is skipped and reported in `diagnostics` so the UI can
// mark it later.
//
// Grammar, loosest to tightest binding:
//
//   equation  := additive ( '=' additive )*
//   additive  := unary ( ('+' | '-') unary )*
//   unary     := '-' unary | term
//   term      := factor ( ['*' | '·' | '×'] factor )*      implicit or explicit
//   factor    := primary superscript*
//   primary   := number | identifier | function | group | |abs| | fraction
//              | root | derivative
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

import type { AstNode } from '../types/ast'
import { continuesName, functionForSpelling, startsName } from './identifiers'
import type { Row, StructureAtom } from './layout'

export interface ParseDiagnostic {
  message: string
  // The atom the problem was found at, for highlighting in the UI.
  atomId: string
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

type Operator = '+' | '-' | '=' | '*' | ','

type Token =
  | { kind: 'number'; value: number; atomId: string }
  | { kind: 'identifier'; name: string; atomId: string }
  | { kind: 'operator'; op: Operator; atomId: string }
  | { kind: 'function'; name: string; atomId: string }
  | { kind: 'structure'; atom: StructureAtom; atomId: string }
  | { kind: 'unknown'; value: string; atomId: string }

const OPERATOR_SYMBOLS: Record<string, Operator> = {
  '+': '+',
  '-': '-',
  '−': '-',
  '=': '=',
  '*': '*',
  '·': '*',
  '×': '*',
  ',': ',',
}

const isDigit = (value: string) => /^[0-9]$/.test(value)
const isNumberChar = (value: string) => isDigit(value) || value === '.'

function tokenize(row: Row, diagnostics: ParseDiagnostic[]): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < row.length) {
    const atom = row[i]

    if (atom.kind === 'function') {
      tokens.push({ kind: 'function', name: atom.name, atomId: atom.id })
      i++
      continue
    }

    // A name: a letter, then letters, digits and underscores.
    if (startsName(atom)) {
      let name = ''
      while (i < row.length && continuesName(row[i])) {
        name += (row[i] as { value: string }).value
        i++
      }

      const functionName = functionForSpelling(name)
      tokens.push(
        functionName
          ? { kind: 'function', name: functionName, atomId: atom.id }
          : { kind: 'identifier', name, atomId: atom.id },
      )
      continue
    }

    if (atom.kind !== 'symbol') {
      tokens.push({ kind: 'structure', atom, atomId: atom.id })
      i++
      continue
    }

    // A run of digits and decimal points is one number.
    if (isNumberChar(atom.value)) {
      let text = ''
      const start = atom

      while (i < row.length) {
        const next = row[i]
        if (next.kind !== 'symbol' || !isNumberChar(next.value)) break
        text += next.value
        i++
      }

      // Number() accepts "1." and ".5"; "." alone or "1.2.3" are malformed.
      let value = Number(text)

      if (Number.isNaN(value)) {
        diagnostics.push({ message: `Malformed number "${text}"`, atomId: start.id })
        value = Number.parseFloat(text) || 0
      }

      tokens.push({ kind: 'number', value, atomId: start.id })
      continue
    }

    const op = OPERATOR_SYMBOLS[atom.value]

    if (op) {
      tokens.push({ kind: 'operator', op, atomId: atom.id })
    } else if (/^[A-Za-z]+$/.test(atom.value)) {
      tokens.push({ kind: 'identifier', name: atom.value, atomId: atom.id })
    } else {
      tokens.push({ kind: 'unknown', value: atom.value, atomId: atom.id })
    }

    i++
  }

  return tokens
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

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
    const result = this.parseEquation()

    // Defensive: the grammar consumes every token kind, but anything left
    // over is reported rather than silently dropped.
    while (this.peek()) {
      this.reportUnexpected(this.next()!)
    }

    return result
  }

  // equation := additive ( '=' additive )*
  private parseEquation(): AstNode {
    let left = this.parseAdditive()

    while (this.peekOperator('=')) {
      this.next()
      left = { type: 'Equal', left, right: this.parseAdditive() }
    }

    return left
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
        return { type: 'Number', value: token.value }
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
    this.diagnostics.push({ message: `Unexpected "${text}"`, atomId: token.atomId })
  }
}
