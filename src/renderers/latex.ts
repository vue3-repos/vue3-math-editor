import type { AstNode } from '../types/ast'
import { getFunctionDefinition } from '../registry/nodes'

function assertNever(value: never): never {
  throw new Error(`Unknown AST node: ${JSON.stringify(value)}`)
}

function needsParentheses(node: AstNode): boolean {
  return (
    node.type === 'Add' ||
    node.type === 'Subtract' ||
    node.type === 'Equal' ||
    node.type === 'Multiply'
  )
}

function renderWrapped(node: AstNode): string {
  const latex = astToLatex(node)
  return needsParentheses(node) ? `(${latex})` : latex
}

export function astToLatex(node: AstNode): string {
  switch (node.type) {
    case 'Number':
      return String(node.value)

    case 'Identifier':
      return node.name

    case 'Add':
      return node.children.map(astToLatex).join(' + ')

    case 'Multiply':
      return node.children.map((child) => renderWrapped(child)).join(' * ')

    case 'Subtract':
      return `${renderWrapped(node.minuend)} - ${renderWrapped(node.subtrahend)}`

    case 'Negate':
      return `-${renderWrapped(node.value)}`

    case 'Abs':
      return `\\left|${astToLatex(node.value)}\\right|`

    case 'Root':
      return node.degree
        ? `\\sqrt[${astToLatex(node.degree)}]{${astToLatex(node.radicand)}}`
        : `\\sqrt{${astToLatex(node.radicand)}}`

    case 'FunctionCall': {
      const definition = getFunctionDefinition(node.name)
      const renderedArgs = node.args.map(astToLatex).join(', ')

      if (definition) {
        return `\\${definition.latexName}(${renderedArgs})`
      }

      return `\\operatorname{${node.name}}(${renderedArgs})`
    }

    case 'Equal':
      return `${astToLatex(node.left)} = ${astToLatex(node.right)}`

    case 'Divide':
      return `\\frac{${astToLatex(node.numerator)}}{${astToLatex(node.denominator)}}`

    case 'Power':
      return `${renderWrapped(node.base)}^{${astToLatex(node.exponent)}}`

    case 'Derivative':
      return `\\frac{d(${astToLatex(node.expression)})}{d${node.variable}}`

    case 'Placeholder':
      return '\\square'

    default:
      return assertNever(node)
  }
}
