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

// Where should a typed binary operator apply? Starting from the focused
// node, climb through enclosing linear operators of equal or tighter
// binding so that "4*t-3" parses as (4·t)-3 while "2+3*4" keeps 3·4
// together. When the climb meets a parent of `siblingParentType` (an Add
// for "+", a Multiply for "*"), stop and report it so the caller can insert
// a sibling term there instead of nesting.
//
// A structural slot (fraction, root, function call, ...) always stops the
// climb outright — typing an operator inside one stays inside. There's no
// way to *infer* that it's safe to escape one instead (a fraction's
// denominator and a function's sole argument are equally plausible places
// to keep building on, e.g. "1/(x+3)" or "sin(x+1)" — a global-emptiness
// heuristic here previously let "sin(x" + "+1" escape to "sin(x)+1",
// which is exactly backwards). Escaping is `stepCaret`'s job instead: it
// exposes the slot's own boundary as an explicit, separate caret stop
// (see `popOutOfSlot`) that the caller can navigate to and use from.
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

    if (precedence === undefined || precedence < operatorPrecedence) {
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

// The lowest node whose path is a prefix of both `a` and `b`. A raw common
// prefix can end mid-array (e.g. ['children'], with the next segment being
// where the two paths' indices diverge) — that's not a valid path to a
// node (an array key is never addressed on its own), so in that case the
// real common ancestor is one level further up, the node that owns the
// array.
function lowestCommonAncestorPath(a: NodePath, b: NodePath): NodePath {
  let i = 0

  while (i < a.length && i < b.length && a[i] === b[i]) {
    i++
  }

  const prefix = a.slice(0, i)
  const last = prefix[prefix.length - 1]

  return last === 'children' || last === 'args' ? prefix.slice(0, -1) : prefix
}

// "After this leaf" and "before the very next leaf" are the same physical
// gap only when nothing is rendered between them — which in this AST means
// exactly one thing: two factors of the same Multiply, joined by bare
// juxtaposition (at most a small "·"). Every other adjacency — an explicit
// "+"/"-"/"=", a fraction bar, exponent placement, a derivative's "d/d" —
// has its own visual presence and deserves its own caret stop on each
// side, e.g. "x-3" must keep "right of x" (before the "-") distinct from
// "left of 3" (after it).
function isPureMultiplyAdjacency(root: AstNode, a: NodePath, b: NodePath): boolean {
  const lca = lowestCommonAncestorPath(a, b)
  return getNodeAtPath(root, lca).type === 'Multiply'
}

// When there's no more leaf to step to in this direction, the caret may
// still be able to "pop out" to the boundary of the slot that contains it,
// rather than stopping outright — but only when that slot is unambiguously
// a single unit, not a multi-term list still being walked. A named
// single-value slot (a fraction's numerator/denominator, a power's
// base/exponent, ...) always qualifies; a variadic list (Add/Multiply/a
// function's arguments) only qualifies when it currently holds exactly one
// element. Reaching the edge of two or more terms is "walking the terms is
// done for now, drill up deliberately (ArrowUp) if you want more" — the
// existing boundary-stop behavior, left alone. This is what makes "sin(x"
// + "+1" stay inside as "sin(x+1)" (one argument: no pop-out, so the
// operator never even gets the chance to apply outside) while still
// letting the caret itself reach "after the whole sin(...)" on request.
function popOutOfSlot(root: AstNode, path: NodePath): NodePath | null {
  const parent = parentNodePath(path)

  if (!parent) {
    return null
  }

  if (typeof path[path.length - 1] === 'number') {
    const key = path[path.length - 2] as 'children' | 'args'
    const collection = getChildValue(getNodeAtPath(root, parent), key)

    if (!Array.isArray(collection) || collection.length > 1) {
      return null
    }
  }

  return parent
}

// Each leaf has two caret stops — before and after — but "after this leaf"
// and "before the very next leaf" collapse into one shared stop when
// nothing sits between them (see `isPureMultiplyAdjacency`); a single
// ArrowLeft from "after t" flips to "before t" *in place* (no leaf jump,
// since 'before' has no earlier duplicate to fold into); only a second
// consecutive press moves on to the neighboring leaf. Going the other way,
// flipping "before" forward only recreates that same shared gap when one
// exists, so it's skipped in favor of landing on it directly.
//
// At the equation boundary, `moveLeaf` returns null — but the caret can
// still pop out to the enclosing slot's own boundary instead of stopping
// outright, when `popOutOfSlot` says that's unambiguous (see there). Only
// once there's truly nothing left to pop out of does this return null, so
// callers leave the caret exactly where it is.
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

    if (prev) {
      // 'before' only if the gap between them is actually shared;
      // otherwise this leaf's own trailing edge ("after") is a genuine,
      // distinct stop that must not be skipped over.
      return { path: prev, side: isPureMultiplyAdjacency(root, prev, caret.path) ? 'before' : 'after' }
    }

    const poppedOut = popOutOfSlot(root, caret.path)
    return poppedOut ? { path: poppedOut, side: 'before' } : null
  }

  if (caret.side === 'before') {
    const next = moveLeaf(root, caret.path, 'forward')

    if (next && isPureMultiplyAdjacency(root, caret.path, next)) {
      return { path: next, side: 'before' }
    }

    return { path: caret.path, side: 'after' }
  }

  const next = moveLeaf(root, caret.path, 'forward')

  if (next) {
    // 'before' is always the right landing side here: if the gap ahead is
    // shared, 'before' is its canonical form anyway; if it isn't, 'before'
    // is this leaf's own genuine leading edge, distinct from the one just
    // left behind.
    return { path: next, side: 'before' }
  }

  const poppedOut = popOutOfSlot(root, caret.path)
  return poppedOut ? { path: poppedOut, side: 'after' } : null
}
