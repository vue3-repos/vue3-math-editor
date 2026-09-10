import type { AstNode, PlaceholderNode } from '../types/ast'
import type { NodeChildKey, NodePath } from '../types/editor'

export interface CommandResult {
  ast: AstNode
  focusedPath: NodePath
}

export type NodeCommand = (root: AstNode, path: NodePath) => CommandResult

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

type PathContainer = AstNode | AstNode[]

export function getChildValue(node: AstNode, key: NodeChildKey): PathContainer | null {
  switch (key) {
    case 'left':
      return node.type === 'Equal' ? node.left : null
    case 'right':
      return node.type === 'Equal' ? node.right : null
    case 'children':
      return node.type === 'Add' || node.type === 'Multiply' ? node.children : null
    case 'args':
      return node.type === 'FunctionCall' ? node.args : null
    case 'minuend':
      return node.type === 'Subtract' ? node.minuend : null
    case 'subtrahend':
      return node.type === 'Subtract' ? node.subtrahend : null
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
    case 'variable':
      return node.type === 'Derivative' ? node.variable : null
    case 'value':
      return node.type === 'Negate' || node.type === 'Abs' || node.type === 'Group'
        ? node.value
        : null
    case 'radicand':
      return node.type === 'Root' ? node.radicand : null
    case 'degree':
      return node.type === 'Root' ? node.degree : null
    default:
      return null
  }
}

export function childKeysForNode(node: AstNode): NodeChildKey[] {
  switch (node.type) {
    case 'Add':
    case 'Multiply':
      return ['children']
    case 'FunctionCall':
      return ['args']
    case 'Equal':
      return ['left', 'right']
    case 'Subtract':
      return ['minuend', 'subtrahend']
    case 'Divide':
      return ['numerator', 'denominator']
    case 'Power':
      return ['base', 'exponent']
    // Two-key nodes are listed in entry order so placeholder cycling and
    // caret navigation match how the user fills them in.
    case 'Derivative':
      return ['expression', 'variable']
    case 'Negate':
    case 'Abs':
    case 'Group':
      return ['value']
    case 'Root':
      return ['degree', 'radicand']
    default:
      return []
  }
}

function setChildValue(node: AstNode, key: NodeChildKey, child: PathContainer): AstNode {
  switch (key) {
    case 'left':
      return node.type === 'Equal' && !Array.isArray(child) ? { ...node, left: child } : node
    case 'right':
      return node.type === 'Equal' && !Array.isArray(child) ? { ...node, right: child } : node
    case 'children':
      return (node.type === 'Add' || node.type === 'Multiply') && Array.isArray(child)
        ? { ...node, children: child }
        : node
    case 'args':
      return node.type === 'FunctionCall' && Array.isArray(child) ? { ...node, args: child } : node
    case 'minuend':
      return node.type === 'Subtract' && !Array.isArray(child) ? { ...node, minuend: child } : node
    case 'subtrahend':
      return node.type === 'Subtract' && !Array.isArray(child)
        ? { ...node, subtrahend: child }
        : node
    case 'numerator':
      return node.type === 'Divide' && !Array.isArray(child) ? { ...node, numerator: child } : node
    case 'denominator':
      return node.type === 'Divide' && !Array.isArray(child)
        ? { ...node, denominator: child }
        : node
    case 'base':
      return node.type === 'Power' && !Array.isArray(child) ? { ...node, base: child } : node
    case 'exponent':
      return node.type === 'Power' && !Array.isArray(child) ? { ...node, exponent: child } : node
    case 'expression':
      return node.type === 'Derivative' && !Array.isArray(child)
        ? { ...node, expression: child }
        : node
    case 'variable':
      return node.type === 'Derivative' && !Array.isArray(child)
        ? { ...node, variable: child }
        : node
    case 'value':
      return (node.type === 'Negate' || node.type === 'Abs' || node.type === 'Group') &&
        !Array.isArray(child)
        ? { ...node, value: child }
        : node
    case 'radicand':
      return node.type === 'Root' && !Array.isArray(child) ? { ...node, radicand: child } : node
    case 'degree':
      return node.type === 'Root' && !Array.isArray(child) ? { ...node, degree: child } : node
    default:
      return node
  }
}

