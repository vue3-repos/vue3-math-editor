import type { AstNode } from '../types/ast'
import type { CaretSide, NodePath } from '../types/editor'
import { childKeysForNode, firstChildPath, getChildValue, getNodeAtPath } from './commands'

export function pathsEqual(a: NodePath, b: NodePath): boolean {
  if (a.length !== b.length) {
    return false
  }

  return a.every((segment, index) => segment === b[index])
}

export function isPathPrefix(prefix: NodePath, target: NodePath): boolean {
  if (prefix.length > target.length) {
    return false
  }

  return prefix.every((segment, index) => segment === target[index])
}

export function parentNodePath(path: NodePath): NodePath | null {
  if (path.length === 0) {
    return null
  }

  // Array elements are addressed as [..., 'children'|'args', index]; the owning
  // node is two segments up.
  return typeof path[path.length - 1] === 'number' ? path.slice(0, -2) : path.slice(0, -1)
}

export function firstChildNodePath(root: AstNode, path: NodePath): NodePath | null {
  const relative = firstChildPath(getNodeAtPath(root, path))
  return relative ? [...path, ...relative] : null
}

function collectLeafPaths(node: AstNode, path: NodePath, output: NodePath[]): void {
  let hasChildren = false

  for (const key of childKeysForNode(node)) {
    const value = getChildValue(node, key)

    if (value === null) {
      continue
    }

    if (Array.isArray(value)) {
      value.forEach((child, index) => {
        hasChildren = true
        collectLeafPaths(child, [...path, key, index], output)
      })
      continue
    }

    hasChildren = true
    collectLeafPaths(value, [...path, key], output)
  }

  if (!hasChildren) {
    output.push(path)
  }
}

// Operators that form "linear" runs the user types through left to right.
// Structural slots (fraction numerators, roots, function arguments, explicit
// bracket groups, ...) are absent: typing an operator inside one stays inside.
const LINEAR_PRECEDENCE: Partial<Record<AstNode['type'], number>> = {
  Equal: 1,
  Add: 2,
  Subtract: 2,
  Negate: 2,
  Multiply: 3,
}

export interface OperatorClimb {
  path: NodePath
  siblingParent: boolean
  // The climb hit a *different*-typed variadic parent (e.g. a Multiply,
  // while typing "+") whose own precedence would normally let the operator
  // climb straight past it — but the caret sits strictly mid-list there,
  // not at that parent's own edge. Wrapping the whole parent in that case
  // would silently discard the caret's position ("4x" + caret before "x" +
  // "+3" would become "4x+3"); splitting its children at this gap instead
  // is what the caller should do.
  splitAt: { parentPath: NodePath; index: number } | null
}

// Does `path`'s own leaf-span reach the equation's outer boundary in the
// direction `side` points toward? Used to decide whether it's safe to keep
// climbing an operator's insertion point through a structural node
// (fraction, root, function call, ...) — safe only when there is truly
// nothing else, anywhere, on that side to disturb.
function isAtGlobalEdge(root: AstNode, path: NodePath, side: CaretSide): boolean {
  const leaves = listLeafPaths(root)
  let first = -1
  let last = -1

  leaves.forEach((leaf, index) => {
    if (isPathPrefix(path, leaf)) {
      if (first < 0) {
        first = index
      }

      last = index
    }
  })

  if (first < 0) {
    return false
  }

  return side === 'before' ? first === 0 : last === leaves.length - 1
}

