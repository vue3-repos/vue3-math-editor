export type AstNode =
  | NumberNode
  | IdentifierNode
  | ConstantNode
  | AddNode
  | MultiplyNode
  | SubtractNode
  | NegateNode
  | AbsNode
  | RootNode
  | FunctionCallNode
  | EqualNode
  | ComparisonNode
  | LogicNode
  | NotNode
  | PiecewiseNode
  | DivideNode
  | PowerNode
  | DerivativeNode
  | GroupNode
  | PlaceholderNode

export interface NumberNode {
  type: 'Number'
  value: number
  // Written in scientific notation ("1e-08"): the mantissa as typed and the
  // exponent, for exporters that keep the notation (Content MathML's
  // e-notation). `value` is the number itself (1e-8).
  scientific?: { mantissa: string; exponent: number }
}

export interface PlaceholderNode {
  type: 'Placeholder'
}

// π, e, ∞, NaN, true, false (see editor/constants.ts); name is the constant's
// symbol: 'pi', 'exponentiale', 'infinity', 'notanumber', 'true', 'false'.
export interface ConstantNode {
  type: 'Constant'
  name: string
}

export interface IdentifierNode {
  type: 'Identifier'
  name: string
}

export interface AddNode {
  type: 'Add'
  children: AstNode[]
}

export interface MultiplyNode {
  type: 'Multiply'
  children: AstNode[]
}

export interface SubtractNode {
  type: 'Subtract'
  minuend: AstNode
  subtrahend: AstNode
}

export interface NegateNode {
  type: 'Negate'
  value: AstNode
}

export interface AbsNode {
  type: 'Abs'
  value: AstNode
}

export interface RootNode {
  type: 'Root'
  radicand: AstNode
  degree: AstNode | null
}

export interface FunctionCallNode {
  type: 'FunctionCall'
  name: string
  args: AstNode[]
}

export interface EqualNode {
  type: 'Equal'
  left: AstNode
  right: AstNode
}

// x < y, x ≤ y, … (see editor/operators.ts). Equality is EqualNode.
export interface ComparisonNode {
  type: 'Less' | 'Greater' | 'LessEqual' | 'GreaterEqual' | 'NotEqual'
  left: AstNode
  right: AstNode
}

// a ∧ b ∧ c, a ∨ b, a ⊻ b: flat, like Add.
export interface LogicNode {
  type: 'And' | 'Or' | 'Xor'
  children: AstNode[]
}

// ¬a
export interface NotNode {
  type: 'Not'
  value: AstNode
}

// { value₀ if condition₀; …; otherwise }
export interface PiecewiseNode {
  type: 'Piecewise'
  pieces: Array<{ value: AstNode; condition: AstNode }>
  otherwise: AstNode | null
}

export interface DivideNode {
  type: 'Divide'
  numerator: AstNode
  denominator: AstNode
}

export interface PowerNode {
  type: 'Power'
  base: AstNode
  exponent: AstNode
}

// Explicit brackets entered by the user. Purely presentational grouping: the
// semantic exporters (MathJSON, Content MathML) pass straight through to the
// wrapped value.
export interface GroupNode {
  type: 'Group'
  value: AstNode
}

export interface DerivativeNode {
  type: 'Derivative'
  expression: AstNode
  variable: AstNode
}
