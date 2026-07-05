import type { AstNode } from '../types/ast'

export type AstNodeType = AstNode['type']

export interface NodeDefinition {
  type: AstNodeType
  label: string
  childCollections: readonly string[]
  kind: 'leaf' | 'operator' | 'function' | 'wrapper' | 'placeholder'
}

export interface FunctionDefinition {
  name: string
  latexName: string
  mathMlTag?: string
  minArgs: number
  maxArgs: number | 'variadic'
}

export const NODE_REGISTRY: Record<AstNodeType, NodeDefinition> = {
  Number: { type: 'Number', label: 'Number', childCollections: [], kind: 'leaf' },
  Identifier: { type: 'Identifier', label: 'Identifier', childCollections: [], kind: 'leaf' },
  Add: { type: 'Add', label: 'Addition', childCollections: ['children'], kind: 'operator' },
  Multiply: {
    type: 'Multiply',
    label: 'Multiplication',
    childCollections: ['children'],
    kind: 'operator',
  },
  Subtract: {
    type: 'Subtract',
    label: 'Subtraction',
    childCollections: ['minuend', 'subtrahend'],
    kind: 'operator',
  },
  Negate: { type: 'Negate', label: 'Negation', childCollections: ['value'], kind: 'operator' },
  Abs: { type: 'Abs', label: 'Absolute Value', childCollections: ['value'], kind: 'wrapper' },
  Root: {
    type: 'Root',
    label: 'Root',
    childCollections: ['radicand', 'degree'],
    kind: 'wrapper',
  },
  FunctionCall: {
    type: 'FunctionCall',
    label: 'Function Call',
    childCollections: ['args'],
    kind: 'function',
  },
  Equal: {
    type: 'Equal',
    label: 'Equality',
    childCollections: ['left', 'right'],
    kind: 'operator',
  },
  Divide: {
    type: 'Divide',
    label: 'Division',
    childCollections: ['numerator', 'denominator'],
    kind: 'operator',
  },
  Power: {
    type: 'Power',
    label: 'Power',
    childCollections: ['base', 'exponent'],
    kind: 'operator',
  },
  Derivative: {
    type: 'Derivative',
    label: 'Derivative',
    childCollections: ['expression'],
    kind: 'wrapper',
  },
  Placeholder: {
    type: 'Placeholder',
    label: 'Placeholder',
    childCollections: [],
    kind: 'placeholder',
  },
}

export const FUNCTION_REGISTRY: Record<string, FunctionDefinition> = {
  exp: { name: 'exp', latexName: 'exp', mathMlTag: 'exp', minArgs: 1, maxArgs: 1 },
  log: { name: 'log', latexName: 'log', mathMlTag: 'log', minArgs: 1, maxArgs: 2 },
  ln: { name: 'ln', latexName: 'ln', mathMlTag: 'ln', minArgs: 1, maxArgs: 1 },
  sin: { name: 'sin', latexName: 'sin', mathMlTag: 'sin', minArgs: 1, maxArgs: 1 },
  cos: { name: 'cos', latexName: 'cos', mathMlTag: 'cos', minArgs: 1, maxArgs: 1 },
  tan: { name: 'tan', latexName: 'tan', mathMlTag: 'tan', minArgs: 1, maxArgs: 1 },
  sec: { name: 'sec', latexName: 'sec', mathMlTag: 'sec', minArgs: 1, maxArgs: 1 },
  csc: { name: 'csc', latexName: 'csc', mathMlTag: 'csc', minArgs: 1, maxArgs: 1 },
  cot: { name: 'cot', latexName: 'cot', mathMlTag: 'cot', minArgs: 1, maxArgs: 1 },
  asin: { name: 'asin', latexName: 'arcsin', mathMlTag: 'arcsin', minArgs: 1, maxArgs: 1 },
  acos: { name: 'acos', latexName: 'arccos', mathMlTag: 'arccos', minArgs: 1, maxArgs: 1 },
  atan: { name: 'atan', latexName: 'arctan', mathMlTag: 'arctan', minArgs: 1, maxArgs: 1 },
  sinh: { name: 'sinh', latexName: 'sinh', mathMlTag: 'sinh', minArgs: 1, maxArgs: 1 },
  cosh: { name: 'cosh', latexName: 'cosh', mathMlTag: 'cosh', minArgs: 1, maxArgs: 1 },
  tanh: { name: 'tanh', latexName: 'tanh', mathMlTag: 'tanh', minArgs: 1, maxArgs: 1 },
}

export function getFunctionDefinition(name: string): FunctionDefinition | null {
  return FUNCTION_REGISTRY[name.toLowerCase()] ?? null
}