function getValueAtPath(root: PathContainer, path: NodePath): PathContainer {
  if (path.length === 0) {
    return root
  }

  const [head, ...tail] = path

  if (typeof head === 'number') {
    if (!Array.isArray(root)) {
      throw new Error(`Cannot index non-array path segment: ${head}`)
    }

    const child = root[head]

    if (!child) {
      throw new Error(`Missing array element at path index: ${head}`)
    }

    return getValueAtPath(child, tail)
  }

  if (Array.isArray(root)) {
    throw new Error(`Expected array index but received key: ${head}`)
  }

  const child = getChildValue(root, head)

  if (child === null) {
    throw new Error(`Invalid AST path segment: ${head}`)
  }

  return getValueAtPath(child, tail)
}

function replaceValueAtPath(
  root: PathContainer,
  path: NodePath,
  nextValue: PathContainer,
): PathContainer {
  if (path.length === 0) {
    return nextValue
  }

  const [head, ...tail] = path

  if (typeof head === 'number') {
    if (!Array.isArray(root)) {
      throw new Error(`Cannot replace array index on non-array path: ${head}`)
    }

    const currentChild = root[head]

    if (!currentChild) {
      throw new Error(`Cannot replace missing array element at index: ${head}`)
    }

    const nextArray = [...root]
    const replaced = replaceValueAtPath(currentChild, tail, nextValue)

    if (Array.isArray(replaced)) {
      throw new Error('AST node replacement cannot resolve to an array element list')
    }

    nextArray[head] = replaced
    return nextArray
  }

  if (Array.isArray(root)) {
    throw new Error(`Expected numeric array index but received key: ${head}`)
  }

  const currentChild = getChildValue(root, head)

  if (currentChild === null) {
    throw new Error(`Cannot replace missing child at path segment: ${head}`)
  }

  return setChildValue(root, head, replaceValueAtPath(currentChild, tail, nextValue))
}

export function firstChildPath(node: AstNode): NodePath | null {
  switch (node.type) {
    case 'Add':
    case 'Multiply':
      return node.children.length > 0 ? ['children', 0] : null
    case 'FunctionCall':
      return node.args.length > 0 ? ['args', 0] : null
    case 'Subtract':
      return ['minuend']
    case 'Divide':
      return ['numerator']
    case 'Power':
      return ['base']
    case 'Derivative':
      return ['expression']
    case 'Negate':
    case 'Abs':
    case 'Group':
      return ['value']
    case 'Root':
      return ['radicand']
    default:
      return null
  }
}

export function getNodeAtPath(root: AstNode, path: NodePath): AstNode {
  const value = getValueAtPath(root, path)

  if (Array.isArray(value)) {
    throw new Error('Resolved path points to an AST node collection, not a node')
  }

  return value
}

