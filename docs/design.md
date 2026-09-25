# Equation editor design

How the editor works inside, and why it works that way. For how it behaves from a user's
point of view, and the rules for how input is read, see
[Writing equations](writing-equations.md).

## The model

The editor is **cursor-only**: there is a caret, and optionally a selection, and nothing
else drives where an edit lands.

1. **It edits a layout tree, not the semantic tree.** The tree is made of *rows*, flat
   lists of atoms exactly as the user sees them left to right. A symbol atom is one typed
   glyph (a digit, a letter, an operator); a multi-digit number or a multi-letter name is
   several symbol atoms. Structure atoms (fraction, superscript, root, brackets,
   derivative, piecewise, a number's units) own named child rows. See `editor/layout.ts`.
2. **The semantic tree is derived.** After every change the parser turns the rows into an
   `AstNode` (`types/ast.ts`), which the MathJSON, Content MathML and output panels use.
   Editing never manipulates operator precedence directly.
3. **The cursor is a gap in a row.** `{ path: RowPath, offset }`, with
   `0 ≤ offset ≤ row.length`. A row of *n* atoms has *n + 1* positions, an empty row has
   exactly one (drawn as a placeholder), and the end of the equation is
   `{ path: [], offset: root.length }`.
4. **One state object, changed only by pure commands.**
   `EditorState = { root, cursor, anchor? }`. Keyboard, mouse and toolbar dispatch
   commands (`EditorState → EditorState`; a no-op returns the same object). Rendering
   reads the state and never writes it. The DOM is read only for click hit-testing and
   caret placement.
5. **Arrow keys follow a fixed traversal order.**
   - → : if the atom after the cursor has child rows, enter its first row at offset 0;
     else offset + 1. At the end of a row, go to the next child row of the parent
     structure, else exit to just after the structure. At the end of the root row, stay.
   - ← : the exact mirror.
   - ↑/↓ : move between stacked rows of a structure (numerator ↔ denominator, root index
     ↔ radicand, derivative expression ↔ variable, piecewise pieces within a column),
     landing on the gap nearest the caret's x position; with none above or below, move to
     the previous or next equation line.
   - Invariant: pressing → from the start visits every position exactly once, ending at
     `root.length`, and ← retraces the same sequence in reverse. The tests check this for
     every sample equation.
6. **The caret and selection are overlays.** Their positions come from the painted
   bounds of the atoms, which are tagged in KaTeX output via `\htmlData`, so neither ever
   changes the KaTeX layout.

### Where things live

| File | Responsibility |
|---|---|
| `editor/layout.ts` | Atom and row types, builders, child rows (`childRows`, `setChildRow`), row paths |
| `editor/cursor.ts` | Cursor positions and movement (`allPositions`, `moveLeft/Right/Up/Down`) |
| `editor/selection.ts` | Selection (anchor + cursor) and selection-aware navigation |
| `editor/commands.ts` | Every editing command |
| `editor/keymap.ts` | Keys → commands |
| `editor/history.ts` | Undo/redo, with typing grouped into steps |
| `editor/parse.ts` | Rows → `AstNode`, with diagnostics |
| `editor/identifiers.ts` | Which runs of characters are names, and which are functions |
| `editor/numbers.ts` | Which runs of characters are numbers, including scientific notation |
| `editor/numberUnits.ts` | A number's hidden units: settling the cursor, what typing continues, tidying |
| `editor/operators.ts` | Comparison and logical operators |
| `editor/constants.ts` | π, e, ∞, NaN, true, false |
| `editor/marks.ts` | Marks: underlines (parse errors, units issues) and hover hints |
| `editor/units.ts` | The units interface: lines reported to a host, issues and hints shown from it |
| `registry/nodes.ts` | The known functions: MathML tags, MathJSON names, LaTeX names |
| `editor/clipboard.ts` | Copy, cut and paste; LaTeX in and out |
| `editor/exports.ts` | "Copy as" and the output panels' Content MathML, including CellML mode |
| `editor/caretGeometry.ts` | Caret, selection and mark boxes; click hit-testing |
| `renderers/layoutLatex.ts` | Rows → tagged KaTeX LaTeX for the editing surface |
| `renderers/mathjson.ts`, `renderers/mathml.ts` | `AstNode` → MathJSON, Content MathML |
| `components/MathField.vue` | One editable equation: rendering, overlays, keyboard, mouse, clipboard events |
| `components/EquationWorkbench.vue` | Lines, undo history, `\` command mode, toolbar, output tabs, `side` slot |
| `units/libcellml.ts` | The parts of libcellml.js the checker uses, typed structurally; releasing its objects |
| `units/library.ts` | The units library: the user's CellML units files, keeping only their `<units>` |
| `units/check.ts` | Checking a line's units with libCellML: prechecks, the check model, the analyser |
| `units/messages.ts` | Reading libCellML's units messages: operands, variables, numbers |
| `units/useUnitsChecker.ts` | The Vue composable: libcellml.js from the vue3-libcellml.js plugin, if there |
| `units/UnitsPanel.vue`, `units/panel.ts` | The units panel: units files, new units, each variable's units |
| `units/definitions.ts`, `units/UnitsDefinitionForm.vue` | New units: definitions, their checks, the units-only CellML file; the form |
| `App.vue`, `main.ts`, `demo/` | The demo: workbench, units panel and checker; example units |

## Parsing

`editor/parse.ts`. Grammar, loosest to tightest binding:

```
or         := xor ( '∨' xor )*
xor        := and ( '⊻' and )*
and        := not ( '∧' not )*
not        := '¬' not | comparison
comparison := additive ( ('=' | '<' | '>' | '≤' | '≥' | '≠') additive )?
additive   := unary ( ('+' | '-') unary )*
unary      := '-' unary | term
term       := factor ( ['*' | '·' | '×'] factor )*      implicit or explicit
factor     := primary superscript*
primary    := number | identifier | constant | function | group | fraction
            | root | derivative | piecewise
```

| Question | Decision |
|---|---|
| Is `ab` one identifier or `a·b`? | One identifier: letters, digits and underscores typed with no operator between them form one name (see *Names*). Products of names need `*`. |
| How is `a-b-c` represented? | A left-associative binary `Subtract` chain: `a-b-c` → Subtract(Subtract(a,b),c), `a+b-c` → Subtract(Add(a,b),c). `+` and `·` runs are flattened into one `Add` / `Multiply`. A leading minus negates the whole following term: `-2x` → Negate(Multiply(2,x)). |
| Superscripts | A `superscript` atom attaches to the factor before it (`x^2` → Power(x,2)); with nothing before it, the base is a `Placeholder`. `sin^2(x)` → Power(sin(x), 2). |
| Where does `=` bind? | As a comparison like `<`, so a condition such as `x = 0 ∧ y > 1` groups as (x = 0) ∧ (y > 1). An equation `y = …` is the same `Equal` node. |
| Chains such as `a < b < c`? | Not allowed: the second comparison is a diagnostic ("join them with ∧"); the row is still parsed left to right. |

**The parser never throws.** Empty rows and missing operands become `Placeholder`.
Anything it cannot place (an unknown symbol, a comma outside function brackets, a
malformed number, a chained comparison) is skipped or kept and reported as a diagnostic
`{ message, atomIds }`, where `atomIds` are the consecutive atoms of one row the problem
covers (all five of `1.2.3`). Tokens record the atoms they were read from, so no source
mapping of the AST is needed.

## Input rules

The user-facing rules and their rationale are in [Writing equations](writing-equations.md);
these notes cover how they are implemented.

### Names

- A run of letters, digits and underscores that starts with a letter is one name: `Vm`,
  `Vm_init`, `x2`, and `ab` too. A number before a name is still a product: `2Vm` is 2·Vm.
- A name that is exactly a function's spelling (`sin`, `cosh`, `arcsin`, or an alias such
  as `ceil`) is that function, drawn upright. A longer name containing one (`cost`,
  `tangent`, `xsin`) is just a name. Letters are not converted as they are typed; the
  grouping is decided from the whole run when parsing, rendering and copying
  (`nameRuns` in `editor/identifiers.ts`).
- A name followed by brackets that isn't a known function is a product: `Vm(t)` is Vm·(t).
- The underscore is part of the name and shown literally, with no subscript formatting,
  deliberately, while the wider convention for variable-name formatting is undecided.
- Each character is still its own atom, so the cursor, selection and Backspace work one
  character at a time inside a name.
- Rendering: a multi-character name is drawn in `\mathit` (TeX's italic for words, so `Vm`
  reads as one name rather than V m) and kept together, so an exponent applies to the
  whole name.
- A Greek letter is a single symbol atom (`\alpha`, or its name settled, below). It is a
  word of a name of its own: joined to the rest by `_` or followed by digits it is part
  of the name (`α_m` is `alpha_m`, `τ2` is `tau2`); straight next to a letter it is a
  separate name (`αx` is α·x). `nameEnd` in `editor/identifiers.ts` holds the rule, for
  `nameRuns`, `numberRuns` and the parser alike. `\sin` and the toolbar insert a function
  atom.
- **Reserved names:** a name that is exactly a constant's MathML name (`pi`,
  `exponentiale`, `infinity`, `notanumber`, `true`, `false`) is the constant, as a function
  spelling is the function (`reservedConstant`); `e` alone stays a variable.
- **Settled names** (`editor/names.ts`). One way of writing each name: `settleNames`
  replaces every name the cursor isn't in, or at the end of, with its settled form
  (`nameAtoms`): a reserved name becomes the constant atom; with Greek names on, each
  word that is a Greek letter's name, perhaps with digits (`greekWord`), becomes the
  letter atom. The workbench applies it with every state (after `settleState`), to the
  line left when the active line changes (`cursorAway`), and to every line when its
  `greekNames` prop changes; the unit tests' `press` does the same. With Greek names off
  names are left as typed, and Greek atoms are drawn (`rowToLatex`) and copied
  (`rowToLatexSource`) spelled out, `\mathit{alpha}`, so both spellings look alike either
  way. So a Greek word stays spelled out while being typed and becomes the letter when
  the caret leaves, and the caret then steps over it as one atom; Backspace deletes it.
  Copying as LaTeX writes `\alpha \_m`, which pastes back as the one name. The Content
  MathML import writes names settled too, and warns of variables with reserved names.

### Numbers

- `numberAt(row, i)` (`editor/numbers.ts`) reads digits and decimal points, then an
  exponent only when `e`/`E`, an optional sign and at least one digit follow. So `2e` is
  2·e and `2e-x` is 2·e − x, while `2e5x` is 2e5·x. The name and number scans share one
  pass (`nameRuns` / `numberRuns`), so the e of a number never starts a name, and digits
  after a letter stay in the name (`x2e5`).
- A `Number` node keeps its value and, when written in scientific notation,
  `scientific: { mantissa, exponent }` (the mantissa as typed). A decimal point in the
  exponent (`1e-0.5`) is a malformed number, and a value too big for a double (`1e999`)
  is out of range; both are diagnostics.
- Rendering: the number is one piece (an exponent after it attaches to the whole number).
  The e is `\mathrm{e}` and the sign is braced (`{-}`): a bare `-` stays a binary operator
  inside `\htmlData` and would get operator spacing.
- Content MathML uses e-notation, `<cn type="e-notation">1<sep/>-8</cn>`, which CellML 2.0
  allows alongside `real`. A plain number that JavaScript prints in exponent form
  (`0.0000001`) is written the same way, since a `type="real"` `<cn>` can't hold an
  exponent. MathJSON writes the number (`1e-8`). LaTeX is `1\mathrm{e}{-08}`.
- **Units:** a `UnitsAtom` straight after a number gives it units: `0.25{mV}`. Its row
  holds the units name typed as characters; its characters are never names or operators
  (`nameOccurrences` skips it). The parser attaches it to the number before it
  (`Number.units`); units anywhere else, or an empty or invalid name (not a CellML
  identifier), are diagnostics. A number without units is dimensionless: CellML mode
  writes `cellml:units="dimensionless"` (`DEFAULT_NUMBER_UNITS`). MathJSON has the number
  only; LaTeX (copying, and the LaTeX tab) leaves the units out, as on screen, but pasting
  still reads `0.25\,\mathrm{mV}`, `0.25{mV}` and CellML Text's `0.25 {units: mV}`.
- **Hidden units** (`editor/numberUnits.ts`). The units are for the Content MathML, not the
  reader, so they are drawn (upright and light blue after a thin space, `me-units`) only
  while the cursor is in them or a problem mark covers them: MathField passes those ids
  as `shownUnits` to `rowToLatex`. Otherwise it draws only `\htmlClass{me-units-flag}{}`,
  a zero-width span whose `::after` is a very small light-blue triangle in the number's
  top right corner; it carries no `data-atom`, so caret geometry passes it by. Empty units
  (being typed) are a slot of their own kind, `me-units-ph`: a dashed light-blue box
  labelled "units", unlike the `\square` of other empty rows, and not a diagnostic; the
  line isn't `complete` meanwhile. Hover hints show
  every number's units (`unitsHintMarks`, even without variable units). So that hidden
  units never hide the caret:
  - The gap just before a units atom isn't a position: `settleState` moves the cursor (and
    anchor) after them, and `moveLeft`/`moveRight`/`allPositions`/`extendSelection` step
    over number and units together without entering the units. Leaving the units row
    either way lands after them. `gapGeometry` passes over undrawn units.
  - At the end of a number with units, `typeSymbol` puts what continues the number
    (digits, a point, an exponent and its sign) before the units; anything else goes after.
    `deleteBackward` there deletes the number's last digit, and with the last one the
    units (no memory of them for the next number).
  - `{` there reopens the units with the name selected; `{` with no number before the
    cursor does nothing (so no stray units are made).
  - `settleState` also removes units left empty once the cursor is out of them, and units
    left without a number (or one being typed: `1e-` counts) straight away. The workbench
    applies it to every state it stores (`setEquation`); the unit tests' `press` does the
    same. A removal on a cursor move isn't an undo step.
  - An issue that names a number, by value or by its units (undefined units), underlines
    only its digits (`digitIds`), so the units stay hidden; the message says what they
    are. Only a parse problem (an invalid units name) shows them.

### Conditions

Comparison and logical operators are listed once in `editor/operators.ts`, which the
parser, renderers, clipboard and keymap all read.

- **Symbols, not words:** < > ≤ ≥ ≠ ∧ ∨ ⊻ ¬, each one symbol atom, so conditions read as
  maths rather than code. They are typed as `<` `>`, `&` (∧) and `!` (¬), and `=` straight
  after `<`, `>` or `¬` combines with it (`typeEquals`: `<=` is ≤, `!=` is ≠). There are `\`
  commands for each (`\le`, `\and`, `\or`, `\xor`, `\not`, …).
- **AST:** `Less`, `Greater`, `LessEqual`, `GreaterEqual`, `NotEqual` (left/right),
  `And`, `Or`, `Xor` (flat children, like `Add`) and `Not`. MathJSON uses the same names;
  Content MathML uses `lt gt leq geq neq and or xor not`.
- **Rendering:** comparisons as relations (`\mathrel`), ∧ ∨ ⊻ as binary operators, ¬ as an
  ordinary symbol.

### Constants

`editor/constants.ts`: `<pi/>`, `<exponentiale/>`, `<infinity/>`, `<notanumber/>`,
`<true/>`, `<false/>`, CellML 2.0's constants.

- Each is one symbol atom whose value is the constant's name, inserted with `\pi`, `\e`,
  `\inf`, `\nan`, `\true`, `\false` (and synonyms), and parsed as a `Constant` node rather
  than an identifier. π is the Greek letter atom, so `\pi` is always the constant; the
  typed letters `pi` are the constant too (reserved, above), while a typed `e` is a
  variable.
- Drawn as π, upright e, ∞, NaN, true, false. MathJSON: `Pi`, `ExponentialE`,
  `{num: "+Infinity"}`, `{num: "NaN"}`, `True`, `False`.
- LaTeX: `\pi \mathrm{e} \infty \mathrm{NaN} \mathrm{true}`. When pasting, `\mathrm{e}`
  straight before a brace is the e of a scientific number (`1\mathrm{e}{-08}`, as copying
  writes it); otherwise it is Euler's number.

### Functions

`registry/nodes.ts` lists every function in CellML 2.0's MathML subset (a test checks it
against the spec's table 2.1). Each entry has its MathML tag, its MathJSON name (CortexJS
standard library: `Floor`, `Ceil`, `Asec`, `Arsinh`, …), its spellings, and whether LaTeX
has a command for it; those without one are copied as `\operatorname{arcsinh}`, which
pastes back.

- `min` and `max` take any number of arguments; `rem` and a two-argument `log` take two.
  Arguments are separated by top-level commas in the brackets.
- `rem` exports to MathJSON as `Remainder`, not `Mod`, since `Mod` takes the sign of the
  divisor.
- **Floor and ceiling are brackets**, ⌊x⌋ and ⌈x⌉, in the same spirit as ∧ and ¬ being
  symbols. They are bracket groups (`GroupDelimiter` includes `⌊ ⌋ ⌈ ⌉`, like `| |` for
  abs), parsed as `FunctionCall` floor / ceiling, so the exports are those of any
  function. `(` straight after a whole name spelling floor, ceil or ceiling (or its
  function atom) replaces the name with the brackets (`bracketFunctionBefore`), as `<=`
  becomes ≤; `)` closes the nearest round, floor or ceiling brackets. LaTeX is
  `\left\lfloor … \right\rfloor`; pasting reads that, bare `\lfloor … \rfloor`, and
  `floor(…)` / `\operatorname{floor}(…)`.

### Piecewise

- **Layout:** `PiecewiseAtom { pieces: [{ value, condition }], otherwise: Row | null }`.
  It is the one structure with a variable number of rows, so its branches are indexed:
  `value0`, `cond0`, `value1`, …, `otherwise`, and `childRows` lists them in that
  (reading) order, so → / ← / Tab / selection / placeholders work unchanged. Row paths
  encode as `r/2.cond1`. `setChildRow` replaces one child row of any atom; the tree
  update in commands and the clipboard's id refresh use it rather than writing
  `atom[branch]`, which can't address an indexed piece.
- **Vertical movement:** two columns. ↑/↓ move between values (with otherwise at the
  bottom) or between conditions; ↓ from the last condition goes to otherwise, the only
  row below it.
- **Rendering:** `\begin{cases} value & condition \\ … \\ otherwise & \text{otherwise}
  \end{cases}`, each cell a tagged row. KaTeX's array layout needed no changes to caret
  geometry or hit-testing. `cases` sets cells in text style (smaller fractions, as in
  print); `dcases` gave full-size fractions but crammed rows together.
- **Editing** (commands act on the innermost piecewise around the cursor, which may be
  deep inside a piece):
  - Inserted by `\cases` / `\piecewise` or the toolbar: one empty piece and an otherwise
    pre-filled with `0.0`, cursor in the first value. A selection becomes the first value.
  - **Enter** (`newPiece`) adds an empty piece below the current one; from otherwise, the
    new piece goes last. Outside a piecewise Enter does nothing in MathField and bubbles
    up, so the workbench adds a line.
  - **Backspace** at the start of an empty piece's value removes the piece; **Delete** in
    an empty piece does the same. The only piece is never removed this way.
  - Backspace or Delete in an empty otherwise removes it; `\otherwise` adds it back as
    `0.0`, selected so that typing replaces it.
- **Units of the default otherwise:** while the otherwise row is exactly `0.0`
  (`DEFAULT_OTHERWISE`) with no units, and the first piece's value is a number with units
  (optionally negated), the 0.0 takes those units (`inheritedOtherwiseUnits`): the parser
  gives the otherwise `Number` those units, so every export has them, and
  `numberOccurrences` reports them (the hover hint says "as in the first piece"). Without
  this, every piecewise with units would have a units problem until its 0.0 was given
  units. A first value that is an expression (`2*t`) gives nothing: its units are only
  known to the checker.
  - Backspace/Delete at the edge of a non-empty piecewise step out of it rather than
    dissolving it, since its rows don't join up into anything meaningful. One whose rows
    are all empty goes in one Backspace, like other structures.
- **Semantics:** a `Piecewise` node is a primary like a fraction, so it can appear
  anywhere in an expression. MathJSON is `["Which", condition₀, value₀, …, "True",
  otherwise]`; Content MathML is `<piecewise><piece>value condition</piece>…
  <otherwise>value</otherwise></piecewise>`, its own element rather than an `<apply>`.
- **LaTeX:** copied as `cases`. Pasting reads `cases`, `dcases` and `rcases`: `&` and `\\`
  separate cells and lines inside them (outside, `&` is still ∧), a leading `\text{if}`
  (or for, when) in a condition is dropped, and a condition of `\text{otherwise}` or
  `else` makes that line the otherwise.

## Rendering and the caret

- `renderers/layoutLatex.ts` wraps every atom in `\htmlData{atom=<id>}` and every row in
  `\htmlData{row=<path>}` (paths encoded as `r/2.num/0.sup`). Operators are wrapped as
  `\mathbin{…}` / `\mathrel{…}` / `\mathpunct{…}`, because `\htmlData` produces a plain
  enclosing span and would otherwise lose TeX's operator spacing. A superscript is
  attached to the previous atom's (or name's) LaTeX, `{base}^{…}`, so the exponent sits
  against the real base.
- `editor/caretGeometry.ts` measures *painted* bounds, not span boxes. KaTeX puts the
  inter-atom space inside the previous atom's span, pads fractions with `.nulldelimiter`
  spans, uses zero-height `.vlist` rows and clips huge radical SVGs, so it unions leaf
  rects and skips spacing, struts and padding.
- A gap's caret sits midway between the neighbouring atoms. Its height follows the
  adjacent text, not a tall neighbour. In an empty row there is no caret line; the active
  placeholder is highlighted (steadily, without blinking) instead.
- A click goes to the innermost row whose painted box contains the point, at the gap
  nearest the click's x. A click on a fraction bar goes before or after the whole
  fraction, not into the denominator.
- The selection box and problem underlines are drawn the same way, behind the equation
  (`selectionBox`, `atomsBox`).

## Editing

`editor/commands.ts` holds the commands, `editor/keymap.ts` maps keys to them, and
`MathField` runs them. `MathField` owns no state: it emits `navigate` with a new
`{ cursor, anchor }`, and `edit` with a new state plus what kind of edit it was (for undo
grouping).

| Key | Behaviour |
|---|---|
| digits, letters, `_ . + - = ,` | Insert at the cursor. `*` inserts `·`; `<` `>` insert themselves, `&` inserts ∧, `!` inserts ¬, and `=` after `<`, `>` or `¬` combines into ≤, ≥, ≠. |
| `/` | The operand before the cursor (back to the previous operator) becomes the numerator; the cursor goes to the denominator. `(x+1)/` drops the brackets. With nothing before the cursor, the cursor goes to an empty numerator. |
| `^` | Enters the adjacent superscript if there is one, otherwise adds one. |
| `{` `}` | `{` gives the number before the cursor its units, with the cursor inside to type the name; `}` leaves them. |
| `(` `)` | `(` inserts an empty group with the cursor inside (after `floor` or `ceil`, the name becomes ⌊ ⌋ or ⌈ ⌉). `)` leaves the enclosing round, floor or ceiling brackets; typed directly inside them, the atoms after the cursor move out (`(x‸+1` → `(x)‸+1`). |
| `\|` | Closes the absolute value the cursor is directly inside, otherwise opens one. |
| Space | Steps out of the innermost structure. |
| Enter | Inside a piecewise, a new piece below; otherwise unused (the workbench adds a line). |
| Backspace | Deletes the symbol before the cursor. After a structure it steps into it (or deletes it if empty). At the start of a later row it moves to the previous row; at the start of the first row it removes the structure but keeps its content (a piecewise is stepped out of instead). In an empty piece or otherwise, removes it. |
| Delete | The mirror image of Backspace. |
| Tab / Shift+Tab | Next / previous empty slot, wrapping. |
| `\name` | Command mode (workbench): `frac sqrt root abs dd pow cases otherwise floor ceil`, the comparison and logic commands, the constants, function names (inserted with brackets), Greek letters; any other name is typed out as letters. |

Handled by the workbench, from keys `MathField` leaves unused: Enter (new line); ↑/↓
with no row above or below, and Alt+↑/↓ (previous/next line); Backspace in an empty line
(remove it); Ctrl/Cmd+Z and Shift+Z / Y (undo/redo).

### Undo steps

Consecutive typing is one undo step, as in a text editor. The history lives in
`editor/history.ts`; `MathField` reports what kind of edit each key made (`EditInfo`:
typed a character, Backspace, Delete, or other), and the workbench turns that into an undo
group with `undoGroup` before recording the state.

- **Typed characters on one line join one step.** An operator (`+ - = · ,` and the
  comparison and logical operators) starts a new step, playing the part of the space
  between words, so undoing `x+1=2` gives `x+1`, then `x`, then nothing. The sign of a
  number's exponent is not an operator here, so `1e-08` is one step.
- **Repeated Backspace (or Delete) presses join one step**, separate from typing.
- **A new step starts** after moving the cursor, clicking or changing the selection,
  switching lines, undo or redo, or a pause of more than a second.
- **Always a step of their own:** structures, paste and cut, toolbar buttons and `\`
  commands, deleting a selection, adding or removing a piece or a line. Typing over a
  selection starts a new step that the following characters join.
- **Cursor-only commands are not undo steps.** Space and Tab change only the cursor, so
  the workbench treats them as navigation.
- Each step restores the state before its first edit, cursor and selection included.

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
| `(`, `\|`, `\abs`, `\floor`, `\ceil` | Bracket it; cursor after. |
| `^` | One atom gets an exponent directly; several are bracketed first: `(a+b)^□`. |
| `\sqrt` / `\root` | Radicand; cursor after the root / in the index. |
| `\sin` etc. | The argument: `sin(selection)`; cursor after. |
| `\dd` | The expression; cursor in the variable. |
| `\cases` | The first value; cursor in its condition. |

The caret is hidden while something is selected. Selection changes are not undo steps,
but each undo step restores the selection that existed before the edit.

## Clipboard

`editor/clipboard.ts`, wired up in `MathField` through the browser's `copy`, `cut` and
`paste` events, so the system shortcuts and Edit menu work. Chrome sends these events to a
focused, non-editable `div`, so no hidden text area is needed.

- **Copy** writes two formats. `application/x-semantic-math+json` holds the selected
  layout atoms, for an exact paste inside the editor. `text/plain` holds readable LaTeX
  (`rowToLatexSource`) for other apps. With nothing selected, copy does nothing.
- **Cut** is copy, then delete the selection (one undo step).
- **Paste** prefers the editor's own format; pasted atoms get fresh ids. Otherwise it
  reads `text/plain` with `latexToRow`, which takes LaTeX or plain typed maths:
  - LaTeX: `\frac`, `\dfrac`, `^{…}`, `\sqrt`, `\sqrt[n]`, `\left( … \right)`,
    `\left| … \right|`, floor and ceiling brackets, `\frac{\mathrm{d}…}{\mathrm{d}…}` (a
    derivative), `cases`, function commands and `\operatorname`, Greek letters,
    constants, comparison and logic commands, `\cdot`, `\times`, `\mathit{word}`,
    `\text{…}`. Spacing commands are ignored. `\square` is an empty slot.
  - Plain text: `a/b` makes a fraction of the operands either side (as typing `/` does),
    with brackets dropped from a bracketed operand. `^` takes a braced group, one
    character, or a whole run of digits (`x^10`). Letters follow the typing rules, `*`
    becomes `·`, and `<= >= != == &&` are the operators.
  - Subscripts aren't supported: the underscore is kept literally as part of the name, so
    `x_{12}` pastes as the name `x_12`.
  - Pasting replaces the selection and leaves the cursor after the pasted atoms (one undo
    step).
- `rowToLatexSource` and `latexToRow` round-trip every atom kind (unit-tested).

### Importing Content MathML

`editor/mathmlImport.ts` is the inverse of the Content MathML export. `MathField`'s paste
checks `looksLikeContentMathML` (text starting with `<math>`, `<apply>`, `<piecewise>`,
`<ci>` or `<cn>`, after an XML declaration or comments) before LaTeX, and emits `import`
with `importContentMathML`'s `{ equations, problems }`; the workbench puts one equation
in at the caret (`insertAtoms`, an ordinary paste) and replaces every line with several
(one undo step), and shows a dismissable note (`import-notice`) when there were several
or anything was left out.

- The text is parsed with `DOMParser` inside a wrapper declaring the MathML and CellML 2.0
  namespaces, so fragments and undeclared `cellml:` prefixes read; elements are matched
  by local name, and `units` by local name with a `cellml` prefix or a cellml.org
  namespace (CellML 1.0, 1.1 and 2.0).
- Each child of each `<math>` is one equation, built as rows: `<divide>` a fraction,
  `<power>` a superscript, `<root>` (with `<degree>`), `<abs>`, floor and ceiling brackets,
  functions (a function atom and bracketed arguments; `<log>` with `<logbase>` as
  `log(x, b)`), `<diff>` a derivative, `<piecewise>`, constants, relations and logic.
  `<cn>` keeps its text (e-notation as `1.5e-3`); a negative number is a minus and the
  number; `cellml:units` other than dimensionless give a units atom.
- Brackets: each result carries how loosely it binds (the parser's levels: or, xor, and,
  not, comparison, additive, unary, term, primary) and an operand looser than its place
  allows is bracketed: `(a+b)·c`, `a-(b-c)`, `a·(-b)`, `(-x)^2`. Two exceptions keep
  CellML's common forms readable: `a+-b`, and a negative first factor (`-0.1·x`, which
  reads as −(0.1·x), the same value).
- Unsupported elements (and a derivative of order other than 1) become an empty bracket
  slot with a problem; a variable named like a function (`max`) is reported, since it
  reads as the function.
- Tested by round trip: every kind of typed equation, exported in CellML mode and read
  back, exports identically.

## Exports

A "Copy as" menu in the workbench toolbar offers the three formats in `editor/exports.ts`.
It copies the selection if there is one, otherwise the whole active equation. A selection
is exported on its own: its atoms are parsed as a row of their own, so selecting `a+b` in
`y=a+b` gives `["Add","a","b"]`, and an incomplete selection (`+b`) gets placeholders. The
output panels show the same text for the whole active equation.

- **LaTeX** is `rowToLatexSource`, the same as Ctrl+C, which pastes back into the editor.
- **MathJSON** is the indented JSON of `astToMathJson`.
- **Content MathML** is a complete document: the renderer's output wrapped in
  `<math xmlns="http://www.w3.org/1998/Math/MathML">` and re-indented by `formatXml`, which
  keeps an element holding only text (and `<sep/>`) on one line, so no whitespace is added
  inside a `<cn>` or `<ci>`.

**CellML mode.** `EquationWorkbench` takes a `cellml` prop, off by default so other
consumers get plain Content MathML. When it is on, the Content MathML panel and "Copy as"
(labelled "Content MathML (CellML)") produce MathML ready for a CellML 2.0 model: the
root `<math>` also declares `xmlns:cellml="http://www.cellml.org/cellml/2.0#"`, and every
number carries `cellml:units`, which CellML requires on every `<cn>`: its own units
(`0.25{mV}`), or `dimensionless`. The option is `{ cellml: true }` on `exportRow`,
`contentMathML` and `astToContentMathML`; MathJSON and LaTeX ignore it. In the demo app,
open the page with `?cellml` to turn it on.

Copy as uses the async clipboard API (`text/plain` only), falling back to
`document.execCommand('copy')` where that isn't available.

## Marking problems

Problems are underlined in the field, with the message in a tooltip when the pointer is
over them. A mark (`editor/marks.ts`) has a kind: `error` (a parse problem, red), `units`
(a units issue from a host, amber) or `hint` (information such as a variable's units,
shown on hover with no underline). Where a problem and a hint overlap, the problem's
message is shown.

- **MathField takes `marks`.** Any `{ message, atomIds }` can be marked; a parser
  diagnostic is one. The underline box is the painted extent of the atoms. The tooltip is
  `position: fixed`, so the field's horizontal scrolling doesn't clip it. The field sets
  `aria-invalid` while it has marks.
- **Every line is marked.** The workbench parses each line (cached by row, so moving the
  cursor doesn't re-parse); the warning box under the equations lists only the active
  line's problems.

## Testing

- **Unit tests** (Vitest, `npm test`): `tests/*.spec.ts`. Pure model code (cursor
  movement, parser, commands, clipboard, exports, LaTeX generation), including randomised
  property tests (KaTeX accepts any layout tree the renderer produces).
- **Browser tests** (Playwright, `npm run test:e2e`): `tests/e2e/`. These drive the
  workbench in Chromium, because caret placement and click hit-testing depend on real
  KaTeX layout, which jsdom doesn't do. `tests/e2e/samples.ts` defines each sample
  equation as the keys that type it plus the layout tree it must produce. Every test that
  uses a sample first checks the typed result matches that tree (same rows, same atom
  counts, same MathJSON), then computes the expected cursor positions from it. Assertions
  read the cursor and MathJSON the workbench prints, not pixels. The config starts the
  Vite dev server itself.
- **Screenshot tests** are opt-in (`npm run test:e2e:visual`, tagged `@visual`), because
  font rendering differs by OS. Baselines are per platform; create or refresh them with
  `npm run test:e2e:visual -- --update-snapshots`.
- One-off setup after `npm install`: `npx playwright install chromium`.

## Units checking

Units checking is done outside the editor, so the editor stays a plain equation editor and
libCellML is never a dependency of it. The two meet only at the workbench's interface,
described for users of the component in [Component interface](component-interface.md).

**The editor's side (done)** is `editor/units.ts`:

- **Lines out.** Each line has a stable id (`line-1`, …; kept in undo history), so issues
  stay on the right line as lines are added or removed. `equations-change` reports every
  line whenever any line's content changes: its id, its Content MathML in CellML mode,
  the variables it uses (from the AST), the units names its numbers use, and whether it
  is complete (no parse problems, no placeholders). Lines are cached by row, so moving
  the cursor neither recomputes nor re-emits.
- **Issues in.** The `issues` prop gives problems by line id and variable names (and
  optionally numbers, by value). `unitsIssueMarks` finds every occurrence with
  `nameOccurrences` / `numberOccurrences` and makes `units` marks; the workbench adds them
  to the line's parse marks and lists the active line's issues under the equations.
- **Hints in.** The `variableUnits` prop (name → units) gives hover hints for variables,
  and with it numbers show their own units (or dimensionless) on hover.
- Issues can also name numbers by the units they were given (`units`), so a number with
  an undefined units name is underlined along with its units.
- Names are already valid CellML identifiers: `[A-Za-z][A-Za-z0-9_]*`, and Greek letters
  export by name (`<ci>alpha</ci>`).

**The checker (done)** is `src/units/`, separate from the editor and optional. Nothing in
it imports libcellml.js: the host loads it (the vue3-libcellml.js plugin provides it as
`$libcellml`) and the checker is handed the loaded module, typed structurally
(`units/libcellml.ts`). Without the plugin, `useUnitsChecker` reports `available: false`
and no issues, and the editor is unchanged. libcellml.js is only a devDependency, for
the tests.

- **The units library** (`UnitsLibrary.load(lc, files)`) reads each CellML file with the
  non-strict parser, so CellML 1.0 and 1.1 files are read too, and keeps only its
  `<units>`. Built-in names win over redefinitions; the first definition of a name wins,
  with a problem reported if a later file defines it differently (compared with
  `Units.equivalent`, which includes the scale); imported units are skipped; units made
  from undefined units are reported. Loading never changes the files: **units the user
  defines go into a units-only CellML file of their own**, handed to the host, never
  written back into a source file (no side effects).
- **New units** (`units/definitions.ts`) are plain data (`UnitsDefinition`: a name and
  parts, each units with an optional prefix, exponent and multiplier), kept by the host
  through the panel's `v-model:new-units`. `definitionProblems` checks one (a CellML name,
  not taken; parts known; not made of itself, directly or through other new units);
  `newUnitsFile` writes them as a CellML 2.0 model of units only, dependencies first,
  as a string (no libCellML). `useUnitsChecker` appends that file to the sources as
  `'new units'`, so the library, the names suggested and the checks include them, and
  returns its text for the host to keep. Renaming new units renames them in the other
  new units' parts; units other new units use can't be removed.
- **Prechecks.** Before libCellML sees a line, every variable must have units (else "x
  has no units") and every units name, the variables' and the numbers', must be known
  (else "No units called … are defined", underlining the variables and numbers using it).
  Either would stop the analyser, which only runs on a valid model.
- **A check model per line**, so one bad line doesn't stop the others: a component named
  `equation` with a variable per name the line uses (with its units) and the line's
  MathML, plus only the library units those need (`requiredBy`, following units made
  from other units). `linkUnits()` is essential: units are set by name, and unlinked
  library units are taken as undefined and silently skipped.
- **Analyse** and keep the issues with reference rule 112. Other analyser issues are about
  the model (unknown variables, uninitialised states, "not an equality"), which a single
  equation always has. Validator errors after the prechecks would mean the check model
  is wrong, so they are passed on rather than hidden.
- **Messages** (`units/messages.ts`) are read for the operands at fault and their units,
  and reworded without the check model's names: "Units don't match in t+2.0: t is in
  second, 2.0 is dimensionless", "t in exp(t) must be dimensionless, but is in
  second". The variables underlined are those in the operands (derivatives are written
  `dx/dt`); an operand with no variables underlines its numbers.
- **Caching.** A line's result depends only on its MathML and its variables' units, which
  is the cache key; a new library means a new checker and an empty cache. The line id
  isn't in the check model, so a line keeps its cached result when lines above it move.
- **libcellml.js objects** wrap C++ memory that JavaScript doesn't collect; every one the
  checker creates is released (`Handles`). 3,000 checks leave the WebAssembly memory
  unchanged.

**The demo (done)** puts it together (`App.vue`). `main.ts` installs vue3-libcellml.js
with a dynamic import, so with `?nolibcellml` the plugin is never loaded and the page
runs as an application without it would. The `UnitsPanel` sits in the workbench's
`side` slot, to the right of the editor (sticky), with the outputs in tabs under the
editor (grid areas `editor side / outputs side`; without a side slot, `editor
outputs`); the workbench's capture-phase key handling (`\` command mode, undo) ignores
keys from that slot. The keyboard help is folded away under "Keys and typing". Checking is `enabled` once a units file is loaded or a
variable has units; the Example button loads `demo/example-units.cellml` (ms, mV,
µA/cm², …) and units for `dV/dt = -(I_ion - I_stim)/C_m`. The browser-test hook
(`window.__workbench.setUnits`) replaces the checker's issues once used. The Vite
config excludes vue3-libcellml.js and libcellml.js from dependency pre-bundling, which
would break libcellml.js finding its WebAssembly (`new URL('libcellml.wasm',
import.meta.url)`); in a build, the WebAssembly and the plugin are separate chunks.

Browser tests wait for libCellML to load before starting (`Workbench.goto`): compiling
the WebAssembly slows the page meanwhile, which made a caret test flaky; `caretBox` now
also reads the caret in one step, since the element is replaced on every move.

Findings from trying libcellml.js 0.7.1 on the editor's output:

- The analyser's units check works on it, including piecewise, scientific numbers and
  constants. Units problems are warnings with reference rule 112 (`ANALYSER_UNITS`), for
  example: `The units in 't+2.0' in equation 'x = t+2.0' in component 'equation' are not
  equivalent. 't' is in 'second' while '2.0' is 'dimensionless'.` Other analyser issues
  (unknown variable types, uninitialised states) are about the model, not the equation,
  and are ignored.
- Units issues have no structured location (`issue.item()` is `UNDEFINED`), so the
  variables come from parsing the message. Structured units issues in libCellML (the
  variables, or the AST node, involved) would remove that.
- The analyser only runs on a valid model: an unknown units name on a `<cn>` stops it,
  hence numbers defaulting to dimensionless.
- Loading takes about 75 ms and analysis about 20–30 ms per equation, so checking only the
  edited line, after a pause, is enough. The WebAssembly is about 2.3 MB (640 KB gzipped).
- Units that differ only in scale (`mV` and `volt`) are reported anywhere in an equation:
  in a sum, a function's arguments, a condition, or between the pieces of a piecewise.
- A piecewise whose pieces disagree is reported against the whole piecewise, with both
  sides in the same units (`'y' is in 'second' while '(t < 1.0)?t:0.0' is in 'second'`);
  the checker rewords it as "The parts of … have different units". A default otherwise
  0.0 takes the first piece's units when that is a number (see *Piecewise*), so this
  comes up for real disagreements, or a first piece that is an expression.
- A line that is only a comparison (`x < y`) isn't an equation, so libCellML checks none
  of its units.

## Open questions

- **The otherwise default with an expression first.** A default 0.0 takes the units of a
  first piece that is a number with units, but not of one that is an expression, whose
  units only the checker knows. The checker could say which units it needs.
- **Subscripts in names.** The underscore is shown literally while the convention for
  formatting variable names (subscripts, and superscripts within them) is undecided. The
  `greekNames` switch could grow into a "typeset names" switch: α_m with m as a subscript.
- **Boolean-valued equations.** Because `=` is a comparison, `b = x < 1` is a chained
  comparison; it has to be written `b = (x < 1)`. Rare in CellML, where variables are
  real-valued.
- **`rem` in MathJSON.** Exported as `Remainder`, which isn't confirmed in the CortexJS
  documentation.
- **Argument counts** aren't checked (`rem(x)` or `sin(x, y)` give no diagnostic).
- **Long equations** scroll horizontally in the field rather than wrapping.

## History

The editor originally used node highlighting: the focused AST node was drawn with a ring
to show where the next edit would land, and a caret was later added alongside it. The
caret moved over the semantic tree, where only leaves owned positions, so many gaps
(after a fraction, before a function, the end of the equation) could not be reached, and
the caret and the highlight interacted unpredictably. In September 2026 it was replaced
by the cursor-only model above (branch `refactor/cursor-model`); the review that led to
the change and the step-by-step plan are in that branch's history.
