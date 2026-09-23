# Cursor refactor: design record

_Recorded 2026-09-23. Status: accepted; implementation in progress on `refactor/cursor-model` (steps 1–4, selection, clipboard and "copy as" done)._

For how the editor behaves from a user's point of view, see
[Writing equations](writing-equations.md).

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

### Representation decisions

Settled in step 2 (`src/editor/parse.ts`):

| # | Question | Decision |
|---|---|---|
| 1 | Is `ab` one identifier or `a·b`? | One identifier. Letters, digits and underscores typed with no operator between them form one name (`Vm_init`, `x2`, `ab`); products of names need `*`. A name that is exactly a function's spelling is that function. Revised after step 4; see *Multi-character names* below. |
| 2 | How is `a-b-c` represented? | A left-associative binary `Subtract` chain: `a-b-c` → Subtract(Subtract(a,b),c), `a+b-c` → Subtract(Add(a,b),c). `+` and `·` runs are flattened into one `Add` / `Multiply`. A leading minus negates the whole following term: `-2x` → Negate(Multiply(2,x)). |
| 3 | Superscripts | A `superscript` atom attaches to the factor before it (`x^2` → Power(x,2)); with nothing before it, the base is a `Placeholder`. `sin^2(x)` → Power(sin(x), 2). |

The parser never throws. Empty rows and missing operands become `Placeholder`, and
glyphs it cannot place (an unknown symbol, a comma outside function brackets, a
malformed number) are skipped and returned as diagnostics tied to the atom's id, so
the UI can mark them.

### Multi-character names

