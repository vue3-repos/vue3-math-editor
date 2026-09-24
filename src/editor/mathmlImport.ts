// Reading Content MathML (as CellML writes it) into equations: the inverse of
// the Content MathML export (renderers/mathml.ts). Each child of <math> is
// one equation, built as the layout rows the user would have typed, with
// brackets only where the editor's grammar needs them (parse.ts). A number's
// cellml:units become its (hidden) units; dimensionless is the default, so it
// is left off. Variables' units aren't in the maths, so they come separately.
//
// Anything the editor can't write (an element outside CellML's MathML subset,
// a second-order derivative, …) becomes an empty slot, and is reported.

import { CONSTANTS } from './constants'
import { functionForSpelling, reservedConstant } from './identifiers'
import { nameAtoms } from './names'
import {
  type Atom,
  type GroupDelimiter,
  type Row,
  derivative,
  fraction,
  func,
  group,
  piecewise,
  root,
  row,
  superscript,
  symbol,
  unitsAtom,
} from './layout'
import { CONDITION_OPERATORS } from './operators'
import { FUNCTION_REGISTRY, bracketsForFunction } from '../registry/nodes'

export interface MathMLImport {
  // One row per equation (or expression), in order.
  equations: Row[]
  // What couldn't be read as written, once each.
  problems: string[]
}

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'
const CELLML_NS = 'http://www.cellml.org/cellml/2.0#'

// Whether pasted text is Content MathML (rather than LaTeX or plain text).
export function looksLikeContentMathML(text: string): boolean {
  return /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<([A-Za-z_][\w.-]*:)?(math|apply|piecewise|ci|cn)\b/.test(
    text,
  )
}

