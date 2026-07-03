import type { AstNode, PlaceholderNode } from '../types/ast'
import type { NodeChildKey, NodePath } from '../types/editor'

export interface CommandResult {
  ast: AstNode
  focusedPath: NodePath
}

function makePlaceholder(): PlaceholderNode {
  return { type: 'Placeholder' }
}

function clonePath(path: NodePath): NodePath {
  return [...path]
}

function getChildNode(node: AstNode, key: NodeChildKey): AstNode | null {
  switch (key) {
    case 'left':
      return node.type === 'Add' || node.type === 'Multiply' ? node.left : null
    case 'right':
      return node.type === 'Add' || node.type === 'Multiply' ? node.right : null
    case 'numerator':
      return node.type === 'Divide' ? node.numerator : null
    case 'denominator':
      return node.type === 'Divide' ? node.denominator : null
    case 'base':
      return node.type === 'Power' ? node.base : null
    case 'exponent':
      return node.type === 'Power' ? node.exponent : null
    case 'expression':
      return node.type === 'Derivative' ? node.expression : null
    default:
      return null
  }
}

function setChildNode(node: AstNode, key: NodeChildKey, child: AstNode): AstNode {
  switch (key) {
    case 'left':
      return node.type === 'Add' || node.type === 'Multiply' ? { ...node, left: child } : node
    case 'right':
      return node.type === 'Add' || node.type === 'Multiply' ? { ...node, right: child } : node
    case 'numerator':
      return node.type === 'Divide' ? { ...node, numerator: child } : node
    case 'denominator':
      return node.type === 'Divide' ? { ...node, denominator: child } : node
    case 'base':
      return node.type === 'Power' ? { ...node, base: child } : node
    case 'exponent':
      return node.type === 'Power' ? { ...node, exponent: child } : node
    case 'expression':
      return node.type === 'Derivative' ? { ...node, expression: child } : node
    default:
      return node
  }
}

export function getNodeAtPath(root: AstNode, path: NodePath): AstNode {
  if (path.length === 0) {
    return root
  }

  const [head, ...tail] = path
  const child = getChildNode(root, head)

  if (!child) {
    throw new Error(`Invalid AST path segment: ${head}`)
  }

  return getNodeAtPath(child, tail)
}

export function replaceNodeAtPath(root: AstNode, path: NodePath, nextNode: AstNode): AstNode {
  if (path.length === 0) {
    return nextNode
  }

  const [head, ...tail] = path
  const currentChild = getChildNode(root, head)

  if (!currentChild) {
    throw new Error(`Cannot replace missing child at path segment: ${head}`)
  }

  return setChildNode(root, head, replaceNodeAtPath(currentChild, tail, nextNode))
}

export function updateNodeAtPath(
  root: AstNode,
  path: NodePath,
  updater: (node: AstNode) => AstNode,
): AstNode {
  const target = getNodeAtPath(root, path)
  const nextTarget = updater(target)
  return replaceNodeAtPath(root, path, nextTarget)
}

function pathHasParent(path: NodePath): boolean {
  return path.length > 0
}

function parentPath(path: NodePath): NodePath {
  return path.slice(0, -1)
}

function firstStructuralChild(node: AstNode): NodeChildKey | null {
  if (node.type === 'Divide') {
    return 'numerator'
  }

  if (node.type === 'Power') {
    return 'base'
  }

  if (node.type === 'Derivative') {
    return 'expression'
  }

  return null
}

export function unwrapNodeAtPath(root: AstNode, path: NodePath): CommandResult {
  const node = getNodeAtPath(root, path)
  const childKey = firstStructuralChild(node)

  if (!childKey) {
    return {
      ast: root,
      focusedPath: clonePath(path),
    }
  }

  const replacement = getChildNode(node, childKey)

  if (!replacement) {
    return {
      ast: root,
      focusedPath: clonePath(path),
    }
  }

  const ast = replaceNodeAtPath(root, path, replacement)

  return {
    ast,
    focusedPath: clonePath(path),
  }
}

export function insertFractionAtPath(root: AstNode, path: NodePath): CommandResult {
  const ast = updateNodeAtPath(root, path, (target) => ({
    type: 'Divide',
    numerator: target,
    denominator: makePlaceholder(),
  }))

  return {
    ast,
    focusedPath: [...path, 'denominator'],
  }
}

export function insertPowerAtPath(root: AstNode, path: NodePath): CommandResult {
  const ast = updateNodeAtPath(root, path, (target) => ({
    type: 'Power',
    base: target,
    exponent: makePlaceholder(),
  }))

  return {
    ast,
    focusedPath: [...path, 'exponent'],
  }
}

export function insertDerivativeAtPath(root: AstNode, path: NodePath): CommandResult {
  const ast = updateNodeAtPath(root, path, (target) => ({
    type: 'Derivative',
    expression: target,
    variable: 'x',
  }))

  return {
    ast,
    focusedPath: [...path, 'expression'],
  }
}

export function replaceFocusedNode(
  root: AstNode,
  path: NodePath,
  nextNode: AstNode,
): CommandResult {
  return {
    ast: replaceNodeAtPath(root, path, nextNode),
    focusedPath: clonePath(path),
  }
}

export function resolveCommandPath(path: NodePath | null): NodePath {
  if (path && path.length >= 0) {
    return clonePath(path)
  }

  return []
}

export function collapseSelection(path: NodePath | null) {
  const resolved = resolveCommandPath(path)

  return {
    anchor: resolved,
    focus: clonePath(resolved),
  }
}

export function fallbackFocusAfterDelete(path: NodePath): NodePath {
  if (!pathHasParent(path)) {
    return []
  }

  return parentPath(path)
}
