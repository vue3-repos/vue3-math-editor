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

export interface EditorState {
  ast: AstNode | null
  focusedPath: NodePath | null
  selection: EditorSelection | null
  mode: 'insert' | 'replace'
}
