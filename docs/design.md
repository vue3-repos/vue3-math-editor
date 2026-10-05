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
   changes the KaTeX layout. So is the tint behind the row the cursor is in (any row but
   the root, and not an empty one, whose placeholder is highlighted instead): it is the
   row's painted bounds, wider than tall so a caret at either end is inside it. It tells
   apart positions that are painted almost in the same place, such as the end of a root's
   body and the gap after the root.

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
| `editor/nameScripts.ts`, `editor/names.ts` | How a name is typeset: its scripts and decorations (bar, charge, concentration); settled names, and adding a decoration (`withNameKeyword`) |
| `editor/numbers.ts` | Which runs of characters are numbers, including scientific notation |
| `editor/numberUnits.ts` | A number's hidden units: settling the cursor, what typing continues, tidying |
| `editor/operators.ts` | Comparison and logical operators |
| `editor/constants.ts` | π, e, ∞, NaN, true, false |
| `editor/marks.ts` | Marks: underlines (parse errors, units issues) and hover hints |
| `editor/units.ts` | The units interface: lines reported to a host, issues and hints shown from it |
| `registry/nodes.ts` | The known functions: MathML tags, MathJSON names, LaTeX names |
| `editor/clipboard.ts` | Copy, cut and paste; LaTeX in and out |
| `editor/exports.ts` | "Copy as" and the output panels' Content MathML, including CellML mode |
| `editor/caretGeometry.ts` | Caret, selection, mark and active-row boxes; click hit-testing |
| `renderers/layoutLatex.ts` | Rows → tagged KaTeX LaTeX for the editing surface |
| `renderers/mathjson.ts`, `renderers/mathml.ts` | `AstNode` → MathJSON, Content MathML |
| `components/MathField.vue` | One editable equation: rendering, overlays, keyboard, mouse, clipboard events |
| `editor/toolbar.ts` | The toolbar's groups and galleries: each button's LaTeX, title and command |
| `components/EquationWorkbench.vue` | Lines, undo history, committing lines, problems and the status bar, reordering lines, `\` command mode and its command list, toolbar (and its More overflow), output tabs, `side` slot |
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
- The underscore is part of the name. It is also how a name's subscripts and superscripts
  are written: `_part` is a subscript and `__part` a superscript, with several of either
  joined by commas. So `g_Kr__max` is shown as g with the subscript Kr and the
  superscript max (`nameScripts` in `editor/nameScripts.ts`).
  - The split is worked out on the name's atoms, so a Greek letter counts as one atom, and
    every atom (underscores included) is still tagged for the caret. The underscores are
    drawn as nothing, or as the comma before a second part.
  - A name the cursor or anchor is in, or at either end of, is drawn as typed: the same
    rule `settleNames` uses (`cursorInName`). The caret is therefore never inside a
    typeset name.
  - A name with three or more underscores in a row, or ending with one, is drawn as typed.
  - The `typesetNames` prop (default on) switches this off.
  - The name, and so the exported MathML and MathJSON, is the same either way. This is
    the convention cellml-text-editor.js is to follow too.
- **Decorations** are keyword parts of the name (`nameScripts`; the user guide has the
  examples). After the base, the leading single-`_` parts that are keywords in strictly
  increasing slot order make up the decoration zone: slot 0 an accent (`bar hat tilde
  check`), slot 1 a charge (`(2-9|[1-9][0-9]+)?(plus|minus)`), slot 2 `conc`
  (`keywordSlot`). The first part that isn't one, or is out of order, closes the zone, and
  it and every part after it are ordinary parts, so `g_Na_bar` keeps the subscript "Na,
  bar" and `Ca_conc_2plus` the subscript 2plus. Keywords are matched on a word's joined
  atom values, lowercase only (`kappa_hat` is κ, _, h, a, t); the base is never one, and a
  base that spells a function (`sin_bar`) has no zone. `NameScripts` then has optional
  `accent`, `charge` (`count`, `sign`) and `conc`, each with its separator and text
  ranges, and a name with only decorations has `parts: []`.
  - **Why one-to-one.** A decoration is only a drawing: the name is plain text to the
    identifier scan (a keyword is more letters of one run, `nameEnd`), so `parse.ts`, the
    Content MathML and MathJSON exports, the Content MathML import and the units panel are
    unchanged, and `<ci>q_bar_i__Glc</ci>` imports drawn decorated. But copying writes the
    drawing (q̄ᵢ^Glc, as LaTeX or Word's MathML), and pasting has to find the name again.
    That only works if every drawing has exactly one spelling: hence one fixed slot per
    keyword, one order, and keywords nowhere else, so that the zone, and with it the name,
    can be read back from the drawing.
  - `NAME_ACCENTS` is the one table every side uses: each accent's LaTeX over one letter
    (`bar`), drawn over a longer base (`overline`, `widehat`, `widetilde`, `widecheck`),
    copied over a longer base (`\check`, as `\widecheck` isn't core LaTeX), the spacing
    mark written in Word's MathML (¯ ^ ~ ˇ), and the marks read on paste (combining or
    spacing: U+0305, U+0304, ¯, ‾ for a bar; U+0302, ^, ˆ for a hat; …). `LATEX_ACCENTS`
    maps both LaTeX commands to the accent, and `accentForMark` a mark. `chargeWord(2,
    '+')` is `2plus`; `chargeFromText` reads a charge as written in a superscript (`2+`,
    `+`, `−`, `++`, `1+`), and rejects a sign first or a count of 0 (`+2`, `-1`, `0+`).
  - `withNameKeyword(atoms, keyword)` (`editor/names.ts`) puts `_keyword` in its slot of
    one name (`isOneName`, `editor/identifiers.ts`), keeping the name's atom ids: `q_i`
    with bar is `q_bar_i`. It returns null for a name drawn as typed, one that already has
    that slot or a later one (so decorations go on inside out), or where the keyword
    wouldn't be read as that decoration. Every paste path, and the `decorateName` command,
    builds decorated names through it.
  - `settleNames`, `cursorInName` and `greekWord` are unchanged: decorating is drawing
    only, and a name the caret is in or at either end of is drawn as typed, as with
    scripts.
  - Drawing (`typesetName` in `renderers/layoutLatex.ts`) tags every atom exactly once. A
    one-atom base carries its accent inside its own tag, `\htmlData{atom=q}{\bar{q}}`,
    which keeps KaTeX's skew for an italic letter; a longer base (and, with Greek names
    off, a Greek letter spelled out) gets the wide accent round its tags. The keyword's
    atoms are empty tags inside the base's braces, so the scripts attach to the decorated
    base and not to an empty box. A charge's digits are tagged as themselves, the first
    letter of plus or minus as the sign (braced, so it has no operator spacing), the rest
    empty; outside a concentration the charge comes first in the superscript, then a comma
    and any superscript parts. A concentration is `\left[…\right]` round the base and its
    charge, its brackets untagged, with the scripts outside.
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
- A decorated name's last atoms may paint nothing (the keyword of `x_tilde` or
  `Ca_2plus`), so a click right of it couldn't reach its end. Each typeset name is
  wrapped in `\htmlData{name=<first atom id>}`; `gapGeometry` skips a gap inside a name
  that only empty atoms follow, and measures the gap at the end of a name to the wrapper's
  right edge, which includes a concentration's brackets and the accent.

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
| Backspace | Deletes the symbol before the cursor. After a structure it steps into it (or deletes it if empty). In an empty denominator it removes the fraction and keeps the numerator, in brackets if it has an operator at its top level (undoing `/`). At the start of any other later row it moves to the previous row; at the start of the first row it removes the structure but keeps its content (a piecewise is stepped out of instead). In an empty piece or otherwise, removes it. |
| Delete | The mirror image of Backspace. |
| Tab / Shift+Tab | Next / previous empty slot, wrapping. |
| `\name` | Command mode (workbench): `frac sqrt root abs dd pow cases otherwise floor ceil bar hat tilde check conc`, the comparison and logic commands, the constants, function names (inserted with brackets), Greek letters; any other name is typed out as letters. |

`decorateName(keyword)` (`editor/commands.ts`) adds a decoration to the name the cursor
is in or at the end of, or to a selection that is exactly one name, through
`withNameKeyword`, as one undo step, with the cursor after the name; with no name there,
or one that can't take it, it does nothing. It backs `\bar \hat \tilde \check \conc`
(`STRUCTURE_COMMANDS`, so they are in the command list) and the toolbar's **Accents and
charges** group (`editor/toolbar.ts`, after Symbols: Accents, Concentration, and Charges,
x⁺ x²⁺ x³⁺ x⁻ x²⁻). Charges are buttons only, not commands.

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
- **Paste** reads the first format that applies (`editor/pasteFormats.ts`, pure, so it
  is unit-tested): the editor's own format, with fresh ids for the pasted atoms; Word's
  equations in `text/html`; Presentation MathML text; Content MathML text; Word's linear
  format, which can't be read (the notice says how to copy MathML from Word instead);
  otherwise `text/plain` with `latexToRow`, which takes LaTeX or plain typed maths:
  - LaTeX: `\frac`, `\dfrac`, `^{…}`, `\sqrt`, `\sqrt[n]`, `\left( … \right)`,
    `\left| … \right|`, floor and ceiling brackets, `\frac{\mathrm{d}…}{\mathrm{d}…}` (a
    derivative), `cases`, function commands and `\operatorname`, Greek letters,
    constants, comparison and logic commands, `\cdot`, `\times`, `\mathit{word}`,
    `\text{…}`. Spacing commands are ignored. `\square` is an empty slot.
  - Plain text: `a/b` makes a fraction of the operands either side (as typing `/` does),
    with brackets dropped from a bracketed operand. `^` takes a braced group, one
    character, or a whole run of digits (`x^10`). Letters follow the typing rules, `*`
    becomes `·`, and `<= >= != == &&` are the operators.
  - A subscript after a name is part of the name, with commas as underscores: `x_{12}`
    is `x_12`, and `C_{Ca,i}` is `C_Ca_i`.
  - A braced name with a superscript whose parts start with a letter is one name:
    `{g_{Kr}^{max}}` is `g_Kr__max`. This is how copying writes such a name. Any other
    `^` is a power, so `x_1^2` from elsewhere is still x_1 squared.
  - A superscript part of digits is copied upright, `{k^{\mathrm{1}}}`, and `\mathrm`
    digits are upright digit atoms that `bracedName` takes as a part, so it pastes back
    as `k__1`; `{x^{2}}` from elsewhere stays a power.
  - Decorated names are copied as drawn (`typesetNameLatex`):
    `{\bar{q}_{i}^{\mathit{Glc}}}`, `\overline{\mathit{Glc}}`, `[\mathit{Glc}]_{i}`,
    `{\mathit{Ca}^{2+}}`, `[\mathit{Ca}^{2+}]_{i}`, braced whenever there is a
    superscript. Reading applies the same decorations to LaTeX from elsewhere, through
    `withNameKeyword`, and leaves anything else as it always was, since a text paste has
    no review:
    - an accent command (`\bar \overline \hat \widehat \tilde \widetilde \check
      \widecheck`) over exactly one name is its accent; over anything else it is dropped.
      A combining accent straight after a name with no scripts yet (plain `q̄`; the
      tokenizer splits a precomposed `ā` into its letter and mark) is too, and any other
      combining mark is dropped rather than kept as an atom;
    - `[`, `\left[` or `\lbrack` round exactly one name is its concentration
      (`pushSquare`); any other square brackets are round;
    - after `^`, a braced script or a lone sign that `chargeFromText` accepts, on a name
      that isn't a function's, is its charge (`readCharge`), and so are unbraced digits
      then one sign followed by `] ) } _`, `\right` or the end (`Ca^2+`). `x^{-1}` stays
      a power. `bracedName` accepts a leading charge, `{\mathit{Ca}^{2+,\mathit{max}}}`;
    - a decorated (or braced) name is complete (`closedNames`, a WeakSet of last atoms):
      a letter or digit straight after it is another factor, `\bar{x}y` is `x_bar·y`,
      while `_` is still its subscript (`[Glc]_i`).
  - A `.` is decided by `periodRole` (for `readChar` and `atStop`); the tokenizer marks a
    token preceded by whitespace or a spacing command, and whitespace with a line break.
    It is a full stop, dropped, when nothing of the expression follows (the end, a closer,
    an operator character or command, `\right`, `\end`, `\\`, `&`, a line break); a
    decimal point after a whole number when an exponent (`1.e-3`, `\mathrm{e}`) or units
    (`5.{mV}`, `\,\mathrm{mV}`) follow; multiplication with space on either side
    (`3 . 2`); a decimal point before a digit at the start, after an operator or after a
    whole number (`.5`, `x+.5`, `1.5`); and otherwise multiplication (`x.y`, `x.5`, `2.x`,
    `1.2.3` as 1.2·3). `atStop` stops an operand at a multiplying `.` as at `*`, so
    `a/b.c` is (a/b)·c. A subscript's digits take no `.`, a superscript's one only
    straight before a digit (`x^2.5`). Typing is unchanged: `numbers.ts` still marks
    `1.2.3` malformed.
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

### Pasting from Word, and Presentation MathML

Word writes maths by how it looks, so what it means has to be worked out, and some of it
could mean two things. Three steps, each its own module:

1. **Reading** into a neutral tree (`editor/mathTree.ts`): runs of text (italic or
   upright, as written), fractions, scripts, radicals, fences, functions, tables,
   accents, and `unsupported` nodes that name what they are ("a sum") and how they were
   written.
   - An `accent` node is a mark over or under its base: `{base, mark, position: 'over' |
     'under', what}`, the mark as written (combining or spacing), `what` naming it for a
     message ("a dot accent").
   - A text node is `explicit` when the source wrote its style out (OMML's `m:sty` or
     `m:nor`, MathML's `mathvariant`) rather than leaving the format's default. That flag,
     not the style, says whether digits were meant to be upright: Word writes no style on
     what is typed into an equation, while the editor's own Word export marks a name's
     digit superscript.
   - `editor/ommlReader.ts` reads Word's clipboard HTML. Each equation is OMML inside a
     conditional comment (`<!--[if gte msEquation 12]>…<![endif]-->`), with a picture as
     a fallback for other apps. The OMML is taken from the raw text, since an HTML
     parser would lower-case its element names. It is tidied into XML (the tags that
     aren't OMML removed, keeping their text; attributes quoted; HTML entities decoded)
     and parsed, or parsed as HTML if it still isn't well-formed. Elements are matched
     on their lower-cased local names, so either parse reads the same. A run is upright
     with `m:sty` p or b, or `m:nor`, else italic. Each `m:oMath` is an equation, and so
     is each line of an `m:eqArr` that makes up a whole one. `m:acc` is an accent (U+0302,
     a hat, when it has no `m:chr`), and `m:bar` an over-bar with `pos` top, otherwise
     (Word's default) an under-bar.
   - `editor/presentationMathmlReader.ts` reads Presentation MathML. Word's
     (`<mml:math …>`) also matches `looksLikeContentMathML`, so it is checked first;
     before it was, pasting it replaced every line with empty ones. An `<mi>` is italic
     if it is one character, else upright, unless `mathvariant` says otherwise. A
     two-child `<mover>` or `<munder>` whose second child is one character is an accent;
     other under- and over-scripts (large operators, `lim`) are unsupported.
2. **Interpreting** (`editor/presentationImport.ts`, `readPresentation(paste,
   choices)`): the tree as layout rows, the ones the user would have typed. Text is
   split into characters and brackets written as characters are matched, so a name in
   two runs, or brackets in separate `<mo>`s, read as one; then letters run into names
   by the typing rules. The fixed rules are in the user guide (*Copy, paste and export*).
   - An **assumption** is a reading that could be otherwise: a fraction of italic d's
     (derivative or fraction), an italic e to a power (Euler's number or a variable), an
     italic word as a name's superscript (part of the name or a power), digits as a
     name's superscript (`digit-superscript`: a power or part of the name), and `1.5e−3`
     as a run (number or product). Each takes the likelier meaning, the default, and can
     be changed by reading again with `choices`, a map from an assumption's id to an
     option's. An id is the assumption's place in the tree (`line:path:kind`), so it is
     the same whatever is chosen. Each records the ids of the atoms it became, to mark
     them in the review's preview.
   - **Decorations.** In `scripts()` the base is read once, and if it is one name the
     scripts are its parts, so `sSub(acc(q), i)`, `sSub([Glc], i)` and scripts on scripts
     all read as names. An accent node over one name, with a bar, hat, tilde or check
     mark, goes through `withNameKeyword`; otherwise (another mark, an under-bar, a base
     that isn't one name) it is an omission and an empty slot, and the omissions,
     assumptions, notes and periods recorded while reading its base are rolled back.
     `[ ]` round one name, as characters (`bracket()`) or a fence (`fenced()`), is its
     concentration; both return `{atoms, scripted}`. A superscript (`superscriptPart`)
     is tried, in order, as a charge then parts (`Ca^{2+,max}`), an upright word (a
     part), a charge (the keyword; one `chargeFromText` rejects, `0+` or `+2`, is an
     omission), an italic word (`name-superscript`), digits, and otherwise a power. A
     subscript that is itself a keyword where a decoration goes (`x_{bar}`) gets a note.
   - **Digit superscripts.** Digits marked upright explicitly are a part, silently.
     Otherwise they are a `digit-superscript` assumption, id the scripts node's path
     (or, for Unicode superscript digits after a name, the first digit's). The default is
     a power, except a superscript 1, which is more often a label (κ_m¹). Whether to ask
     is decided from the tree (`canBeName`: text that is a name, an accent over one, a
     name in square brackets, or one with scripts), not from the atoms, so the questions don't
     change with other choices; where the base doesn't end up one name the answer is
     applied as a power.
   - **Higher-order derivatives.** Before a fraction's rows are read, `fraction()` checks
     it for an order-n derivative (`derivativeOrder`): a numerator starting with a
     differential (d, ⅆ or ∂) with superscript n, as a script or Unicode superscript
     digits, then an expression or nothing (the operator form, dⁿ/dtⁿ (…)); a denominator
     of a differential and one name with superscript n; n ≥ 2 and the two the same. Their
     superscripts' paths go into `orders`, so they are powers and never asked about, and
     the fraction is kept as it is, with an omission that names the order ("A
     second-order derivative (d²x/dt²) isn't supported: it was kept as a fraction", or
     "looks like" with italic d's). Mismatched orders (d²x/dt) are an ordinary fraction.
   - **Periods** in `char()` follow the LaTeX reading's rules: an `<mn>`'s `.` is a
     decimal point and an `<mo>`'s is `·` or a full stop; `nextFactor` counts only decimal
     points.
   - An **omission** is what the editor can't write: left out, as an empty bracket slot
     where it was (or kept in a form the editor can write: a higher-order derivative as a
     fraction; an unknown symbol as it is), with a message that becomes its line's
     problem.
   - **Notes** say how things were read without a choice: letters written together read
     as one name (the names, when two or more italic letters made one), accents,
     concentrations and charges read as parts of names (`q̄_i^(Glc) as q_bar_i__Glc`,
     collected from the final name runs holding atoms `withNameKeyword` made), a full
     stop read as multiplication (`x.5 as x·5`), a keyword subscript, ∂ read as d, ∞ in a
     subscript as inf, sin⁻¹ as arcsin, a units word after a number read as a variable,
     numbers without units, text left out. A note quotes up to 6 instances.
3. **Reviewing and inserting** (`EquationWorkbench`). MathField emits
   `paste-presentation`; if the reading has an assumption or an omission, the workbench
   opens `PasteReviewDialog` for the line (kept by id), else inserts it straight away.
   One equation goes in at the caret (`insertAtoms`, an ordinary paste); several go in
   as new lines after the active one, the first in it if it is empty
   (`insertLinesAfter`), as one undo step, each committed with reason `'paste'`.
   Omissions are kept as their lines' import problems until edited, and the notice
   gives the notes.
   - The dialog is a PrimeVue `Dialog`, teleported to the body, so the workbench's
     capture-phase keys never see its keys. It has `data-me-popover`, so focus moving to
     it doesn't commit the line as a blur. It handles Escape itself and stops it, as
     PrimeVue's own Escape listener is on the document and would close a dialog the
     workbench is in too. The insert waits for `after-hide`: PrimeVue gives focus back
     to the line as it closes, and inserting before that would leave the caret behind.
   - The preview draws each equation with `rowToLatex` and marks atoms by their
     `data-atom` ids: what was left out always, and the part an assumption or omission
     is about while it's pointed at or focused.
   - Assumptions are grouped by kind, each group starting with its "Read all N as" row.
     `digit-superscript` questions come last, with the labels Powers and Labels (parts of
     names), unlike `name-superscript`'s Parts of names and Powers.

The test fixtures (`tests/wordFixtures.ts`, `tests/resources/word/`) are modelled on what
Word for Windows puts on the clipboard. Real captures from Word (Windows and Mac, with
the MathML option on and off) should replace them as they are made.

## Exports

A "Copy as" menu in the workbench toolbar offers the four formats in `editor/exports.ts`.
It copies the selection if there is one, otherwise the whole active equation. A selection
is exported on its own: its atoms are parsed as a row of their own, so selecting `a+b` in
`y=a+b` gives `["Add","a","b"]`, and an incomplete selection (`+b`) gets placeholders. The
output panels show the same text for the whole active equation.

Lines selected by Shift/Ctrl/Cmd+clicking their numbers are copied together, by
`exportRows`, as one document: Content MathML, one `<math>` with each line's equation in
turn (as CellML has them, and as `importContentMathML` reads them back); MathJSON, an
array; LaTeX, an `aligned` block with `&` before each line's top-level `=` (at its start
if it has none). Empty lines are left out, and one line is exported as `exportRow` has it.

- **LaTeX** is `rowToLatexSource`, the same as Ctrl+C, which pastes back into the editor.
- **MathJSON** is the indented JSON of `astToMathJson`.
- **Content MathML** is a complete document: the renderer's output wrapped in
  `<math xmlns="http://www.w3.org/1998/Math/MathML">` and re-indented by `formatXml`, which
  keeps an element holding only text (and `<sep/>`) on one line, so no whitespace is added
  inside a `<cn>` or `<ci>`.
- **Word equation** is Presentation MathML (`renderers/presentationMathml.ts`), which Word
  turns into one of its equations when it is pasted as plain text (Word doesn't read
  Content MathML). It is written from the layout rows, so that it reads back with nothing
  to ask: names typeset with their parts (superscript parts upright, digits as
  `<mi mathvariant="normal">1</mi>`, which reads back as explicit), decorated names as
  drawn (an accent as `<mover accent="true">` with its spacing mark, a charge as
  `<mn>2</mn><mo>+</mo>` first in the superscript, before a comma and any parts, and a
  concentration as `[`…`]` fenced round the base and its charge, with the scripts
  outside), a multi-letter name italic as the editor draws it, ⅆ for a derivative's d, an
  upright e, `sin(x)^2` as sin²(x), scientific notation as `1.5×10^{−3}`, piecewise as `{`
  and a table. Units are left out. Several lines are one `<math>` with a one-column table. How brackets are
  written (`<mfenced>`, as Word's own MathML has them) and how several lines are, are
  constants at the top of the file, to change if Word turns out to prefer the other.
  Every typed equation (but its units) reads back with the same Content MathML
  (unit-tested).

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

- **Unit tests** (Vitest, `yarn test`): `tests/*.spec.ts`. Pure model code (cursor
  movement, parser, commands, clipboard, exports, LaTeX generation), including randomised
  property tests (KaTeX accepts any layout tree the renderer produces).
- **Browser tests** (Playwright, `yarn test:e2e`): `tests/e2e/`. These drive the
  workbench in Chromium, because caret placement and click hit-testing depend on real
  KaTeX layout, which jsdom doesn't do. `tests/e2e/samples.ts` defines each sample
  equation as the keys that type it plus the layout tree it must produce. Every test that
  uses a sample first checks the typed result matches that tree (same rows, same atom
  counts, same MathJSON), then computes the expected cursor positions from it. Assertions
  read the cursor and MathJSON the workbench prints, not pixels. The config starts the
  Vite dev server itself.
- **Screenshot tests** are opt-in (`yarn test:e2e:visual`, tagged `@visual`), because
  font rendering differs by OS. Baselines are per platform; create or refresh them with
  `yarn test:e2e:visual --update-snapshots`.
- **Timing tests** are opt-in too (`yarn test:e2e:perf`, tagged `@perf`), because they
  depend on the machine. They load SN_soma (`tests/resources/SN_soma.xml`, 126
  equations, with its 249 variables' units in `SN_soma_units.json`), the large component
  that made phlynx slow. They check that the units hints add little to the load time, and
  that a host passing new variable units, equal or changed, causes no long task.
  `tests/largeComponent.spec.ts` checks the same costs as ratios, in the ordinary unit
  tests.
- One-off setup after `yarn install`: `yarn playwright install chromium`.

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
  `nameOccurrenceMap` / `numberOccurrences` and makes `units` marks; the workbench adds
  them to the line's parse marks and lists the active line's issues under the equations.
- **Hints in.** The `variableUnits` prop (name → units) gives hover hints for variables,
  and with it numbers show their own units (or dimensionless) on hover.
- **Cost on large components.** A host may know the units of hundreds of variables, and
  pass a new, often equal, `variableUnits` after every commit.
  - `nameOccurrenceMap` walks a line once for all its names, and is cached by row.
    Hints look up each of the line's names in the map, so a large map costs no more
    than a small one.
  - The workbench holds `issues` and `variableUnits` content-stable
    (`components/contentStable.ts`), so an equal new object rebuilds nothing.
  - The lines are a `shallowRef`: each line's state is an immutable value, and deep
    reactivity would put every read of a line tree through a proxy.
  - On SN_soma (126 equations, 249 variables' units) this took the load from 2.5 s to
    0.3 s, the same as without units, and removed a 2.2 s long task after each host
    update.
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

## Future work: higher-order derivatives

CellML can encode them (`<diff>` with `<bvar><ci>t</ci><degree><cn>2</cn></degree></bvar>`),
but the editor writes only first-order ones. Supporting them would mean:

- an order on the derivative atom, or a degree row: `DerivativeAtom` in `editor/layout.ts`,
  with its drawing and caret navigation;
- `editor/parse.ts` and the `Derivative` AST node;
- the Content MathML export (`renderers/mathml.ts`), and the import:
  `derivative()` in `editor/mathmlImport.ts`, which rejects a degree other than 1;
- LaTeX and Word copy and paste;
- typing them with `\dd`.

The recognition already in `fraction()` (`derivativeOrder`, in `presentationImport.ts`)
would then make the derivative instead of an omission.

## Open questions

- **What real Word does with decorated names.** Still to check in Word itself: which
  accent characters it writes and accepts (spacing or combining); whether `\overbar` is
  `m:bar` with `pos` top; whether `m:sty` p survives on an upright digit, so that
  `kappa_m__1` round-trips through Word silently; and whether `<mfenced open="[">` inside
  `<msub>` comes back as `sSub` of a `d[…]`.

- **The otherwise default with an expression first.** A default 0.0 takes the units of a
  first piece that is a number with units, but not of one that is an expression, whose
  units only the checker knows. The checker could say which units it needs.
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
