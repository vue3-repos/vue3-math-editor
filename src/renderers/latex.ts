import type { AstNode } from '../types/ast'

function assertNever(value: never): never {
  throw new Error(`Unknown AST node: ${JSON.stringify(value)}`)
}

export function astToLatex(node: AstNode): string {
  switch (node.type) {
    case 'Number':
      return String(node.value)

    case 'Identifier':
      return node.name

    case 'Add':
      return `${astToLatex(node.left)} + ${astToLatex(node.right)}`

    case 'Multiply':
      return `${astToLatex(node.left)} ${astToLatex(node.right)}`

    case 'Equal':
      return `${astToLatex(node.left)} = ${astToLatex(node.right)}`

    case 'Divide':
      return `\\frac{${astToLatex(node.numerator)}}{${astToLatex(node.denominator)}}`

    case 'Power':
      return `${astToLatex(node.base)}^{${astToLatex(node.exponent)}}`

    case 'Derivative':
      return `\\frac{d(${astToLatex(node.expression)})}{d${node.variable}}`

    case 'Placeholder':
      return '\\square'

    default:
      return assertNever(node)
  }
}
