# Writing equations

This guide explains how the equation editor turns what you type into mathematics, and
why it works the way it does. You type an equation much as you would write it by hand.
While you type, the editor works out its meaning: which parts are variables, functions,
numbers and operators, and how they group. The meaning is shown in the output panels as
MathJSON and Content MathML.

The editor never guesses silently. The rules below decide the meaning of everything you
type, and the same input always means the same thing. If you know the rules, you can
predict the output.

For how the editor works inside, see [Equation editor design](design.md).

## The short version

| You type | You get | Meaning |
|---|---|---|
| `Vm_init` | *Vm_init* | one variable called `Vm_init` |
| `ab` | *ab* | one variable called `ab`, **not** a × b |
| `a*b` | a · b | a times b |
| `2Vm` | 2 *Vm* | 2 times `Vm` |
| `sin(x)` | sin(x) | the sine of x |
| `cost` | *cost* | one variable called `cost` (not cos(t)) |
| `x^2` then Space | x² | x squared; Space leaves the exponent |
| `(x+1)/2` | a fraction, x+1 over 2 | the brackets are dropped from the numerator |
| `\|x\|` | \|x\| | the absolute value of x |
| `\sqrt` then Space | √☐ | a square root, ready to fill in |

## How the editor sees an equation

An equation is made of **characters** (digits, letters, operators) and **structures**
(fractions, exponents, roots, brackets, absolute values and derivatives). A structure
has one or more **slots** that hold more of the equation: a fraction has a numerator and
a denominator, and a root has a body and, for an nth root, an index.

- **The caret always sits between two things.** It can be placed before or after every
  character and every structure, and inside every slot. The arrow keys visit each of
  those positions in reading order, including the very end of the equation.
- **The slot the caret is in is tinted.** Inside a root, a numerator, an exponent or any
  other slot, that slot has a faint blue background. At the end of `√(x+1)` the caret
  looks almost the same inside the root and after it: with the tint it is still under
  the root, and without it, after. At the top level of the equation there is no tint.
- **The meaning is worked out from what's there.** Every time you change the equation,
  the editor re-reads it from scratch. Nothing about the meaning depends on the order in
  which you typed things, only on what is on the screen.
- **Empty slots show as ☐.** An equation with empty slots still has a meaning; the empty
  slots appear as `["Missing"]` in MathJSON and `<ci>_</ci>` in Content MathML.

## Numbers

A run of digits, with at most one decimal point, is one number: `12`, `3.5`, `.5`.
Something like `1.2.3` is reported as a malformed number under the equation. (Pasted, a
`.` that can't be a decimal point is read as multiplication instead: see *Copy, paste and
export*.)

### Units of a number

A number is dimensionless unless you give it units. Type the units name in braces straight
after the number: `0.25{mV}`, `1e-3{per_s}`. Typing `{` after a number opens an empty
units slot, a dashed light-blue box labelled "units" (unlike the grey box of an empty
fraction or exponent); the name you type is shown upright in light blue (0.25 mV); `}`
or Space leaves the units. The name is a units name, not a variable, and must be a valid
CellML name: letters, digits and underscores, not starting with a digit.

Once you leave them, **the units are hidden**: the equation shows 0.25 with a very small
light-blue triangle in the number's top corner to say it has units, and pointing at the
number shows them ("0.25: mV"). They stay with the number:

- The caret moves past them as if they weren't there. At the end of the number, digits
  (and a point, or an exponent) still extend it: `5{volt}` then `0` is 50 volt, while
  `+` goes after it.
- To change them, put the caret at the end of the number and type `{`: they open with the
  name selected, so typing replaces it. Empty them and leave to remove them.
- Backspace at the end of the number deletes its digits; deleting the last digit (or
  the whole number) deletes the units too, so a new number starts without any. Selecting
  the number selects its units too, so deleting or copying it takes them along.
- Units with an invalid name (not a CellML name) stay in view, underlined in red, until
  they're fixed. A units problem the checker finds (units it doesn't know, or that don't
  match) underlines the number only; its units stay hidden, and pointing at it says what
  they are.

The units go into Content MathML in CellML mode (`<cn cellml:units="mV">0.25</cn>`);
numbers without units are written `cellml:units="dimensionless"`. Copied as LaTeX they are
left out, as on screen (copy and paste within the editor keeps them). Pasted LaTeX such
as `0.25\,\mathrm{mV}`, or plain text such as `0.25{mV}` or CellML Text's
`0.25 {units: mV}`, is read as units.

Whether the units make sense in the equation is checked outside the editor, if the
application provides a units checker; problems it finds are underlined in amber. See
*Checking units* below.

### Scientific notation

Type scientific numbers as you would in code: the number, `e` (or `E`), an optional
`+` or `-`, then the exponent's digits. `1e-08`, `6.022E23` and `2.5e+3` are each one
number, and are shown as typed, with an upright e and no spacing around the sign:
1e−08.

The e only belongs to the number when digits follow it (with or without a sign), so
while you type `1e` it's still 1·e until the exponent's first digit arrives. Other
cases:

