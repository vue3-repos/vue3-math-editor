export type AstNode =
  | NumberNode
  | IdentifierNode
  | AddNode
  | MultiplyNode
  | SubtractNode
  | NegateNode
  | AbsNode
  | RootNode
  | FunctionCallNode
  | EqualNode
  | DivideNode
  | PowerNode
  | DerivativeNode
  | GroupNode
  | PlaceholderNode

export interface NumberNode {
  type: 'Number'
  value: number
}

export interface PlaceholderNode {
  type: 'Placeholder'
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
