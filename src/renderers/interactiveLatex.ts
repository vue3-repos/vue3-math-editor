import type { AstNode } from '../types/ast'
import type { NodePath } from '../types/editor'
import { getFunctionDefinition } from '../registry/nodes'

// Names that should render as greek letters when used as identifiers.
const GREEK_NAMES = new Set([
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'varepsilon',
  'zeta',
  'eta',
  'theta',
  'vartheta',
  'iota',
  'kappa',
  'lambda',
  'mu',
  'nu',
  'xi',
  'pi',
  'rho',
  'sigma',
  'tau',
  'upsilon',
  'phi',
  'varphi',
  'chi',
  'psi',
  'omega',
  'Gamma',
  'Delta',
  'Theta',
  'Lambda',
  'Xi',
  'Pi',
  'Sigma',
  'Upsilon',
  'Phi',
  'Psi',
  'Omega',
])

export function encodePath(path: NodePath): string {
  return ['r', ...path].join('.')
}

export function decodePath(encoded: string | null | undefined): NodePath | null {
  if (!encoded) {
    return null
  }

  const parts = encoded.split('.')

  if (parts[0] !== 'r') {
    return null
  }

  return parts.slice(1).map((part) => (/^\d+$/.test(part) ? Number(part) : part)) as NodePath
}

function pathsEqual(a: NodePath, b: NodePath | null): boolean {
  if (!b || a.length !== b.length) {
    return false
  }

  return a.every((segment, index) => segment === b[index])
}

function renderIdentifierName(name: string): string {
  if (GREEK_NAMES.has(name)) {
    return `\\${name}`
  }

  return name.length > 1 ? `\\mathit{${name}}` : name
}

function wrapParens(latex: string): string {
  return `\\left(${latex}\\right)`
}

function isNegativeNumber(node: AstNode): boolean {
  return node.type === 'Number' && node.value < 0
}

function needsParensInAdd(child: AstNode): boolean {
  return child.type === 'Negate' || child.type === 'Equal' || isNegativeNumber(child)
}

function needsParensInProduct(child: AstNode): boolean {
  return (
    child.type === 'Add' ||
    child.type === 'Subtract' ||
    child.type === 'Equal' ||
    child.type === 'Negate' ||
    isNegativeNumber(child)
  )
}

function needsParensAsPowerBase(child: AstNode): boolean {
  switch (child.type) {
    case 'Number':
      return child.value < 0
    case 'Identifier':
    case 'Placeholder':
    case 'Abs':
    case 'Root':
    case 'Group':
      return false
    default:
      return true
  }
}

function isDelimitedLeaf(node: AstNode): boolean {
  return (
    node.type === 'Number' ||
    node.type === 'Identifier' ||
    node.type === 'Placeholder' ||
    node.type === 'Group'
  )
}

interface RenderContext {
  focusedPath: NodePath | null
}

function renderNode(
  node: AstNode,
  path: NodePath,
  ctx: RenderContext,
  parenthesized = false,
): string {
  let inner = renderBody(node, path, ctx)

  // Grouping parentheses go inside the node's clickable span, so clicking a
  // bracket selects the bracketed sub-expression rather than its parent.
  if (parenthesized) {
    inner = wrapParens(inner)
  }

  if (pathsEqual(path, ctx.focusedPath)) {
    inner = `\\htmlClass{me-focused}{${inner}}`
  }

  return `\\htmlData{path=${encodePath(path)}}{${inner}}`
}

function renderChild(
  node: AstNode,
  path: NodePath,
  ctx: RenderContext,
  parenthesized: boolean,
): string {
  return renderNode(node, path, ctx, parenthesized)
}

function renderBody(node: AstNode, path: NodePath, ctx: RenderContext): string {
  switch (node.type) {
    case 'Number':
      return String(node.value)

    case 'Identifier':
      return renderIdentifierName(node.name)

    case 'Placeholder':
      return '\\htmlClass{me-ph}{\\square}'

    case 'Add':
      return node.children
        .map((child, index) =>
          renderChild(child, [...path, 'children', index], ctx, needsParensInAdd(child)),
        )
        .join(' + ')

    case 'Multiply':
      return node.children
        .map((child, index) => {
          const rendered = renderChild(
            child,
            [...path, 'children', index],
            ctx,
            needsParensInProduct(child),
          )

          if (index === 0) {
            return rendered
          }

          // Use an explicit dot before bare numbers ("x \cdot 2"), implicit
          // juxtaposition otherwise ("2x", "xy").
          const separator = child.type === 'Number' ? ' \\cdot ' : ' \\, '
          return separator + rendered
        })
        .join('')

    case 'Subtract': {
      const minuend = renderChild(
        node.minuend,
        [...path, 'minuend'],
        ctx,
        node.minuend.type === 'Equal',
      )
      const subtrahend = renderChild(
        node.subtrahend,
        [...path, 'subtrahend'],
        ctx,
        node.subtrahend.type === 'Add' ||
          node.subtrahend.type === 'Subtract' ||
          node.subtrahend.type === 'Negate' ||
          node.subtrahend.type === 'Equal' ||
          isNegativeNumber(node.subtrahend),
      )
      return `${minuend} - ${subtrahend}`
    }

    case 'Negate': {
      const value = renderChild(
        node.value,
        [...path, 'value'],
        ctx,
        node.value.type === 'Add' ||
          node.value.type === 'Subtract' ||
          node.value.type === 'Negate' ||
          node.value.type === 'Equal' ||
          isNegativeNumber(node.value),
      )
      return `-${value}`
    }

    case 'Abs':
      return `\\left|${renderNode(node.value, [...path, 'value'], ctx)}\\right|`

    case 'Group':
      return wrapParens(renderNode(node.value, [...path, 'value'], ctx))

    case 'Root': {
      const radicand = renderNode(node.radicand, [...path, 'radicand'], ctx)

      if (node.degree) {
        return `\\sqrt[${renderNode(node.degree, [...path, 'degree'], ctx)}]{${radicand}}`
      }

      return `\\sqrt{${radicand}}`
    }

    case 'FunctionCall': {
      const definition = getFunctionDefinition(node.name)
      const head = definition ? `\\${definition.latexName}` : `\\operatorname{${node.name}}`
      const args = node.args
        .map((arg, index) => renderNode(arg, [...path, 'args', index], ctx))
        .join(', ')
      return `${head}${wrapParens(args)}`
    }

    case 'Equal':
      return `${renderNode(node.left, [...path, 'left'], ctx)} = ${renderNode(node.right, [...path, 'right'], ctx)}`

    case 'Divide':
      return `\\frac{${renderNode(node.numerator, [...path, 'numerator'], ctx)}}{${renderNode(node.denominator, [...path, 'denominator'], ctx)}}`

    case 'Power': {
      const base = renderChild(node.base, [...path, 'base'], ctx, needsParensAsPowerBase(node.base))
      return `${base}^{${renderNode(node.exponent, [...path, 'exponent'], ctx)}}`
    }

    case 'Derivative': {
      const expression = renderChild(
        node.expression,
        [...path, 'expression'],
        ctx,
        !isDelimitedLeaf(node.expression) && node.expression.type !== 'FunctionCall',
      )
      const variable = renderNode(node.variable, [...path, 'variable'], ctx)
      return `\\frac{\\mathrm{d}${expression}}{\\mathrm{d}${variable}}`
    }

    default:
      return ''
  }
}

export function astToInteractiveLatex(node: AstNode, focusedPath: NodePath | null): string {
  return renderNode(node, [], { focusedPath })
}