| You type | It means |
|---|---|
| `1e-08` | the number 0.00000001 |
| `2e` | 2 · e |
| `2e-x` | 2 · e − x |
| `2e5x` | 200000 · x |
| `x2e5` | the name `x2e5` (a name continues through letters and digits) |
| `1e-0.5` | a malformed number: the exponent must be a whole number |

In exports, MathJSON has the number itself (`1e-8`). Content MathML keeps the
notation as e-notation, `<cn type="e-notation">1<sep/>-8</cn>`, which CellML also
accepts. Copied LaTeX is `1\mathrm{e}{-08}`, which pastes back as typed.

## Names (variables)

**Rule:** a name starts with a letter and continues with letters, digits and
underscores. Characters typed one after another, with no operator between them, belong
to the same name.

| You type | Name(s) |
|---|---|
| `Vm` | `Vm` |
| `Vm_init` | `Vm_init` |
| `x2`, `V1_a` | `x2`, `V1_a` |
| `I_stim-I_ion` | `I_stim` minus `I_ion` |
| `2Vm` | the number 2 times `Vm` (a name can't start with a digit) |

**Why:** models in physiology, engineering and the sciences use descriptive,
multi-character names such as `Vm`, `Cm`, `I_stim` and `Vm_init`. Treating every letter as
its own variable, as school algebra does, would turn `Vm` into V × m and make such names
impossible to write. A single consistent rule for what counts as one name is easier to
learn than a set of special cases.

**What this means for multiplication:** if you want a product of variables, say so with
`*`, which is shown as a centred dot. This is the main habit to learn.

| Intended | Type | Not |
|---|---|---|
| a × x + b | `a*x+b` | `ax+b` (that's a variable `ax`, plus b) |
| m c² | `m*c^2` | `mc^2` (that's the variable `mc`, squared) |
| x y² | `x*y^2` | `xy^2` (that's `xy`, squared) |
| 2 x y | `2x*y` | `2xy` (that's 2 times `xy`) |

A number in front of a name, or anything in front of brackets, is still multiplied
without a `*`: `2x`, `3(x+1)` and `(a+b)(a-b)` are all products.

**Display:** a name of more than one character is shown in the italic TeX uses for words,
so `Vm` reads as one name, not as V m. A single-letter name uses the ordinary maths
italic.

**Underscores mark subscripts and superscripts.** One underscore starts a subscript and
two start a superscript. Several subscripts (or superscripts) are shown one after another,
separated by commas:

| You type | Shown as |
|---|---|
| `V_m` | V with the subscript m |
| `Vm_init` | Vm with the subscript init |
| `C_Ca_i` | C with the subscript "Ca, i" |
| `g_Kr__max` | g with the subscript Kr and the superscript max |
| `beta_n__inf` | β with the subscript n and the superscript inf |
| `k__max` | k with the superscript max |

A name is typeset only when the cursor isn't in it or at either end of it. While you are
typing or editing it, it is shown exactly as typed, underscores included, so you can see
where the caret is. A name with three or more underscores in a row, or one that ends with
an underscore, is always shown as typed.

A superscript of digits (`k__1`) is drawn like a power, k¹, but it is still part of the
name. Copied as LaTeX or as a Word equation, the editor marks its digits upright, so it
pastes back as the name `k__1`, not k to the power 1.

This only changes how a name looks. The name itself is exported exactly as typed:
`"g_Kr__max"` in MathJSON, `<ci>g_Kr__max</ci>` in Content MathML. That is a valid CellML
name, so it is stored in the model unchanged. A name can't start with an underscore; a
stray `_` is reported under the equation. The workbench's `typesetNames` option (see
[component-interface.md](component-interface.md)) turns typesetting off, so that every
name is shown as typed, decorations included.

### Decorations, charges and concentrations

A bar, hat, tilde or check over a symbol, a charge, and the square brackets of a
concentration are written as words in the name, since a CellML name can only hold
letters, digits and underscores (the same idea as `alpha` drawn as α). **Rule:** straight
after the name's first word, `_` and a keyword decorate it: first an accent (`bar`,
`hat`, `tilde`, `check`), then a charge (`plus` or `minus`, with a count of 2 or more
before it: `2plus`, `3minus`), then `conc`. Each comes at most once, in that order. The
first part that isn't one of them, or is out of order, ends the decorations: it and every
part after it are ordinary subscripts and superscripts, keyword or not.

| You type | Shown as |
|---|---|
| `x_bar`, `x_hat`, `x_tilde`, `x_check` | x̄, x̂, x̃, x̌ |
| `Glc_bar` | Glc with a wide bar over it |
| `q_bar_i__Glc` | q̄ with the subscript i and the superscript Glc |
| `kappa_hat_m__GLUT2` | κ̂ with the subscript m and the superscript GLUT2 |
| `Na_plus`, `Cl_minus`, `Ca_2plus` | Na⁺, Cl⁻, Ca²⁺ |
| `Glc_conc_i` | [Glc] with the subscript i |
| `Ca_2plus_conc_i` | [Ca²⁺] with the subscript i |
| `g_bar_Na` | ḡ with the subscript Na |
| `g_Na_bar` | g with the subscript "Na, bar" (`bar` isn't straight after g) |
| `Ca_conc_2plus` | [Ca] with the subscript 2plus (a charge goes before `conc`) |
| `x__bar` | x with the superscript bar (keywords take one underscore) |

Keywords are lowercase (`x_Bar` is x with the subscript Bar), `1plus` isn't a charge
(write `plus`), and a name that is a function's spelling isn't decorated (`sin_bar` is
sin with the subscript bar).

**Why so strict:** each drawing has exactly one spelling. A decorated name copied as LaTeX
or as a Word equation, and pasted back, is the same name; and a q̄ᵢ pasted from elsewhere
has only one name it can be, `q_bar_i`.

As with scripts, a decorated name is shown as typed while the caret is in it or at either
end, and decorated once the caret leaves. The name itself, and so the export, is exactly
what you typed: `<ci>Ca_2plus_conc_i</ci>`.

To add a decoration without typing the keyword, put the caret in or at the end of the name
(or select the name) and use a `\` command, `\bar`, `\hat`, `\tilde`, `\check` or `\conc`,
or a button in the toolbar's **Accents and charges** gallery (Accents, Concentration, and
Charges: x⁺, x²⁺, x³⁺, x⁻, x²⁻). Charges are toolbar buttons only, not commands. The
keyword goes in its place, so with the caret after `q_i`, `\bar` gives `q_bar_i`, and the
caret goes after the name. Nothing happens if there is no name there, or if it already has
that decoration or a later one: decorations go on in order, so add a charge before
`conc`.

Typing `[` does nothing: for [Glc], type `Glc_conc` or use the Concentration button.
Brackets that only group are round.

**Names from before:** a name that already used a keyword in this place is now drawn
decorated, though the name itself is unchanged: `k_plus` is k⁺, not k with the subscript
plus, and `Ca_conc` is [Ca]. To keep the word as a subscript, put it after another part
(`k_f_plus` is k with the subscript "f, plus"). A digit superscript such as `k__1` is
drawn as before, but copies as `{k^{\mathrm{1}}}` (it used to copy as `{k^{1}}`, which
pasted back as a power).

## Functions

**Rule:** a name that is *exactly* the name of a known function is that function, and is
shown upright. A longer name that merely contains a function's name is just a name.

The known functions are every function CellML 2.0 allows:

| Kind | Functions |
|---|---|
| Exponentials and logarithms | `exp`, `ln`, `log` |
| Rounding and comparison | `floor`, `ceiling` (or `ceil`), `min`, `max`, `rem` (remainder) |
| Trigonometric | `sin cos tan sec csc cot` |
| Inverse trigonometric | `arcsin arccos arctan arcsec arccsc arccot` (or `asin acos atan asec acsc acot`) |
| Hyperbolic | `sinh cosh tanh sech csch coth` |
| Inverse hyperbolic | `arcsinh arccosh arctanh arcsech arccsch arccoth` (or `asinh`, …) |

`min` and `max` take any number of arguments, `rem` takes two (`rem(n,2)`), and `log`
takes one or two. So `floor`, `min`, `max` and `rem` can't be used as variable names;
`Vmax` or `t_min` are fine.

**Floor and ceiling are drawn as brackets**, as in print, in the same way that ∧ and ¬
are drawn as symbols: ⌊x⌋ and ⌈x⌉. Typing `floor(` turns the name into ⌊ ⌋ with the
caret inside, and `ceil(` or `ceiling(` into ⌈ ⌉; `)` then leaves them, so typing
`floor(x/2)` gives ⌊x/2⌋. `\floor` and `\ceil` (and the toolbar buttons) insert them
directly, or put them round a selection. Only the whole name converts: `myfloor(x)` is
a variable times x. Pasted `floor(x)`, `\lfloor x \rfloor` and `\left\lceil x\right\rceil`
all come in as brackets too.

| You type | Meaning |
|---|---|
| `sin(x)` | sin of x |
| `2sin(x)` | 2 × sin(x) |
| `x*sin(t)` | x × sin(t) |
| `sin^2` Space `(x)` | (sin x)², written sin²(x) |
| `log(x,2)` | the logarithm of x to base 2 |
| `cost`, `tangent`, `Vmsin` | variables, not functions |
| `xsin(t)` | the variable `xsin` times t |

**Use brackets for the argument.** `sin(x)` is the sine of x. Because letters typed
together form one name, `sinx` is a variable called `sinx`; a space doesn't separate
them. Arguments are separated by commas, as in `log(x,2)`.

**Why only exact matches:** earlier versions converted letters into a function as soon as
they spelled one, so typing `cost` produced cos(t) and `tangent` produced tan(gent).
Looking at the whole name instead means your variable names are never broken up.

**Your own functions:** a name followed by brackets that isn't a known function, such as
`f(x)` or `Vm(t)`, is read as a product, f × x. Only the built-in functions above can be
recognised, because nothing tells the editor that `f` is a function. Support for
declaring your own functions may come later.

## Greek letters

A variable whose name is a Greek letter's name is drawn as that letter, however you type
it: `\alpha` (backslash, the name, then Space or Enter) or the letters `alpha`. While you
are typing a name it stays spelled out, so you can finish or change it; once the caret
leaves it, it becomes the letter. The name is the same either way: both are the variable
`alpha`, and export as `<ci>alpha</ci>`.

- Each part of a name between underscores that is a Greek letter's name is drawn as the
  letter, with any digits after it: `alpha_m` is α_m, `tau2` is τ2, `V_beta` is V_β. A name
  that only contains one (`alphabet`) stays as it is.
- The letter is one character: the caret steps over it in one go, and Backspace after it
  deletes it. Retype the name to change it.
- A Greek letter right next to a letter, with no underscore, is a separate name: `\alpha`
  then `x` is α·x.
- π is always the constant, never a variable (below).
- The application can turn this off (in the demo, the *Draw Greek names* checkbox). Then
  every Greek letter is spelled out in italics, `\alpha` included, so again both ways of
  typing it look the same.

## Constants

| Type | Shown as | Meaning |
|---|---|---|
| `\pi` | π | π |
| `\e` (or `\exponentiale`) | e (upright) | Euler's number |
| `\inf` (or `\infty`, `\infinity`) | ∞ | infinity |
| `\nan` (or `\notanumber`) | NaN | not a number |
| `\true`, `\false` | true, false | the logical constants |

The toolbar's Symbols gallery has buttons for π, e and ∞. The constants' MathML names are **reserved**:
typing `pi`, `exponentiale`, `infinity`, `notanumber`, `true` or `false` as a whole name
gives the constant, not a variable (names containing them, such as `pi_m`, are ordinary
names). A typed letter `e` is still a variable called e, shown in italics; only `\e` (or
`exponentiale`) gives Euler's number, shown upright as in print. Constants export as
MathML's own elements (`<pi/>`, `<exponentiale/>`, `<infinity/>`, …), so in CellML they
need no units. Imported Content MathML with a variable of a reserved name gets a warning,
since it reads as the constant.

## Operators and how things group

| Key | Operator |
|---|---|
| `+` `-` | add, subtract (or negate, at the start) |
| `*` | multiply, shown as · |
| `=` | equals |
| `,` | separates a function's arguments |

From loosest to tightest:

1. the logical operators ∨, ⊻, ∧, then ¬ (see *Conditions* below)
2. `=` and the other comparisons
3. `+` and `-`
4. multiplication, whether written with `*` or implied (`2x`, `3(x+1)`)
5. a leading minus, which negates the whole term after it: `-2x` is −(2x)
6. exponents

So `4t-3` is (4t) − 3, `2+3*4` is 2 + (3 × 4), and `-x^2` is −(x²). Subtraction groups from
the left: `a-b-c` is (a − b) − c. Brackets group anything explicitly.

Comparisons, `=` included, don't chain: in `a=b=c` or `0<x<1` the second one is marked as
a problem. Write each equation on its own line, and join comparisons with ∧
(`0<x & x<1`).

## Conditions

Conditions, such as the cases of a piecewise definition, use comparisons and logic.
They are shown as mathematical symbols, not words, so they read as maths rather than
code.

| Type | Or | Shown as | Meaning |
|---|---|---|---|
| `<` `>` | `\lt` `\gt` | < > | less than, greater than |
| `<=` `>=` | `\le` `\ge` | ≤ ≥ | less or equal, greater or equal |
| `!=` | `\ne` | ≠ | not equal |
| `=` | | = | equal |
| `&` | `\and` | ∧ | and |
| | `\or` | ∨ | or |
| | `\xor` | ⊻ | exclusive or |
| `!` | `\not` | ¬ | not |

`<=`, `>=` and `!=` combine into one symbol as you type the `=`. The toolbar's Symbols
gallery has a button for each.

The logical operators bind more loosely than comparisons, and ∧ more tightly than ∨: so
`t>=0 & t<1` is (t ≥ 0) ∧ (t < 1), and `a \or b & c` is a ∨ (b ∧ c). ¬ applies to the whole
comparison after it: `!x>0` is ¬(x > 0).

When pasting, LaTeX commands (`\leq`, `\land`, `\neg`, `\not=`, …) and plain-text `<=`,
`>=`, `!=`, `==` and `&&` are all understood. The words `and`, `or` and `not` are not:
they paste as names.

## Piecewise definitions

A piecewise definition gives a value for each case, with an optional value for when no
case applies:

```
          ⎧ 0.25 / T_vc    chi_vfloor > eps_2 ∧ chi_vfloor ≤ 0.25
dchi_v/dt ⎨ 0.5 / …        chi_vfloor > 0.5
          ⎩ 0.0            otherwise
```

- **Insert one** with `\cases` (or `\piecewise`) or the toolbar button. It starts with
  one empty case and an otherwise of `0.0`, a placeholder for you to replace, with the
  caret in the first value. With something selected, the selection becomes the first
  value.
- **Move around** as anywhere else: → goes from a value to its condition, then on to the
  next case; ↑ and ↓ move between cases in the same column; Tab jumps to the next empty
  slot.
- **Enter** adds a new case below the one you're in. (Outside a piecewise, Enter still
  starts a new equation line.)
- **Backspace** in an empty case removes it; so does Delete. The last remaining case
  isn't removed this way.
- **Otherwise is optional:** delete its contents, then Backspace once more to remove
  it. `\otherwise` puts it back, with `0.0` selected so you can type over it.
- A piecewise is an expression, so it can go anywhere: `y = 2{…} + 1` is fine.
- **Units of the otherwise 0.0:** while the otherwise is still `0.0`, it has the units of
  the first case's value when that is a number with units: in `{5{mV} if t < 1{ms};
  0.0 otherwise}` the 0.0 is in mV (hover over it to see). Give it units of its own, or
  change it, and it no longer follows the first case. Otherwise a number without units
  is dimensionless, as everywhere.

Conditions use the comparison and logical operators described under *Conditions*.

In exports it becomes `<piecewise>` with `<piece>` and `<otherwise>` in Content MathML,
`Which` in MathJSON, and a `cases` environment in LaTeX. Pasting a LaTeX `cases` (or
`dcases`) environment gives a piecewise, understanding `\text{if}` and
`\text{otherwise}`.

## Structures

Structures are created by keys, by `\` commands, or by the toolbar. The caret goes into
the structure's first empty slot. What you type goes into the slot the caret is in, so
**leave a structure before continuing outside it**: press → at the end of a slot, or
Space to step straight out.

### Fractions: `/`

`/` makes a fraction from the operand just before the caret, which is everything back to
the previous `+`, `-`, `*`, `=` or `,`. The caret goes to the denominator.

- `2x/3` is 2x over 3. `y=x+1/2` is y = x + ½, because the numerator stops at `+`, and
  `a*b/c` is a × (b/c).
- `(x+1)/2`: a bracketed numerator loses its brackets, since the fraction bar already
  groups it.
- `/` with nothing before it gives an empty fraction, with the caret in the numerator.
- Typing another `/` while in a denominator starts a fraction *inside* the
  denominator: `a/b/c` is a over (b/c). Press → after `b` first if you mean (a/b)/c.
- `\frac` gives an empty fraction.

### Exponents: `^`

`^` puts an exponent on whatever is just before it: `x^2`, `(x+1)^2`, `Vm^2`. The exponent
applies to the whole name before it, so `xy^2` is (xy)².

Typing continues inside the exponent until you leave it. `x^2y` puts `2y` in the
exponent; type `x^2`, Space, then `y`. Likewise `2^3^4` is 2 to the power 3⁴.

### Brackets `( )` and absolute values `| |`

`(` opens a pair of brackets with the caret inside, and `)` steps out of them. If you
type `)` in the middle of a bracketed expression, whatever follows the caret moves out
of the brackets: with the caret at `(x‸+1`, typing `)` gives `(x)+1`. `|` works the same
way for absolute values: the first `|` opens and the next closes.

### Roots and derivatives

- `\sqrt`: a square root.
- `\root`: an nth root, with the caret in the index (the small n).
- `\dd`: a derivative, d(☐)/d(☐). Fill in the expression, then press Tab to reach the
  variable.

## Empty slots, incomplete input and warnings

You can leave slots empty and fill them later; **Tab** jumps to the next empty slot and
**Shift+Tab** to the previous one. Something missing (an operator with nothing after it,
`x+`, or an empty slot) is marked once you leave the equation, as "Missing operand after
+" or "Empty denominator"; while you're typing it isn't a problem yet.

Anything the editor can't place, such as a stray `_`, a comma outside a function's
brackets or a malformed number like `1.2.3`, gets a red wavy underline; point at it to
see what's wrong. An equation with problems is outlined, and the status bar under the
equations names the first (click it to go there; point at it to see them all). The
marked part is otherwise ignored, and the rest of the equation is still understood.
(An application can choose to show problems only once you've finished with an
equation: pressed Enter, or moved to another.)

## Checking units

Where the application checks units (the demo does, with libCellML), a Units panel beside
the equations lists every variable your equations use, with a box for its units:

- **Units files.** Built-in units such as `second`, `metre`, `volt` and `dimensionless`
  are always there. For others, load CellML files with **Load units files**: only their
  units are used, so any CellML model will do, CellML 1.0 and 1.1 included. Each file is
  listed with the units it gave, and anything wrong with it (a name defined differently
  in two files, units made from units that aren't defined).
- **New units.** **Define units** makes units of your own: a name, and what they are made
  of, each part a units name with an optional prefix (milli, micro, …), exponent and
  multiplier: `mV_per_ms` is milli volt with milli second to the power −1. They can be
  used straight away, in equations and for variables, and changed or removed later. They
  are kept apart from the files you loaded, which are never changed, and are saved as a
  CellML file of their own (in the demo, **Download** gives `new-units.cellml`), which you
  can load again later as a units file.
- **Variables.** Type or pick each variable's units; press Enter or move on to use them.
  A variable without units, or with a units name that isn't defined, is marked.
  Variables you no longer use are kept, greyed, until you remove them.
- **Problems** are underlined in amber and shown in the status bar under the equations, as
  soon as an equation is complete: units that don't match (`x + t` with x in metres and
  t in seconds, or mV added to volts: units that differ only in scale don't match
  either), or a function argument that has to be dimensionless (`exp(t)`). Point at an
  underline to read the problem.
- A number is dimensionless unless it has units (`2{second}`); the otherwise 0.0 of a
  piecewise takes the first case's units, if that is a number with units.
- The constants π, e, ∞, NaN, true and false are always dimensionless: CellML gives
  units only to numbers and variables. For a constant with units, such as Faraday's
  constant, write it as a number with units (`96485{C_per_mol}`), or as a variable
  (`F`), which then gets its units in the panel like any other.

Checking starts once a units file is loaded or a variable has units. In the demo,
**Example** loads some electrophysiology units (ms, mV, µA/cm², …) and units for
`dV/dt = -(I_ion - I_stim)/C_m` to try.

## Moving and editing

| Key | Action |
|---|---|
| ← → | Move one position. Structures are entered and left in reading order. |
| ↑ ↓ | Move between numerator and denominator (or root index and body); otherwise to the previous or next line |
| Home / End | Start / end of the equation |
| Click | Put the caret at the nearest position. A click on a fraction bar goes before or after the whole fraction. |
| Space | Step out of the fraction, exponent or bracket the caret is in |
| Tab / Shift+Tab | Next / previous empty slot |
| Backspace | Delete the thing before the caret. Next to a fraction or other structure, the first press steps inside it rather than deleting everything; an empty structure goes in one press. At the start of a structure's first slot, it removes the structure but keeps its contents. In an empty denominator, it removes the fraction and leaves the numerator, so `x/` then Backspace gives back `x` (a numerator such as `x+1` gets its brackets back). In any other later slot, it moves back to the end of the previous one. |
| Delete | The same, forwards |
| Enter | Start a new equation line |
| Alt+↑ / Alt+↓ (Option on a Mac) | Move the equation line up / down. You can also drag a line by its number. |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (or Ctrl/Cmd+Y) | Undo, redo |

Names are edited one character at a time: you can click or arrow into the middle of
`Vm_init` and type, and the name changes accordingly.

Undo works in steps, like a text editor. Characters typed one after another are one
step, and each operator you type starts a new one, so undoing `x+1=2` gives `x+1`,
then `x`. A run of Backspaces is one step. Moving the caret, or pausing for more than
a second, also starts a new step. Fractions, exponents, brackets, pastes and toolbar
buttons are each a step of their own.

## Selecting and wrapping

Select with **Shift+←/→** (a whole fraction or root at a time), **Shift+Home/End**,
**Ctrl/Cmd+A**, or by dragging. A selection always covers whole items within one level
of the equation, so dragging from inside a fraction to outside it selects the whole
fraction.

With a selection:

- **Typing** replaces it. **Backspace/Delete** removes it.
- **`/`** makes it the numerator of a fraction.
- **`(` or `|`** puts brackets or an absolute value around it.
- **`^`** gives it an exponent, adding brackets first if it's more than one item.
- **`\sqrt`, `\root`, `\sin` (or any function), `\dd`** and the toolbar buttons wrap it:
  √(selection), sin(selection), and so on.
- **Esc** clears the selection; ← or → collapses it to its start or end.

## Copy, paste and export

- **Ctrl/Cmd+C / X / V** copy, cut and paste. Within the editor, pasting reproduces
  exactly what was copied.
- Copying also puts **LaTeX** on the clipboard for other applications. A name is written
  the way it is shown: `\mathit{Vm}_{\mathit{init}}`, with a multi-character part in
  `\mathit` so LaTeX treats it as one word. A name with a superscript is put in braces,
  `{g_{\mathit{Kr}}^{\mathit{max}}}`, so that pasting it back gives the name rather than a
  power; digits in a name's superscript are upright for the same reason,
  `{k^{\mathrm{1}}}`. A decorated name is written as it is drawn:
  `{\bar{q}_{i}^{\mathit{Glc}}}`, `\overline{\mathit{Glc}}`, `{\mathit{Ca}^{2+}}`,
  `[\mathit{Glc}]_{i}`, and pastes back as the same name.
- Pasting text from elsewhere accepts **LaTeX** (`\frac{1}{2}`, `\sqrt{x}`,
  `\left|x\right|`, …) or **plain maths as you would type it** (`y = (x+1)/2 + sin(x)^2`),
  read with the same rules as typing. In pasted text, `a/b` always makes a fraction,
  and a LaTeX subscript becomes part of the name: `x_{12}` becomes the name `x_12`, and
  `C_{Ca,i}` becomes `C_Ca_i`. A LaTeX superscript is a power, unless the name and its
  superscript are in braces with the superscript starting with a letter (or upright
  digits, `{k^{\mathrm{1}}}`): `{g_{Kr}^{max}}` becomes the name `g_Kr__max`, while
  `x_1^2` stays x_1 squared.
- Pasted text is also read for **decorations**, by the rules of *Decorations, charges and
  concentrations* above. There is no review for pasted text, so these are applied without
  a note, and anything that doesn't fit is read as it always was:
  - An accent command over one name is its accent: `\bar{q}_i` is `q_bar_i`, and
    `\overline{Glc}`, `\hat{\kappa}_m`, `\tilde`, `\widetilde`, `\check` and
    `\widecheck` work the same way. Over anything else (`\bar{x+y}`) the accent is
    dropped.
  - So is a plain Unicode accent on a letter, as text has it: `q̄` (q and a combining
    macron) is `q_bar`, and so is a letter with its accent as one character (`ā` is
    `a_bar`). A macron or overline is a bar, a circumflex a hat, and a caron a check. Any
    other combining mark, such as a dot, is dropped.
  - Square brackets round one name are its concentration: `[Glc]_i`, `\left[Glc\right]_i`
    and `\lbrack Glc\rbrack_i` are `Glc_conc_i`. Other square brackets (`[x+y]`) are
    round ones.
  - A charge as a name's superscript is its charge: `Ca^{2+}`, `Ca^2+` and `Cl^-` are
    `Ca_2plus` and `Cl_minus`, and `[Ca^{2+}]_i` is `Ca_2plus_conc_i`. A sign before a
    number (`x^{-1}`) is still a power.
  - A letter straight after a decorated name is another factor: `\bar{x}y` is
    `x_bar·y`, and `[Glc]_i x` is `Glc_conc_i·x`.
- A pasted `.` is a **decimal point** only within a number; between two factors it is
  **multiplication**, and with nothing after it a full stop, left out. (Typing a `.` is
  unchanged.)

  | Pasted | Read as |
  |---|---|
  | `1.5`, `.5`, `x+.5` | numbers, as typed |
  | `x.y`, `[Glc]_i.[Glc]_o` | x·y, `Glc_conc_i`·`Glc_conc_o` |
  | `x.5`, `2.x` | x·5, 2·x |
  | `3 . 2`, `1. 5` | 3·2, 1·5 (a space either side makes it multiplication) |
  | `1.2.3` | 1.2·3 |
  | `x^2.5`, `x^2.y` | x to the power 2.5, x²·y |
  | `a/b.c` | (a/b)·c, as `a/b*c` |
  | `y=x.`, `x./y` | y=x, x/y (a full stop) |
  | `1.e-3`, `5.{mV}` | the number 1.e-3; 5. with the units mV |
- Pasting **Content MathML** (from a CellML model, say: a `<math>` element, or a bare
  `<apply>`) imports it. One equation or expression goes in at the caret like any paste;
  several (a `<math>` holding several `<apply><eq/>…`) **replace every line**, one
  equation per line; Ctrl/Cmd+Z undoes either in one step. The maths is written as you
  would have typed it, with brackets only where they're needed. A number's `cellml:units`
  become its (hidden) units, from CellML 2.0 or 1.x; `dimensionless` is left off, as
  it's the default. Variables' units aren't in the maths, so give them again in the
  Units panel. Anything the editor can't write (an element outside CellML's MathML, a
  second derivative) is left out, leaving an empty slot or a missing operand, and the
  equation's problem says what was left out until you change it.
- Pasting **equations from Word** (copied from Word's equation editor, in Word's
  desktop app) reads them as you would have typed them. Word writes maths by how it
  looks, so most of what it means follows from fixed rules:
  - Letters written together are **one name**, as when typing: Word's `Cm` is the
    variable `Cm`, not C × m. A note lists the names this made; put `*` between letters
    you meant as a product.
  - A name's subscripts, and upright superscripts, are parts of it: `I_ion`,
    `C_{Ca,i}` is `C_Ca_i`, and `n_∞` is `n_inf`.
  - A bar, hat, tilde or check over a name, square brackets round one, and a charge as
    its superscript are its decorations (see *Decorations, charges and concentrations*):
    q̄ᵢ^Glc is `q_bar_i__Glc`, κ̂ₘ^GLUT2 is `kappa_hat_m__GLUT2`, [Glc]ᵢ is `Glc_conc_i`,
    and [Ca²⁺]ᵢ is `Ca_2plus_conc_i`. A note lists each name read this way. A subscript
    that is itself a keyword, `x_{bar}`, becomes `x_bar`, which is drawn x̄; a note says
    so.
  - A full stop between two factors is multiplication, by the rules for pasted text
    above (`[Glc]_i.[Glc]_o`); a note lists them.
  - Word's differential d (`\dd`, ⅆ), or an upright d, makes `dV/dt` a derivative, and
    `d/dt (x+y)` the derivative of `x+y`. A partial derivative ∂ is read as an ordinary
    one, as CellML has no others.
  - `1.5×10^{−3}` is the number `1.5e-3`; Greek letters, π, ∞, an upright e, and
    functions (`sin x`, `sin²x`, `log_b x`, `sin⁻¹x` as arcsin) are the editor's.
  - Brackets, absolute values, roots, fractions and a brace round lines of cases
    (a piecewise definition) are what they look like.
- When something from Word could mean two things, a **paste review** asks first, and
  shows the equations as they'll be pasted. It asks about:
  - a fraction with italic d's, `dV/dt`: a derivative, or the fraction of `dV` and `dt`?
  - an italic e raised to a power: Euler's number, or a variable called e?
  - an italic word as a name's superscript, `g^{max}`: part of the name, or a power?
  - `1.5e−3` written as text: the number, or 1.5 × e − 3?
  - digits as a name's superscript, `n^4` or `κ_m^1`: a power, or part of the name (a
    label, `kappa_m__1`)? A power is the default, except for a superscript 1, which is
    more often a label. Word writes every digit you type the same way, so this is asked
    of each one, even of `x^2` copied from the editor as a Word equation and pasted back.
    Digits the editor wrote as part of a name (marked upright) aren't asked about, nor
    are the superscripts of a higher-order derivative (below).

  Choose for each one (or for all of a kind at once); the preview follows. **Paste**
  (Enter) pastes them; **Cancel** or Esc pastes nothing.
- What the editor can't write is **always listed**: sums, integrals, accents other than a
  bar, hat, tilde or check over a name (V̇, an under-bar, a bar over `x+y`), limits,
  matrices, prime notation (V′), a charge that can't be a name's (`Ca^{0+}`, `Ca^{+2}`),
  a subscript that can't be part of a name (`x_{i+1}`), a higher-order derivative, and
  functions of your own. Each is left out, with an empty slot where it was, and the review
  opens to say so even when there's nothing to choose. A higher-order derivative,
  `d²x/dt²` or `ⅆ³V/ⅆt³`, is kept as the fraction it looks like, its superscripts
  powers; with italic d's the review says it only looks like one. After pasting, the line
  shows the problem until you change it.
- One equation from Word goes in at the caret; **several go in as new lines** after the
  one you're on (an empty line takes the first), keeping the lines you have. Ctrl/Cmd+Z
  undoes the paste in one step. Text around the equations is left out.
- Pasted numbers come **without units**: add each number's units afterwards, by typing `{`
  after it.
- If what arrives is only Word's text form of an equation (its "linear format"), the
  editor says so. In Word, open **Equation Options** and turn on **Copy MathML to the
  clipboard as plain text**, then copy the equation again.
- Pasting **Presentation MathML**, as other apps write maths (and as Word does with that
  option on), is read the same way.
- **Copy as** in the toolbar copies the selection, or the whole equation, as **LaTeX**,
  **MathJSON**, **Content MathML** or a **Word equation**. A selection is exported on its
  own, so selecting `a+b` in `y=a+b` gives just `a+b`.
- **Copy as → Word equation** copies MathML that Word turns into one of its equations
  when you paste it into a document; several lines become one equation with a line each.
  A derivative uses Word's differential d, so it pastes back into the editor as a
  derivative. A decorated name is written as it is drawn (q̄ᵢ^Glc, [Glc]ᵢ, Ca²⁺), and a
  digit in a name's superscript is marked upright, so names paste back as the same names
  with nothing to ask. Units are left out, as on screen.
- To copy several lines, select them by their numbers: **Shift+click** a line's number
  selects the lines from the one you're on to it, and **Ctrl/Cmd+click** adds or removes
  one. Copy as then gives one document: Content MathML is one `<math>` with an equation
  each (as in a CellML model, and pasting it back gives the same lines), MathJSON is an
  array, and LaTeX is an `aligned` block, lined up at each equals sign. Esc, typing or a
  click into a line clears the selection.
- In **CellML mode** (set by the application using the editor), Content MathML is
  ready for a CellML 2.0 model: it declares the CellML namespace, and every number gets
  `cellml:units`: the units you gave it (`0.25{mV}`), or `dimensionless`.

## `\` commands

Type `\` and a list of commands opens at the caret. It shows what you might be typing,
narrowing as you type (`\s` lists `\sqrt`, `\sin`, `\sec`, …, and a command you've typed
in full comes first). ↑ and ↓ choose from the list, and Tab or Enter inserts the one
chosen (with nothing typed yet, nothing is chosen until you press ↓). Space or `(`
takes exactly what you typed, and Esc cancels. You can also click a command in the list.

| Command | Inserts |
|---|---|
| `\frac` | a fraction (with a selection: the selection over ☐) |
| `\sqrt` | a square root |
| `\root` | an nth root |
| `\abs` | an absolute value |
| `\dd` (or `\diff`, `\derivative`) | a derivative d☐/d☐ |
| `\pow` | an exponent, like `^` |
| `\sin`, `\log`, … | the function with empty brackets: sin(☐) |
| `\alpha`, `\pi`, … | the Greek letter |
| `\le`, `\and`, `\not`, … | a comparison or logical operator (see *Conditions*) |
| `\pi`, `\e`, `\inf`, `\nan`, `\true`, `\false` | a constant (see *Constants*) |
| `\cases` (or `\piecewise`), `\otherwise` | a piecewise definition, or its otherwise |
| `\floor`, `\ceil` | ⌊☐⌋, ⌈☐⌉ |
| `\bar`, `\hat`, `\tilde`, `\check`, `\conc` | the decoration on the name before the caret (see *Decorations, charges and concentrations*) |
| anything else | the name typed out as letters (`\speed` gives `speed`) |

## Not supported yet

- **Declaring your own functions**, so that `f(x)` is a function call rather than f × x.
- **Chained comparisons** such as `a < b < c`: join them with ∧ instead.
- **Integrals, sums, products, limits and matrices.**
- **Higher-order derivatives** such as d²x/dt². CellML can hold them, but the editor
  writes only first-order derivatives, and a Content MathML one is left out. Pasted from
  Word, one is recognised, kept as the fraction it looks like, and listed in the review.
- **Typing a Greek letter's name without a backslash** to get the letter.
- **Pasting several lines of text as several equations.** Pasted text (LaTeX or typed
  maths) all goes into one equation; equations from Word, and several in Content MathML,
  do become lines.
