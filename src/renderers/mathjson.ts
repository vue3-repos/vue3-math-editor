import type { AstNode } from '../types/ast'

export type MathJsonValue =
  | number
  | string
  | null
  | MathJsonValue[]
  | { [key: string]: MathJsonValue }

const FUNCTION_OPERATOR_MAP: Record<string, string> = {
  exp: 'Exp',
  log: 'Log',
  ln: 'Ln',
  sin: 'Sin',
  cos: 'Cos',
  tan: 'Tan',
  sec: 'Sec',
  csc: 'Csc',
  cot: 'Cot',
  asin: 'Arcsin',
  acos: 'Arccos',
  atan: 'Arctan',
  sinh: 'Sinh',
  cosh: 'Cosh',
  tanh: 'Tanh',
}

function functionNameToOperator(name: string): string {
  return FUNCTION_OPERATOR_MAP[name.toLowerCase()] ?? name
}

export function astToMathJson(node: AstNode): MathJsonValue {
  switch (node.type) {
    case 'Number':
      return node.value

    case 'Identifier':
      return node.name

    case 'Add':
      return ['Add', ...node.children.map(astToMathJson)]

    case 'Multiply':
      return ['Multiply', ...node.children.map(astToMathJson)]

    case 'Subtract':
      return ['Subtract', astToMathJson(node.minuend), astToMathJson(node.subtrahend)]

    case 'Negate':
      return ['Negate', astToMathJson(node.value)]

    case 'Abs':
      return ['Abs', astToMathJson(node.value)]

    // Explicit brackets are purely presentational; export the content.
    case 'Group':
      return astToMathJson(node.value)

    case 'Root':
      return node.degree
        ? ['Root', astToMathJson(node.radicand), astToMathJson(node.degree)]
        : ['Sqrt', astToMathJson(node.radicand)]

    case 'FunctionCall': {
      const op = functionNameToOperator(node.name)
      return [op, ...node.args.map(astToMathJson)]
    }

    case 'Equal':
      return ['Equal', astToMathJson(node.left), astToMathJson(node.right)]

    case 'Divide':
      return ['Divide', astToMathJson(node.numerator), astToMathJson(node.denominator)]

    case 'Power':
      return ['Power', astToMathJson(node.base), astToMathJson(node.exponent)]

    case 'Derivative':
      return ['Derivative', astToMathJson(node.expression), astToMathJson(node.variable)]

    case 'Placeholder':
      return ['Missing']

    default:
      return null
  }
}

export function renderMathJson(node: AstNode): string {
  return JSON.stringify(astToMathJson(node), null, 2)
}
