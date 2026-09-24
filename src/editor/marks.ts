// Marks: what a field underlines or explains on hover. The parser's
// diagnostics are marks; so are units issues reported by a host (units.ts)
// and the units hints shown on hover.

export type MarkKind =
  // A parse problem: red wavy underline.
  | 'error'
  // A units problem reported by a units checker: amber wavy underline.
  | 'units'
  // Information only (a variable's units): no underline, shown on hover.
  | 'hint'

export interface Mark {
  message: string
  // Consecutive atoms of one row.
  atomIds: readonly string[]
  // Default 'error'.
  kind?: MarkKind
}

export const markKind = (mark: Mark): MarkKind => mark.kind ?? 'error'

// Whether a mark is a problem (underlined, and makes the field invalid).
export const isProblem = (mark: Mark) => markKind(mark) !== 'hint'
