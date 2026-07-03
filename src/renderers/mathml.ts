import type { AstNode } from '../types/ast'

function assertNever(value: never): never {
  throw new Error(`Unsupported AST node: ${JSON.stringify(value)}`)
}

export function astToContentMathML(node: AstNode): string {
  switch (node.type) {
    case 'Number':
      return `<cn>${node.value}</cn>`

    case 'Identifier':
      return `<ci>${node.name}</ci>`

    case 'Add':
      return `
        <apply>
          <plus/>
          ${astToContentMathML(node.left)}
          ${astToContentMathML(node.right)}
        </apply>
      `

    case 'Divide':
      return `
        <apply>
          <divide/>
          ${astToContentMathML(node.numerator)}
          ${astToContentMathML(node.denominator)}
        </apply>
      `

    case 'Multiply':
      return `
        <apply>
          <times/>
          ${astToContentMathML(node.left)}
          ${astToContentMathML(node.right)}
        </apply>
      `

    case 'Equal':
      return `
        <apply>
          <eq/>
          ${astToContentMathML(node.left)}
          ${astToContentMathML(node.right)}
        </apply>
      `

    case 'Power':
      return `
        <apply>
          <power/>
          ${astToContentMathML(node.base)}
          ${astToContentMathML(node.exponent)}
        </apply>
      `

    case 'Derivative':
      return `
        <apply>
          <diff/>
          <bvar>
            <ci>${node.variable}</ci>
          </bvar>
          ${astToContentMathML(node.expression)}
        </apply>
      `

    case 'Placeholder':
      return `<ci>_</ci>`

    default:
      return assertNever(node)
  }
}
