import type { AstNode } from './ast'

export type NodeChildKey =
  | 'left'
  | 'right'
  | 'numerator'
  | 'denominator'
  | 'base'
  | 'exponent'
  | 'expression'

export type NodePath = NodeChildKey[]

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