Adopted after trying it on a branch. This replaced the original decision 1 ("one symbol
atom per typed letter; `xy` is x·y"), and function names are no longer converted as they
are typed. The user-facing rules and their rationale are in
[Writing equations](writing-equations.md).

- A run of letters, digits and underscores that starts with a letter is one name:
  `Vm`, `Vm_init`, `x2`, and `ab` too. Multiplying names needs an explicit operator,
  `a*b` (shown as ·). A number before a name is still a product: `2Vm` is 2·Vm.
- A name that is exactly a function's spelling (`sin`, `cosh`, `arcsin`) is that function,
  drawn upright. A longer name containing one (`cost`, `tangent`, `xsin`) is just a name.
  Letters are no longer converted as they are typed; the grouping is decided from the
  whole run when parsing and rendering (`editor/identifiers.ts`, shared by the parser, the
  renderer and the clipboard).
- A name followed by brackets that isn't a known function is a product: `Vm(t)` is Vm·(t).
- The underscore is part of the name and shown literally, with no subscript formatting,
  deliberately, while the wider convention for variable-name formatting is undecided.
- Each character is still its own atom, so the cursor, selection and Backspace work one
  character at a time inside a name.
- Rendering: a multi-character name is drawn in `\mathit` (TeX's italic for words, so
  `Vm` reads as one name rather than V m) and kept together, so an exponent applies to
  the whole name.
- Commands: `\alpha` and the other Greek names insert the Greek letter. Any other
  `\name` types the name out as letters. `\sin` and the toolbar still insert a function
  atom.
- Clipboard: a name is copied as `\mathit{Vm\_init}` and a function spelling as `\sin`.
  Pasting reads letters as typed characters (so plain text follows the same rules), and
  keeps `_` literally: `x_{12}` pastes as the name `x_12`.

### Rendering and caret notes (step 3)

- `renderers/layoutLatex.ts` wraps every atom in `\htmlData{atom=<id>}` and every row in
  `\htmlData{row=<path>}` (paths encoded as `r/2.num/0.sup`). Operators are wrapped as
  `\mathbin{…}` / `\mathrel{…}` / `\mathpunct{…}` so KaTeX keeps TeX spacing. A
  superscript is attached to the previous atom's LaTeX (`{base}^{…}`), so the exponent
  sits against the real base.
- `editor/caretGeometry.ts` measures *painted* bounds, not span boxes. KaTeX puts the
  inter-atom space inside the previous atom's span, pads fractions with
  `.nulldelimiter` spans, uses zero-height `.vlist` rows and clips huge radical SVGs,
  so it unions leaf rects and skips spacing, struts and padding.
- A gap's caret sits midway between the neighbouring atoms. Its height follows the
  adjacent text, not a tall neighbour. In an empty row there is no caret line; the
  active placeholder is highlighted and blinks instead.
- A click goes to the innermost row whose painted box contains the point, at the gap
  nearest the click's x. ↑/↓ go to the gap nearest the caret's current x.
- `components/MathField.vue` handles navigation (arrow keys, Home/End, click) and, since
  step 4, typing; it emits `update:cursor` and `edit`.
- Steps 3–4 used a development page (`playground.html`, `src/dev/`) to exercise the
  field on its own. It was removed once the browser tests could drive the workbench
  directly.

### Editing behaviour (step 4)

`editor/commands.ts` holds pure commands (`EditorState → EditorState`); a no-op returns
the same object. `editor/keymap.ts` maps keys to them, and `MathField` runs them.

| Key | Behaviour |
|---|---|
| digits, letters, `+ - = ,` | Insert at the cursor. `*` inserts `·`. |
| letters spelling a function | Become a function atom as you type (`sin`, `cosh`, `arcsin`; longest match wins). Backspace turns it back into letters (`sin` → `si`). |
| `/` | The operand before the cursor (back to the previous operator) becomes the numerator; the cursor goes to the denominator. `(x+1)/` drops the brackets. With nothing before the cursor, the cursor goes to an empty numerator. |
| `^` | Enters the adjacent superscript if there is one, otherwise adds one. |
| `(` `)` | `(` inserts an empty group with the cursor inside. `)` leaves the enclosing group; typed directly inside it, the atoms after the cursor move out (`(x‸+1` → `(x)‸+1`). With no open group it does nothing. |
| `\|` | Closes the absolute value the cursor is directly inside, otherwise opens one. |
| Space | Steps out of the innermost structure. |
| Backspace | Deletes the symbol before the cursor. After a structure it steps into it (or deletes it if empty). At the start of a later row it moves to the previous row; at the start of the first row it removes the structure but keeps its content. |
| Delete | The mirror image of Backspace. |
| Tab / Shift+Tab | Next / previous empty slot, wrapping. |
| `\name` | Command mode (workbench): `frac sqrt root abs dd pow`, function names (inserted with brackets), anything else becomes a named symbol (`\alpha`). |

Handled by the workbench, from keys `MathField` leaves unused: Enter (new line); ↑/↓
with no row above/below, and Alt+↑/↓ (previous/next line); Backspace in an empty
line (remove it); Ctrl/Cmd+Z and Shift+Z / Y (undo/redo, one step per edit).

### Selection

`editor/selection.ts`. The state carries an optional `anchor` beside the `cursor`. The
selection is always a range of whole atoms in one row: the innermost row that contains
both ends. An end that lies inside an atom of that row takes the whole atom, so dragging
from a numerator out into the main row selects the whole fraction.

| Input | Behaviour |
|---|---|
| Shift+← / → | Extend one whole atom at a time along the cursor's row (a fraction or root is taken in one step, never entered); at the end of a row, take the enclosing structure. |
| Shift+Home / End, Ctrl/Cmd+A | Extend to the start / end of the equation; select everything. |
| Drag, Shift+click | Select from the drag start (or the cursor) to the pointer. |
| ← / → | Collapse to the start / end of the selection. ↑/↓ drop it and move. |
| Escape | Clear it, leaving the cursor where it is. |
| Typing | Replaces the selection. Backspace / Delete remove it. Space collapses to its end. `)` collapses to its end, then closes the group, so the selection stays inside. |
| `/`, `\frac`, toolbar fraction | The selection becomes the numerator (a single bracketed group loses its brackets); cursor to the denominator. |
| `(`, `\|`, `\abs` | Bracket it; cursor after. |
| `^` | One atom gets an exponent directly; several are bracketed first: `(a+b)^□`. |
| `\sqrt` / `\root` | Radicand; cursor after the root / in the index. |
| `\sin` etc. | The argument: `sin(selection)`; cursor after. |
| `\dd` | The expression; cursor in the variable. |

The selection is drawn as a translucent box behind the equation (`selectionBox` in
`caretGeometry.ts`), like the caret overlay, so it never changes the KaTeX layout. The
caret is hidden while something is selected. Selection changes are not undo steps, but
each undo step restores the selection that existed before the edit.

### Copy, cut and paste

`editor/clipboard.ts`, wired up in `MathField` through the browser's `copy`, `cut` and
`paste` events, so the system shortcuts and Edit menu work. Chrome sends these events
to a focused, non-editable `div`, so no hidden text area is needed.

- **Copy** writes two formats. `application/x-semantic-math+json` holds the selected
  layout atoms, for an exact paste inside the editor. `text/plain` holds readable LaTeX
  (`\frac{1}{x}+y`) for other apps. With nothing selected, copy does nothing and the
  clipboard is left alone.
- **Cut** = copy, then delete the selection (one undo step).
- **Paste** prefers the editor's own format; pasted atoms get fresh ids. Otherwise it reads
  `text/plain` as LaTeX, which also covers plain typed maths:
  - LaTeX: `\frac`, `\dfrac`, `^{…}`, `\sqrt`, `\sqrt[n]`, `\left( … \right)`,
    `\left| … \right|`, `\frac{\mathrm{d}…}{\mathrm{d}…}` (a derivative), function
    commands and `\operatorname`, Greek letters, `\cdot`, `\times`, `\mathit{word}`,
    `\text{…}`. Spacing commands are ignored. `\square` is an empty slot.
  - Plain text: `a/b` makes a fraction of the operands either side (as typing `/` does),
    with brackets dropped from a bracketed operand. `^` takes a braced group, one
    character, or a whole run of digits (`x^10`). Letters spelling a function become
    that function, and `*` becomes `·`.
  - Subscripts aren't supported: the content of `_…` is kept inline.
  - Pasting replaces the selection and leaves the cursor after the pasted atoms (one undo
    step).
- `rowToLatexSource` and `latexToRow` round-trip every atom kind (unit-tested).

### Copy as LaTeX / MathJSON / Content MathML

A "Copy as" button in the workbench toolbar opens a menu (PrimeVue `Menu`) with the three
formats from `editor/exports.ts`. It copies the selection if there is one (the button
then reads "Copy selection as"), otherwise the whole active equation. A selection is
exported on its own: its atoms are parsed as a row of their own, so selecting `a+b` in
`y=a+b` gives `["Add","a","b"]`, and an incomplete selection (`+b`) gets placeholders.
Focus and the selection return to the equation afterwards, and the button briefly
confirms the format copied.

- **LaTeX** is the same readable LaTeX as Ctrl+C (`rowToLatexSource`), which pastes back
  into the editor. This is not the text in the LaTeX output panel, which comes from the
  AST renderer.
- **MathJSON** is the indented JSON shown in the MathJSON panel.
- **Content MathML** is a complete document: the renderer's output wrapped in
  `<math xmlns="http://www.w3.org/1998/Math/MathML">` and re-indented by `formatXml`. The
  Content MathML panel now shows the same document.

Copy as uses the async clipboard API (`text/plain` only), falling back to
`document.execCommand('copy')` where that isn't available.

### Testing

- **Unit tests** (Vitest, `npm test`): `tests/*.spec.ts`. Pure model code (cursor
  movement, parser, LaTeX generation), including randomised property tests.
- **Browser tests** (Playwright, `npm run test:e2e`): `tests/e2e/`. These drive the
  workbench in Chromium, because caret placement and click hit-testing depend on real
  KaTeX layout, which jsdom doesn't do. `tests/e2e/samples.ts` defines each sample
  equation as the keys that type it plus the layout tree it must produce. Every test
  that uses a sample first checks the typed result matches that tree (same rows, same
  atom counts, same MathJSON), then computes the expected cursor positions from it.
  Assertions read the cursor and MathJSON the workbench prints, not pixels. The config
  starts the Vite dev server itself.
- **Screenshot tests** are opt-in (`npm run test:e2e:visual`, tagged `@visual`),
  because font rendering differs by OS. Baselines are per platform; create or refresh
  them with `npm run test:e2e:visual -- --update-snapshots`.
- One-off setup after `npm install`: `npx playwright install chromium`.

## What was kept, replaced and removed

**Kept:** `types/ast.ts`; `renderers/mathjson.ts`, `mathml.ts`, `latex.ts`; `registry/nodes.ts`
(`FUNCTION_REGISTRY`; `NODE_REGISTRY` is now unused); the workbench's undo/redo,
multi-line list, command mode, toolbar and output panels.

**Replaced:** `editor/commands.ts` (now layout-tree commands); `EquationWorkbench.vue`
(now built on `MathField`); the `EditorState` type (now `{ root, cursor }`, in
`editor/commands.ts`).

**Removed:** `editor/navigation.ts`, `editor/focusRect.ts`, `renderers/interactiveLatex.ts`,
`components/EquationEditor.vue`, `types/editor.ts`, and their tests
(`navigation.spec.ts`, `focusRect.spec.ts`; `commands.spec.ts` was rewritten).

## Plan

1. `editor/layout.ts` (types and builders) and `editor/cursor.ts` (movement), with
   exhaustive traversal tests. Nothing is wired into the UI yet.
2. `editor/parse.ts`, tested against the `AstNode` shapes the current tests expect.
3. Renderer: rows → tagged LaTeX, plus the caret overlay and hit-testing.
4. Rewire the workbench to the new commands; remove the old code.

### Possible next steps

- A keyboard shortcut for "copy as" (e.g. Ctrl+Shift+C for the last format used).
- Make the LaTeX output panel show the same LaTeX as copying does.
- Pasting several lines as several equations.
- Subscripts (`_`), if needed for variable names like x₁.
- Marking parser diagnostics on the offending atom (each diagnostic carries its
  `atomId`).
- Coalescing consecutive typing into one undo step.
- Removing `NODE_REGISTRY` if nothing needs it.
