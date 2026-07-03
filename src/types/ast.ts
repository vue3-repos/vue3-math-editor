export type AstNode =
  | NumberNode
  | IdentifierNode
  | AddNode
  | MultiplyNode
  | DivideNode
  | PowerNode
  | DerivativeNode
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
  left: AstNode
  right: AstNode
}

export interface MultiplyNode {
  type: 'Multiply'
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

export interface DerivativeNode {
  type: 'Derivative'
  expression: AstNode
  variable: string
}