// Where should a typed binary operator apply? Starting from the focused
// node, climb through enclosing linear operators of equal or tighter
// binding so that "4*t-3" parses as (4·t)-3 while "2+3*4" keeps 3·4
// together. When the climb meets a parent of `siblingParentType` (an Add
// for "+", a Multiply for "*"), stop and report it so the caller can insert
// a sibling term there instead of nesting.
//
// A structural slot (fraction, root, function call, ...) normally stops
// the climb outright — typing an operator inside one stays inside — but
// that protection only matters when there's something else, anywhere, on
// this side to disturb. If the focused leaf already reaches the equation's
// own outer edge in this direction, the slot *is* the whole equation out
// that way, so escaping it is safe (this is what lets "x^2" + "+1" reach
// "x^2 + 1" directly, without first having to select the whole power).
export function climbForOperator(
  root: AstNode,
  path: NodePath,
  side: CaretSide,
  operatorPrecedence: number,
  siblingParentType: 'Add' | 'Multiply' | null,
): OperatorClimb {
  let current = path

  for (;;) {
    const parent = parentNodePath(current)

    if (!parent) {
      return { path: current, siblingParent: false, splitAt: null }
    }

    const parentNode = getNodeAtPath(root, parent)

    if (siblingParentType && parentNode.type === siblingParentType) {
      return { path: current, siblingParent: true, splitAt: null }
    }

    const precedence = LINEAR_PRECEDENCE[parentNode.type]

    if (precedence === undefined) {
      if (isAtGlobalEdge(root, current, side)) {
        current = parent
        continue
      }

      return { path: current, siblingParent: false, splitAt: null }
    }

    if (precedence < operatorPrecedence) {
      return { path: current, siblingParent: false, splitAt: null }
    }

    if (siblingParentType && (parentNode.type === 'Add' || parentNode.type === 'Multiply')) {
      const index = current[current.length - 1] as number
      const atEdge = side === 'before' ? index === 0 : index === parentNode.children.length - 1

      if (!atEdge) {
        return { path: current, siblingParent: false, splitAt: { parentPath: parent, index } }
      }
    }

    current = parent
  }
}

// Leaf node paths (numbers, identifiers, placeholders) in reading order.
export function listLeafPaths(root: AstNode): NodePath[] {
  const paths: NodePath[] = []
  collectLeafPaths(root, [], paths)
  return paths
}

// Caret-like horizontal movement. Steps to the first leaf immediately outside
// the focused node's subtree — after it going forward, before it going
// backward — treating that subtree as one block to skip over rather than
// diving into it. Returns null at the equation boundary (the leftmost or
// rightmost leaf, symmetrically); walking the terms stops there rather than
// climbing to the enclosing expression, which is a separate, deliberate
// action (ArrowUp).
export function moveLeaf(
  root: AstNode,
  path: NodePath,
  direction: 'forward' | 'backward',
): NodePath | null {
  const leaves = listLeafPaths(root)

  if (leaves.length === 0) {
    return null
  }

  let first = -1
  let last = -1

  leaves.forEach((leaf, index) => {
    if (isPathPrefix(path, leaf)) {
      if (first < 0) {
        first = index
      }

      last = index
    }
  })

  if (first < 0) {
    return direction === 'forward' ? leaves[0] : leaves[leaves.length - 1]
  }

  return direction === 'forward' ? leaves[last + 1] ?? null : leaves[first - 1] ?? null
}

export interface CaretPosition {
  path: NodePath
  side: CaretSide
}

// Each leaf has two caret stops — before and after — but "after this leaf"
// and "before the very next leaf" are the same physical gap (e.g. in "4x",
// right-of-4 and left-of-x are one insertion point, not two). 'before' is
// the canonical form for every such shared gap, so a single ArrowLeft from
// "after t" flips to "before t" *in place* (no leaf jump, since 'before' has
// no earlier duplicate to fold into); only a second consecutive press moves
// on to the neighboring leaf. Going the other way, flipping "before"
// forward would only recreate that same already-canonical gap when a next
// leaf exists, so it's skipped in favor of landing on it directly —
// stepping forward from "left of 4" reaches "left of x" in one press, not
// two. Returns null at the equation boundary (leftmost 'before' / rightmost
// 'after'), so callers leave the caret exactly where it is.
export function stepCaret(
  root: AstNode,
  caret: CaretPosition,
  direction: 'forward' | 'backward',
): CaretPosition | null {
  if (direction === 'backward') {
    if (caret.side === 'after') {
      return { path: caret.path, side: 'before' }
    }

    const prev = moveLeaf(root, caret.path, 'backward')
    return prev ? { path: prev, side: 'before' } : null
  }

  if (caret.side === 'before') {
    const next = moveLeaf(root, caret.path, 'forward')
    return next ? { path: next, side: 'before' } : { path: caret.path, side: 'after' }
  }

  const next = moveLeaf(root, caret.path, 'forward')
  return next ? { path: next, side: 'after' } : null
}