// The equations in Content MathML text, or null if it isn't well-formed XML.
export function importContentMathML(text: string): MathMLImport | null {
  // Wrapped so that fragments (a bare <apply>, or cellml:units without the
  // namespace declared) read as they would inside a CellML model.
  const body = text.replace(/^\s*<\?xml[^>]*\?>/, '')
  const wrapped = `<wrapper xmlns="${MATHML_NS}" xmlns:cellml="${CELLML_NS}">${body}</wrapper>`
  const doc = new DOMParser().parseFromString(wrapped, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return null

  const problems = new Set<string>()
  const reader = new Reader(problems)
  const top = doc.documentElement
  const maths = elements(top).filter((el) => el.localName === 'math')
  const equations = (maths.length ? maths.flatMap(elements) : elements(top)).map(
    (el) => reader.expression(el).row,
  )

  return { equations, problems: [...problems] }
}

const elements = (el: Element): Element[] => Array.from(el.children)

// How tightly an expression binds, loosest first, as parse.ts reads rows.
const Level = {
  Or: 1,
  Xor: 2,
  And: 3,
  Not: 4,
  Comparison: 5,
  Additive: 6,
  Unary: 7,
  Term: 8,
  Primary: 9,
} as const
type Binding = (typeof Level)[keyof typeof Level]

interface Written {
  row: Row
  level: Binding
}

const LOGIC: Record<string, { symbol: string; level: Binding }> = {
  or: { symbol: '∨', level: Level.Or },
  xor: { symbol: '⊻', level: Level.Xor },
  and: { symbol: '∧', level: Level.And },
}

const COMPARISONS = new Map(
  CONDITION_OPERATORS.filter((op) => op.role === 'comparison').map((op) => [op.mathml, op.symbol]),
)
const CONSTANT_ELEMENTS = new Map(CONSTANTS.map((constant) => [constant.mathml, constant.symbol]))
const FUNCTIONS = new Map(Object.values(FUNCTION_REGISTRY).map((f) => [f.mathMlTag, f.name]))

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

class Reader {
  constructor(private readonly problems: Set<string>) {}

  expression(el: Element): Written {
    switch (el.localName) {
      case 'ci':
        return this.identifier(el)
      case 'cn':
        return this.number(el)
      case 'apply':
        return this.apply(el)
      case 'piecewise':
        return this.piecewise(el)
      default: {
        const constant = CONSTANT_ELEMENTS.get(el.localName)
        if (constant) return primary([symbol(constant)])
        return this.unsupported(`<${el.localName}>`)
      }
    }
  }

  // An empty slot where something couldn't be read.
  private unsupported(what: string): Written {
    this.problems.add(`${what} isn't supported; it was left as an empty slot`)
    return primary([group([])])
  }

  private identifier(el: Element): Written {
    const name = (el.textContent ?? '').trim()
    if (!NAME.test(name)) {
      this.problems.add(`"${name}" isn't a CellML variable name`)
      return primary(row(name))
    }
    if (functionForSpelling(name)) {
      this.problems.add(`The variable ${name} has the name of a function, so it reads as one here`)
    } else if (reservedConstant(name)) {
      this.problems.add(
        `The variable ${name} has a reserved name, so it reads as the constant here`,
      )
    }
    // In its settled form: Greek words as the letters (alpha_m as α_m).
    return primary(nameAtoms(name))
  }

  private number(el: Element): Written {
    const units = unitsOf(el)
    let text: string
    if (el.getAttribute('type') === 'e-notation') {
      const sep = elements(el).find((child) => child.localName === 'sep')
      const mantissa = sep ? textBefore(el, sep) : (el.textContent ?? '')
      const exponent = sep ? textAfter(el, sep) : '0'
      text = `${mantissa.trim()}e${exponent.trim()}`
    } else {
      text = (el.textContent ?? '').trim()
    }

    const negative = text.startsWith('-')
    const digits = negative ? text.slice(1) : text.replace(/^\+/, '')
    if (!/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(digits)) {
      this.problems.add(`"${text}" isn't a number`)
    }

    const atoms: Row = row(digits)
    if (units && units !== 'dimensionless') {
      if (!NAME.test(units)) this.problems.add(`"${units}" isn't a units name`)
      atoms.push(unitsAtom(row(units)))
    }
    return negative ? { row: [symbol('-'), ...atoms], level: Level.Unary } : primary(atoms)
  }

  private apply(el: Element): Written {
    const [operator, ...rest] = elements(el)
    if (!operator) return this.unsupported('An empty <apply>')
    const qualifiers = rest.filter((child) => QUALIFIERS.has(child.localName))
    const operands = rest.filter((child) => !QUALIFIERS.has(child.localName))
    const args = () => operands.map((child) => this.expression(child))
    const tag = operator.localName

    if (tag === 'eq' || COMPARISONS.has(tag)) {
      const [left, right] = args()
      if (!left || !right || operands.length !== 2)
        return this.unsupported(`<${tag}> without two operands`)
      const op = tag === 'eq' ? '=' : COMPARISONS.get(tag)!
      return {
        row: [...bracket(left, Level.Additive), symbol(op), ...bracket(right, Level.Additive)],
        level: Level.Comparison,
      }
    }

    if (LOGIC[tag]) {
      const { symbol: op, level } = LOGIC[tag]
      return { row: joined(args(), op, level), level }
    }

    switch (tag) {
      case 'not': {
        const [value] = args()
        if (!value) return this.unsupported('<not> without an operand')
        return { row: [symbol('¬'), ...bracket(value, Level.Not)], level: Level.Not }
      }
      case 'plus':
        return { row: joined(args(), '+', Level.Additive), level: Level.Additive }
      case 'minus': {
        const parts = args()
        if (parts.length === 1) {
          return { row: [symbol('-'), ...bracket(parts[0], Level.Term)], level: Level.Unary }
        }
        if (parts.length !== 2) return this.unsupported('<minus> with more than two operands')
        const [left, right] = parts
        return {
          row: [...bracket(left, Level.Additive), symbol('-'), ...bracket(right, Level.Term)],
          level: Level.Additive,
        }
      }
      case 'times':
        return { row: joined(args(), '·', Level.Term), level: Level.Term }
      case 'divide': {
        const [num, den] = args()
        if (!num || !den) return this.unsupported('<divide> without two operands')
        return primary([fraction(num.row, den.row)])
      }
      case 'power': {
        const [base, exponent] = args()
        if (!base || !exponent) return this.unsupported('<power> without two operands')
        return primary([...bracket(base, Level.Primary), superscript(exponent.row)])
      }
      case 'root': {
        const [radicand] = args()
        if (!radicand) return this.unsupported('<root> without an operand')
        const degree = qualifier(qualifiers, 'degree')
        const index = degree ? this.inner(degree) : null
        return primary([root(radicand.row, index)])
      }
      case 'abs': {
        const [value] = args()
        if (!value) return this.unsupported('<abs> without an operand')
        return primary([group(value.row, '|')])
      }
      case 'diff':
        return this.derivative(qualifiers, operands)
      default:
        return this.functionCall(tag, qualifiers, args())
    }
  }

  private functionCall(tag: string, qualifiers: Element[], args: Written[]): Written {
    const name = FUNCTIONS.get(tag)
    if (!name) return this.unsupported(`<${tag}>`)
    if (args.length === 0) return this.unsupported(`<${tag}> without an operand`)

    const brackets = bracketsForFunction(name)
    if (brackets && args.length === 1) {
      return primary([
        group(args[0].row, brackets.open as GroupDelimiter, brackets.close as GroupDelimiter),
      ])
    }

    // log with a base: log(x, b), as the editor writes it.
    const base = tag === 'log' ? qualifier(qualifiers, 'logbase') : undefined
    const all = base ? [args[0], { row: this.inner(base), level: Level.Primary }] : args
    const inside = all.flatMap((arg, i) => (i === 0 ? arg.row : [symbol(','), ...arg.row]))
    return primary([func(name), group(inside)])
  }

  private derivative(qualifiers: Element[], operands: Element[]): Written {
    const bvar = qualifier(qualifiers, 'bvar')
    const [expression] = operands
    if (!bvar || !expression) return this.unsupported('<diff> without <bvar> and an operand')
    const variable = elements(bvar).find((child) => child.localName === 'ci')
    const degree = elements(bvar).find((child) => child.localName === 'degree')
    if (degree && (degree.textContent ?? '').trim() !== '1') {
      return this.unsupported('A derivative of order other than 1')
    }
    if (!variable) return this.unsupported('<bvar> without a <ci>')
    return primary([derivative(this.expression(expression).row, this.expression(variable).row)])
  }

  private piecewise(el: Element): Written {
    const pieces: Array<[Row, Row]> = []
    let otherwise: Row | null = null
    for (const child of elements(el)) {
      const [first, second] = elements(child)
      if (child.localName === 'piece' && first && second) {
        pieces.push([this.expression(first).row, this.expression(second).row])
      } else if (child.localName === 'otherwise' && first) {
        otherwise = this.expression(first).row
      } else {
        this.problems.add(`<${child.localName}> in <piecewise> isn't supported; it was left out`)
      }
    }
    if (pieces.length === 0) return this.unsupported('A <piecewise> without a <piece>')
    return primary([piecewise(pieces, otherwise)])
  }

  // The expression inside a qualifier (<degree>, <logbase>).
  private inner(el: Element): Row {
    const [child] = elements(el)
    return child ? this.expression(child).row : []
  }
}

const QUALIFIERS = new Set(['bvar', 'degree', 'logbase'])

const qualifier = (qualifiers: Element[], name: string) =>
  qualifiers.find((el) => el.localName === name)

const primary = (atoms: Row): Written => ({ row: atoms, level: Level.Primary })

// The expression's row, bracketed if it binds more loosely than `least`.
function bracket(written: Written, least: Binding): Row {
  return written.level < least ? [group(written.row)] : written.row
}

// Operands joined by an operator, each bracketed if looser than it.
function joined(parts: Written[], op: string, level: Binding): Row {
  const atoms: Atom[] = []
  parts.forEach((part, index) => {
    if (index > 0) atoms.push(symbol(op))
    // A negative operand needs no brackets after + (a+-b), nor first in a
    // product: -0.1·x reads as -(0.1·x), which is the same value.
    const unary = part.level === Level.Unary
    const least =
      unary && ((op === '+' && index > 0) || (op === '·' && index === 0)) ? Level.Unary : level
    atoms.push(...bracket(part, least))
  })
  return atoms
}

// A <cn>'s cellml:units, whichever CellML version's namespace declares it.
function unitsOf(el: Element): string | null {
  for (const attribute of Array.from(el.attributes)) {
    if (
      attribute.localName === 'units' &&
      (attribute.prefix === 'cellml' || attribute.namespaceURI?.includes('cellml.org'))
    ) {
      return attribute.value.trim()
    }
  }
  return null
}

function textBefore(el: Element, marker: Element): string {
  let text = ''
  for (const node of Array.from(el.childNodes)) {
    if (node === marker) break
    text += node.textContent ?? ''
  }
  return text
}

function textAfter(el: Element, marker: Element): string {
  let text = ''
  let after = false
  for (const node of Array.from(el.childNodes)) {
    if (after) text += node.textContent ?? ''
    if (node === marker) after = true
  }
  return text
}
