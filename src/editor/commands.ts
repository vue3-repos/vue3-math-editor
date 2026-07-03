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

function samePath(a: NodePath, b: NodePath): boolean {
  if (a.length !== b.length) {
    return false
  }

  return a.every((part, index) => part === b[index])
}

function getChildNode(node: AstNode, key: NodeChildKey): AstNode | null {
  switch (key) {
    case 'left':
      return node.type === 'Add' || node.type === 'Multiply' || node.type === 'Equal'
        ? node.left
        : null
    case 'right':
      return node.type === 'Add' || node.type === 'Multiply' || node.type === 'Equal'
        ? node.right
        : null
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

function childKeysForNode(node: AstNode): NodeChildKey[] {
  switch (node.type) {
    case 'Add':
    case 'Multiply':
    case 'Equal':
      return ['left', 'right']
    case 'Divide':
      return ['numerator', 'denominator']
    case 'Power':
      return ['base', 'exponent']
    case 'Derivative':
      return ['expression']
    default:
      return []
  }
}

function setChildNode(node: AstNode, key: NodeChildKey, child: AstNode): AstNode {
  switch (key) {
    case 'left':
      return node.type === 'Add' || node.type === 'Multiply' || node.type === 'Equal'
        ? { ...node, left: child }
        : node
    case 'right':
      return node.type === 'Add' || node.type === 'Multiply' || node.type === 'Equal'
        ? { ...node, right: child }
        : node
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

export function insertAddAtPath(root: AstNode, path: NodePath): CommandResult {
  const ast = updateNodeAtPath(root, path, (target) => ({
    type: 'Add',
    left: target,
    right: makePlaceholder(),
  }))

  return {
    ast,
    focusedPath: [...path, 'right'],
  }
}

export function insertMultiplyAtPath(root: AstNode, path: NodePath): CommandResult {
  const ast = updateNodeAtPath(root, path, (target) => ({
    type: 'Multiply',
    left: target,
    right: makePlaceholder(),
  }))

  return {
    ast,
    focusedPath: [...path, 'right'],
  }
}

export function insertEqualAtPath(root: AstNode, path: NodePath): CommandResult {
  const ast = updateNodeAtPath(root, path, (target) => ({
    type: 'Equal',
    left: target,
    right: makePlaceholder(),
  }))

  return {
    ast,
    focusedPath: [...path, 'right'],
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

function collectPlaceholderPathsRecursive(node: AstNode, path: NodePath, output: NodePath[]): void {
  if (node.type === 'Placeholder') {
    output.push(clonePath(path))
    return
  }

  const childKeys = childKeysForNode(node)

  for (const key of childKeys) {
    const child = getChildNode(node, key)

    if (child) {
      collectPlaceholderPathsRecursive(child, [...path, key], output)
    }
  }
}

export function getPlaceholderPaths(root: AstNode): NodePath[] {
  const paths: NodePath[] = []
  collectPlaceholderPathsRecursive(root, [], paths)
  return paths
}

export function getNextPlaceholderPath(
  root: AstNode,
  focusedPath: NodePath | null,
  direction: 'forward' | 'backward',
): NodePath | null {
  const slots = getPlaceholderPaths(root)

  if (slots.length === 0) {
    return null
  }

  if (!focusedPath) {
    return clonePath(slots[0])
  }

  const exactIndex = slots.findIndex((path) => samePath(path, focusedPath))

  if (exactIndex >= 0) {
    const delta = direction === 'forward' ? 1 : -1
    const nextIndex = (exactIndex + delta + slots.length) % slots.length
    return clonePath(slots[nextIndex])
  }

  if (direction === 'forward') {
    return clonePath(slots[0])
  }

  return clonePath(slots[slots.length - 1])
}

export function isPlaceholderAtPath(root: AstNode, path: NodePath | null): boolean {
  if (!path) {
    return false
  }

  return getNodeAtPath(root, path).type === 'Placeholder'
}

export function replaceNodeWithPlaceholder(root: AstNode, path: NodePath): CommandResult {
  const ast = replaceNodeAtPath(root, path, makePlaceholder())

  return {
    ast,
    focusedPath: clonePath(path),
  }
}