export function replaceNodeAtPath(root: AstNode, path: NodePath, nextNode: AstNode): AstNode {
  const nextValue = replaceValueAtPath(root, path, nextNode)

  if (Array.isArray(nextValue)) {
    throw new Error('Root replacement must resolve to an AST node')
  }

  return nextValue
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

export function unwrapNodeAtPath(root: AstNode, path: NodePath): CommandResult {
  const node = getNodeAtPath(root, path)
  const childPath = firstChildPath(node)

  if (!childPath) {
    return {
      ast: root,
      focusedPath: clonePath(path),
    }
  }

  const replacement = getNodeAtPath(node, childPath)

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
  const wasPlaceholder = getNodeAtPath(root, path).type === 'Placeholder'

  const ast = updateNodeAtPath(root, path, (target) => ({
    type: 'Derivative',
    expression: target,
    variable: makePlaceholder(),
  }))

  // Fill the numerator first; when wrapping existing content the numerator is
  // already filled, so move straight to the variable slot.
  return {
    ast,
    focusedPath: wasPlaceholder ? [...path, 'expression'] : [...path, 'variable'],
  }
}

export function insertAddAtPath(root: AstNode, path: NodePath): CommandResult {
  const ast = updateNodeAtPath(root, path, (target) =>
    target.type === 'Add'
      ? {
          ...target,
          children: [...target.children, makePlaceholder()],
        }
      : {
          type: 'Add',
          children: [target, makePlaceholder()],
        },
  )

  const focusedNode = getNodeAtPath(ast, path)
  const nextIndex = focusedNode.type === 'Add' ? focusedNode.children.length - 1 : 1

  return {
    ast,
    focusedPath: [...path, 'children', nextIndex],
  }
}

export function insertMultiplyAtPath(root: AstNode, path: NodePath): CommandResult {
  const ast = updateNodeAtPath(root, path, (target) =>
    target.type === 'Multiply'
      ? {
          ...target,
          children: [...target.children, makePlaceholder()],
        }
      : {
          type: 'Multiply',
          children: [target, makePlaceholder()],
        },
  )

  const focusedNode = getNodeAtPath(ast, path)
  const nextIndex = focusedNode.type === 'Multiply' ? focusedNode.children.length - 1 : 1

  return {
    ast,
    focusedPath: [...path, 'children', nextIndex],
  }
}

export function insertSubtractAtPath(root: AstNode, path: NodePath): CommandResult {
  const ast = updateNodeAtPath(root, path, (target) => ({
    type: 'Subtract',
    minuend: target,
    subtrahend: makePlaceholder(),
  }))

  return {
    ast,
    focusedPath: [...path, 'subtrahend'],
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

  // Paths ending with a numeric segment point to an element inside an AST node array
  // (e.g. [..., 'children', 1] or [..., 'args', 0]).
  // The immediate parent ([..., 'children']) is a collection, not an AST node, so
  // delete fallback must move focus to the owning node instead.
  const last = path[path.length - 1]

  if (typeof last === 'number') {
    return path.slice(0, -2)
  }

  return parentPath(path)
}

function collectPlaceholderPathsRecursive(node: AstNode, path: NodePath, output: NodePath[]): void {
  if (node.type === 'Placeholder') {
    output.push(clonePath(path))
    return
  }

  for (const key of childKeysForNode(node)) {
    const childValue = getChildValue(node, key)

    if (childValue === null) {
      continue
    }

    if (Array.isArray(childValue)) {
      childValue.forEach((child, index) => {
        collectPlaceholderPathsRecursive(child, [...path, key, index], output)
      })
      continue
    }

    collectPlaceholderPathsRecursive(childValue, [...path, key], output)
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

export function insertGroupAtPath(root: AstNode, path: NodePath): CommandResult {
  const wasPlaceholder = getNodeAtPath(root, path).type === 'Placeholder'

  const ast = updateNodeAtPath(root, path, (target) => ({
    type: 'Group',
    value: target,
  }))

  return {
    ast,
    focusedPath: wasPlaceholder ? [...path, 'value'] : clonePath(path),
  }
}

export function insertNegateAtPath(root: AstNode, path: NodePath): CommandResult {
  const ast = updateNodeAtPath(root, path, (target) => ({
    type: 'Negate',
    value: target,
  }))

  return {
    ast,
    focusedPath: [...path, 'value'],
  }
}

export function insertAbsAtPath(root: AstNode, path: NodePath): CommandResult {
  const ast = updateNodeAtPath(root, path, (target) => ({
    type: 'Abs',
    value: target,
  }))

  return {
    ast,
    focusedPath: [...path, 'value'],
  }
}

export function insertRootAtPath(root: AstNode, path: NodePath, withDegree: boolean): CommandResult {
  const wasPlaceholder = getNodeAtPath(root, path).type === 'Placeholder'

  const ast = updateNodeAtPath(root, path, (target) => ({
    type: 'Root',
    radicand: target,
    degree: withDegree ? makePlaceholder() : null,
  }))

  const focusedPath: NodePath = withDegree
    ? [...path, 'degree']
    : wasPlaceholder
      ? [...path, 'radicand']
      : clonePath(path)

  return { ast, focusedPath }
}

export function insertFunctionAtPath(root: AstNode, path: NodePath, name: string): CommandResult {
  const ast = updateNodeAtPath(root, path, (target) => ({
    type: 'FunctionCall',
    name,
    args: [target],
  }))

  return {
    ast,
    focusedPath: [...path, 'args', 0],
  }
}

interface VariadicContext {
  parentPath: NodePath
  parent: AstNode
  key: 'children' | 'args'
  index: number
}

function variadicContext(root: AstNode, path: NodePath): VariadicContext | null {
  if (path.length < 2) {
    return null
  }

  const index = path[path.length - 1]
  const key = path[path.length - 2]

  if (typeof index !== 'number' || (key !== 'children' && key !== 'args')) {
    return null
  }

  const parentPath = path.slice(0, -2)
  const parent = getNodeAtPath(root, parentPath)

  return { parentPath, parent, key, index }
}

export function insertSiblingAfterAtPath(root: AstNode, path: NodePath): CommandResult | null {
  const ctx = variadicContext(root, path)

  if (!ctx) {
    return null
  }

  const collection = getChildValue(ctx.parent, ctx.key)

  if (!Array.isArray(collection)) {
    return null
  }

  const next = [...collection]
  next.splice(ctx.index + 1, 0, makePlaceholder())

  return {
    ast: replaceNodeAtPath(root, ctx.parentPath, setChildValue(ctx.parent, ctx.key, next)),
    focusedPath: [...ctx.parentPath, ctx.key, ctx.index + 1],
  }
}

export function removeVariadicChildAtPath(root: AstNode, path: NodePath): CommandResult | null {
  const ctx = variadicContext(root, path)

  if (!ctx) {
    return null
  }

  const collection = getChildValue(ctx.parent, ctx.key)

  if (!Array.isArray(collection)) {
    return null
  }

  // Collapse a two-element Add/Multiply to its surviving operand.
  if ((ctx.parent.type === 'Add' || ctx.parent.type === 'Multiply') && collection.length === 2) {
    const remaining = collection[ctx.index === 0 ? 1 : 0]

    return {
      ast: replaceNodeAtPath(root, ctx.parentPath, remaining),
      focusedPath: clonePath(ctx.parentPath),
    }
  }

  if (collection.length <= 1) {
    return null
  }

  const next = collection.filter((_, index) => index !== ctx.index)

  return {
    ast: replaceNodeAtPath(root, ctx.parentPath, setChildValue(ctx.parent, ctx.key, next)),
    focusedPath: [...ctx.parentPath, ctx.key, Math.max(0, ctx.index - 1)],
  }
}

// Delete a placeholder: drop it from a variadic parent when possible, otherwise
// collapse the parent to its first remaining non-placeholder child.
export function deletePlaceholderAtPath(root: AstNode, path: NodePath): CommandResult {
  const variadic = removeVariadicChildAtPath(root, path)

  if (variadic) {
    return variadic
  }

  const parentNodePath = fallbackFocusAfterDelete(path)
  const parent = getNodeAtPath(root, parentNodePath)

  let keep: AstNode | null = null

  for (const key of childKeysForNode(parent)) {
    const value = getChildValue(parent, key)

    if (value === null || Array.isArray(value)) {
      continue
    }

    if (value.type !== 'Placeholder') {
      keep = value
      break
    }
  }

  return {
    ast: replaceNodeAtPath(root, parentNodePath, keep ?? makePlaceholder()),
    focusedPath: clonePath(parentNodePath),
  }
}

// Delete an empty group ("()" with a placeholder inside): drop it from a
// variadic parent when possible, otherwise collapse it to a bare
// placeholder in place. This is what makes backspacing empty parentheses a
// single step whether focus is on the group itself or on the placeholder
// inside it — the group carries no content worth preserving, so unlike
// unwrapNodeAtPath it never leaves the placeholder behind as an orphaned
// sibling that needs a second backspace to clear.
export function deleteEmptyGroupAtPath(root: AstNode, groupPath: NodePath): CommandResult {
  const variadic = removeVariadicChildAtPath(root, groupPath)

  if (variadic) {
    return variadic
  }

  return replaceNodeWithPlaceholder(root, groupPath)
}
