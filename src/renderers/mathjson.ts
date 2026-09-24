import { constantForSymbol } from '../editor/constants'
import { getFunctionDefinition } from '../registry/nodes'
import type { AstNode } from '../types/ast'

export type MathJsonValue =
  | number
  | string
  | null
  | MathJsonValue[]
  | { [key: string]: MathJsonValue }

function functionNameToOperator(name: string): string {
  return getFunctionDefinition(name)?.mathJson ?? name
}

export function astToMathJson(node: AstNode): MathJsonValue {
  switch (node.type) {
    case 'Number':
      return node.value

    case 'Identifier':
      return node.name

    case 'Constant':
      return constantForSymbol(node.name)!.mathJson

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
    case 'Less':
    case 'Greater':
    case 'LessEqual':
    case 'GreaterEqual':
    case 'NotEqual':
      return [node.type, astToMathJson(node.left), astToMathJson(node.right)]

    case 'And':
    case 'Or':
    case 'Xor':
      return [node.type, ...node.children.map(astToMathJson)]

    case 'Not':
      return ['Not', astToMathJson(node.value)]

    // ["Which", condition₀, value₀, …, "True", otherwise]
    case 'Piecewise':
      return [
        'Which',
        ...node.pieces.flatMap(({ value, condition }) => [
          astToMathJson(condition),
          astToMathJson(value),
        ]),
        ...(node.otherwise ? ['True', astToMathJson(node.otherwise)] : []),
      ]

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
