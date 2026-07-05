import type { AstNode } from '../types/ast'
import { getFunctionDefinition } from '../registry/nodes'

function assertNever(value: never): never {
  throw new Error(`Unsupported AST node: ${JSON.stringify(value)}`)
}

function renderApply(operator: string, children: string[]): string {
  return `
    <apply>
      <${operator}/>
      ${children.join('\n      ')}
    </apply>
  `
}

export function astToContentMathML(node: AstNode): string {
  switch (node.type) {
    case 'Number':
      return `<cn>${node.value}</cn>`

    case 'Identifier':
      return `<ci>${node.name}</ci>`

    case 'Add':
      return renderApply('plus', node.children.map(astToContentMathML))

    case 'Multiply':
      return renderApply('times', node.children.map(astToContentMathML))

    case 'Subtract':
      return renderApply('minus', [
        astToContentMathML(node.minuend),
        astToContentMathML(node.subtrahend),
      ])

    case 'Negate':
      return renderApply('minus', [astToContentMathML(node.value)])

    case 'Abs':
      return renderApply('abs', [astToContentMathML(node.value)])

    case 'Root':
      return node.degree
        ? `
            <apply>
              <root/>
              <degree>
                ${astToContentMathML(node.degree)}
              </degree>
              ${astToContentMathML(node.radicand)}
            </apply>
          `
        : renderApply('root', [astToContentMathML(node.radicand)])

    case 'FunctionCall': {
      const definition = getFunctionDefinition(node.name)
      const renderedArgs = node.args.map(astToContentMathML)

      if (definition?.mathMlTag) {
        if (definition.mathMlTag === 'log' && renderedArgs.length === 2) {
          return `
            <apply>
              <log/>
              <logbase>
                ${renderedArgs[1]}
              </logbase>
              ${renderedArgs[0]}
            </apply>
          `
        }

        return renderApply(definition.mathMlTag, renderedArgs)
      }

      return `
        <apply>
          <ci>${node.name}</ci>
          ${renderedArgs.join('\n          ')}
        </apply>
      `
    }

    case 'Divide':
      return renderApply('divide', [
        astToContentMathML(node.numerator),
        astToContentMathML(node.denominator),
      ])

    case 'Equal':
      return renderApply('eq', [astToContentMathML(node.left), astToContentMathML(node.right)])

    case 'Power':
      return renderApply('power', [
        astToContentMathML(node.base),
        astToContentMathML(node.exponent),
      ])

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
