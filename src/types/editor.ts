import type { AstNode } from './ast'

export type NodeChildKey =
  | 'left'
  | 'right'
  | 'children'
  | 'args'
  | 'minuend'
  | 'subtrahend'
  | 'numerator'
  | 'denominator'
  | 'base'
  | 'exponent'
  | 'expression'
  | 'variable'
  | 'value'
  | 'radicand'
  | 'degree'

export type NodePathSegment = NodeChildKey | number

export type NodePath = NodePathSegment[]

export interface EditorSelection {
  anchor: NodePath
  focus: NodePath
}

// Which side of the focused node new typing lands on. A leaf has two caret
// stops — before and after — so "insert a term to the left" can be
// expressed without ambiguity; 'after' is the long-standing default (append
// to the right, matching every existing insertion command).
export type CaretSide = 'before' | 'after'

export interface EditorState {
  ast: AstNode | null
  focusedPath: NodePath | null
  selection: EditorSelection | null
  mode: 'insert' | 'replace'
  caretSide: CaretSide
}
