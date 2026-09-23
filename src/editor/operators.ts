// Comparison and logical operators, for conditions (as in a piecewise
// function's cases): x < 1, x ≥ 0 ∧ y ≠ 2, ¬(x > 0).
//
// Each is one symbol atom, drawn as the mathematical symbol, never as a
// word, so conditions read as maths rather than code. They are typed as keys
// where there's an obvious one (< > & !), as two keys that combine (<= >=
// !=), or as \ commands (\le, \and, \not, …). This table is the one place
// that lists them; the parser, renderers, clipboard and keymap all read it.

export type ComparisonType = 'Less' | 'Greater' | 'LessEqual' | 'GreaterEqual' | 'NotEqual'
export type LogicType = 'And' | 'Or' | 'Xor'

export interface ComparisonOperator {
  role: 'comparison'
  symbol: string
  type: ComparisonType
}

export interface LogicOperator {
  role: 'logic'
  symbol: string
  type: LogicType
}

export interface NotOperator {
  role: 'not'
  symbol: string
  type: 'Not'
}

export type ConditionOperator = (ComparisonOperator | LogicOperator | NotOperator) & {
  // LaTeX for the symbol (also used when copying as LaTeX).
  latex: string
  // Content MathML element name.
  mathml: string
  // \ commands that insert it (also read when pasting LaTeX).
  commands: readonly string[]
}

export const CONDITION_OPERATORS: readonly ConditionOperator[] = [
  { role: 'comparison', symbol: '<', type: 'Less', latex: '<', mathml: 'lt', commands: ['lt'] },
  { role: 'comparison', symbol: '>', type: 'Greater', latex: '>', mathml: 'gt', commands: ['gt'] },
  {
    role: 'comparison',
    symbol: '≤',
    type: 'LessEqual',
    latex: '\\leq',
    mathml: 'leq',
    commands: ['le', 'leq'],
  },
  {
    role: 'comparison',
    symbol: '≥',
    type: 'GreaterEqual',
    latex: '\\geq',
    mathml: 'geq',
    commands: ['ge', 'geq'],
  },
  {
    role: 'comparison',
    symbol: '≠',
    type: 'NotEqual',
    latex: '\\neq',
    mathml: 'neq',
    commands: ['ne', 'neq'],
  },
  {
    role: 'logic',
    symbol: '∧',
    type: 'And',
    latex: '\\land',
    mathml: 'and',
    commands: ['and', 'land', 'wedge'],
  },
  {
    role: 'logic',
    symbol: '∨',
    type: 'Or',
    latex: '\\lor',
    mathml: 'or',
    commands: ['or', 'lor', 'vee'],
  },
  {
    role: 'logic',
    symbol: '⊻',
    type: 'Xor',
    latex: '\\veebar',
    mathml: 'xor',
    commands: ['xor', 'veebar'],
  },
  {
    role: 'not',
    symbol: '¬',
    type: 'Not',
    latex: '\\lnot',
    mathml: 'not',
    commands: ['not', 'lnot', 'neg'],
  },
]

const BY_SYMBOL = new Map(CONDITION_OPERATORS.map((op) => [op.symbol, op]))
const BY_TYPE = new Map<string, ConditionOperator>(CONDITION_OPERATORS.map((op) => [op.type, op]))
const BY_COMMAND = new Map(
  CONDITION_OPERATORS.flatMap((op) => op.commands.map((command) => [command, op] as const)),
)

export const conditionOperator = (symbol: string) => BY_SYMBOL.get(symbol)
export const conditionOperatorOfType = (type: string) => BY_TYPE.get(type)
export const conditionOperatorForCommand = (name: string) => BY_COMMAND.get(name)

// Typed "<" then "=" makes "≤", and likewise ">=" and "!=" (where "!" types
// "¬"). The symbol the pair becomes, if the first one combines with "=".
const COMBINES_WITH_EQUALS: Record<string, string> = { '<': '≤', '>': '≥', '¬': '≠' }

export const combinedWithEquals = (symbol: string): string | undefined =>
  COMBINES_WITH_EQUALS[symbol]

// Keys that type a condition operator directly: "&" types ∧ and "!" types ¬.
export const KEY_SYMBOLS: Record<string, string> = { '<': '<', '>': '>', '&': '∧', '!': '¬' }
