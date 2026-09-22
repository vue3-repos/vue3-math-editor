# Cursor refactor: design record

_Recorded 2026-09-23. Status: accepted; implementation in progress on `refactor/cursor-model`._

## Background

The editor started with **node highlighting**: the focused AST node was drawn with a
ring to show where the next edit would land and what it meant. On larger equations this
became confusing, so a **caret** (before/after a leaf) was bolted on. The result is a
hybrid where arrow keys, clicks, caret side and the highlight interact unpredictably.

## Review findings

### The caret cannot reach every gap

Walking `stepCaret` forward from the first stop (traced against commit `acbf7e8`):

| Equation | Stops visited | Missing |
|---|---|---|
| `x + 1/2 + 3` | before/after `x`, `1`, `2`, `3` | the gap just after the fraction as a whole |
| `sin(x)^2 = y` | starts inside the brackets at `x` … exponent … `y`, then "(root) after" | before `sin`; after `sin(x)`; the last stop is the whole equation, so the highlight ring is drawn instead of a caret |
| `x^2 + 1/(x+1)` | … stops after the last `1` in the denominator | the end of the equation is unreachable |

### Root cause

The caret is `(path to an AST node, before | after)` on the **semantic** AST. Only leaves
(numbers, identifiers, placeholders) own positions. The gaps users care about lie
between larger structures (after a fraction, before a function, outside brackets), and
none of those belong to a leaf, so they don't exist.

- `popOutOfSlot`, `isPureMultiplyAdjacency` and `climbForOperator`'s `splitAt` each patch
  one missing case, which is why the order feels unpredictable.
- When the caret lands on a non-leaf, `EquationEditor.vue` falls back to the highlight
  ring: the halfway state.
- ↑/↓ and Escape still move a highlight up and down the node tree
  (`selectParent` / `selectFirstChild`).
- Operator insertion (`wrapWithPrecedence`, `splitVariadicAtCaret`,
  `insertImplicitFactorAtPath`) is complex because typing edits the semantic tree directly.

### Separate bug

`focusEquationPath` in `EquationWorkbench.vue` assigns `focusedPath = path` and then
immediately `focusedPath = []`, so clicking, Tab, ↑/↓ and typing `(` all focus the whole
equation.

## Decision

Remove highlighting completely. The editor is **cursor-only**, on a new editing model.

1. **Edit a layout tree.** It is made of *rows* (lists of atoms). Structure atoms
   (fraction, superscript, root, brackets, derivative) contain named child rows.
2. **Derive the semantic tree.** The existing `AstNode` is produced by a parser over the
   rows after every change. The MathJSON, MathML and LaTeX renderers keep consuming
   `AstNode` unchanged.
3. **The cursor is a gap.** `{ path: RowPath, offset }`, with `0 ≤ offset ≤ row.length`.
   A row of *n* atoms has *n + 1* positions, an empty row has exactly one (drawn as a
   placeholder), and the end of the equation is `{ path: [], offset: root.length }`.
4. **One state object, changed only by pure commands.**
   `EditorState = { root, cursor, anchor? }`. Keyboard, mouse and toolbar dispatch
   commands. Rendering reads the state and never writes it. The DOM is read only for
   click hit-testing and caret placement.
5. **Arrow keys follow a fixed traversal order.**
   - → : if the atom after the cursor has child rows, enter its first row at offset 0;
     else offset + 1. At the end of a row, go to the next child row of the parent
     structure, else exit to just after the structure. At the end of the root row, stay.
   - ← : the exact mirror.
   - ↑/↓ : move between rows of the same structure (numerator ↔ denominator,
     root index ↔ radicand, derivative expression ↔ variable).
   - Invariant: pressing → from the start visits every position exactly once, ending at
     `root.length`, and ← retraces the same sequence in reverse.
6. **The caret is drawn as an overlay.** Its position comes from the bounding boxes of
   the atoms each side of the gap, tagged in KaTeX output via `\htmlData`.
7. **Selection is separate from the cursor.** It is `anchor` + `cursor` in the same row.
   A faint box round the cursor's current row may be derived from the cursor, but it
   never drives the cursor.

### Open questions and chosen defaults

| # | Question | Default adopted | Revisit when |
|---|---|---|---|
| 1 | Is `ab` one identifier or `a·b`? | One atom per letter; the parser treats consecutive letters as implicit multiplication, except known function names (`FUNCTION_REGISTRY`) | Step 2 (parser) |
| 2 | How is `a-b-c` represented? | Undecided: `Subtract` chain vs `Add` + `Negate` | Step 2 (parser) |
| 3 | Superscripts | A `sup` atom attaches to the atom before it at parse time (MathLive style); there is no `Power` atom with a base row | Step 2 if parsing gets awkward |

## Keep / replace / delete

**Keep:** `types/ast.ts`; `renderers/mathjson.ts`, `mathml.ts`, `latex.ts`;
`FUNCTION_REGISTRY` in `registry/nodes.ts`; undo/redo snapshots, the multi-equation list
and command mode in the workbench.

**Replace:**

- `EditorState` → `{ root, cursor, anchor? }`
- `navigation.ts` → `editor/cursor.ts`
- `commands.ts` → layout-tree editing commands
- `interactiveLatex.ts` → renders rows with `\htmlData` tags
- `EquationEditor.vue` → caret overlay and click-to-gap hit-testing only; keep the
  measuring code from `focusRect.ts`
- new `parse.ts`: rows → `AstNode`, with empty rows becoming `Placeholder`

**Delete:** the focus ring and `me-focused` code, `selectParent` and `selectFirstChild`,
the `caretSide` branches in the typing handlers, `tests/focusRect.spec.ts`. The navigation
and command specs will be rewritten.

## Plan

1. `editor/layout.ts` (types and builders) and `editor/cursor.ts` (movement), with
   exhaustive traversal tests. Nothing is wired into the UI yet.
2. `editor/parse.ts`, tested against the `AstNode` shapes the current tests expect.
3. Renderer: rows → tagged LaTeX, plus the caret overlay and hit-testing.
4. Rewire the workbench to the new commands; remove the old code.
