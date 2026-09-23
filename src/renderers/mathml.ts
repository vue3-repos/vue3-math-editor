import type { AstNode, NumberNode } from '../types/ast'
import { conditionOperatorOfType } from '../editor/operators'
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

export interface ContentMathMLOptions {
  // CellML mode: every number gets a `cellml:units` attribute (CellML 2.0
  // requires one on each <cn>). The caller declares the `cellml` namespace
  // on the root <math> element (see editor/exports.ts).
  cellml?: boolean
}

// Numbers don't have units yet, so CellML mode writes this placeholder for
// the user (or libCellML's report) to replace.
export const CELLML_UNDEFINED_UNITS = 'undefined'

// A number as <cn>. Scientific notation is kept as MathML's e-notation,
// <cn type="e-notation">1<sep/>-8</cn>, which CellML also accepts. A plain
// number that JavaScript would print in exponent form (1e-7, 1e+21) is
// written the same way, since a type="real" <cn> can't hold an exponent.
function renderNumber(node: NumberNode, options: ContentMathMLOptions): string {
  const units = options.cellml ? ` cellml:units="${CELLML_UNDEFINED_UNITS}"` : ''
  const [digits, exponent] = String(node.value).split('e')
  const eNotation = node.scientific
    ? { mantissa: node.scientific.mantissa, exponent: node.scientific.exponent }
    : exponent !== undefined
      ? { mantissa: digits, exponent: Number(exponent) }
      : null

  return eNotation
    ? `<cn${units} type="e-notation">${eNotation.mantissa}<sep/>${eNotation.exponent}</cn>`
    : `<cn${units}>${node.value}</cn>`
}

export function astToContentMathML(node: AstNode, options: ContentMathMLOptions = {}): string {
  switch (node.type) {
    case 'Number':
      return renderNumber(node, options)

    case 'Identifier':
      return `<ci>${node.name}</ci>`

    case 'Add':
      return renderApply(
        'plus',
        node.children.map((child) => astToContentMathML(child, options)),
      )

    case 'Multiply':
      return renderApply(
        'times',
        node.children.map((child) => astToContentMathML(child, options)),
      )

    case 'Subtract':
      return renderApply('minus', [
        astToContentMathML(node.minuend, options),
        astToContentMathML(node.subtrahend, options),
      ])

    case 'Negate':
      return renderApply('minus', [astToContentMathML(node.value, options)])

    case 'Abs':
      return renderApply('abs', [astToContentMathML(node.value, options)])

    // Explicit brackets are purely presentational; export the content.
    case 'Group':
      return astToContentMathML(node.value, options)

    case 'Root':
      return node.degree
        ? `
            <apply>
              <root/>
              <degree>
                ${astToContentMathML(node.degree, options)}
              </degree>
              ${astToContentMathML(node.radicand, options)}
            </apply>
          `
        : renderApply('root', [astToContentMathML(node.radicand, options)])

    case 'FunctionCall': {
      const definition = getFunctionDefinition(node.name)
      const renderedArgs = node.args.map((child) => astToContentMathML(child, options))

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
        astToContentMathML(node.numerator, options),
        astToContentMathML(node.denominator, options),
      ])

    case 'Equal':
      return renderApply('eq', [
        astToContentMathML(node.left, options),
        astToContentMathML(node.right, options),
      ])

    case 'Less':
    case 'Greater':
    case 'LessEqual':
    case 'GreaterEqual':
    case 'NotEqual':
      return renderApply(conditionOperatorOfType(node.type)!.mathml, [
        astToContentMathML(node.left, options),
        astToContentMathML(node.right, options),
      ])

    case 'And':
    case 'Or':
    case 'Xor':
      return renderApply(
        conditionOperatorOfType(node.type)!.mathml,
        node.children.map((child) => astToContentMathML(child, options)),
      )

    case 'Not':
      return renderApply('not', [astToContentMathML(node.value, options)])

    case 'Power':
      return renderApply('power', [
        astToContentMathML(node.base, options),
        astToContentMathML(node.exponent, options),
      ])

    case 'Derivative':
      return `
        <apply>
          <diff/>
          <bvar>
            ${astToContentMathML(node.variable, options)}
          </bvar>
          ${astToContentMathML(node.expression, options)}
        </apply>
      `

    case 'Placeholder':
      return `<ci>_</ci>`

    default:
      return assertNever(node)
  }
}
