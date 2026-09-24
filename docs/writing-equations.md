# Writing equations

This guide explains how the equation editor turns what you type into mathematics, and
why it works the way it does. You type an equation much as you would write it by hand.
While you type, the editor works out its meaning: which parts are variables, functions,
numbers and operators, and how they group. The meaning is shown in the output panels as
MathJSON and Content MathML.

The editor never guesses silently. The rules below decide the meaning of everything you
type, and the same input always means the same thing. If you know the rules, you can
predict the output.

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
- **The meaning is worked out from what's there.** Every time you change the equation,
  the editor re-reads it from scratch. Nothing about the meaning depends on the order in
  which you typed things, only on what is on the screen.
- **Empty slots show as ☐.** An equation with empty slots still has a meaning; the empty
  slots appear as `["Missing"]` in MathJSON and `<ci>_</ci>` in Content MathML.

## Numbers

A run of digits, with at most one decimal point, is one number: `12`, `3.5`, `.5`.
Something like `1.2.3` is reported as a malformed number under the equation.

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

**The underscore is shown as it is.** `Vm_init` is displayed with its underscore, not as V
with a subscript. How underscores in variable names should be formatted (a subscript? a
double underscore for a superscript?) is an open question, so the editor deliberately
doesn't interpret it yet. The name is exported exactly as typed: `"Vm_init"` in MathJSON,
`<ci>Vm_init</ci>` in Content MathML. A name can't start with an underscore; a stray `_`
is reported under the equation.

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

Type a backslash and the letter's name, then press Space or Enter: `\alpha`, `\beta`,
`\Omega`. Typing the letters `alpha` without the backslash gives a variable called
`alpha`, shown in italics, not α. A Greek letter is always its own name, so `\alpha`
followed by `x` is α × x. The one exception is π, which is always the constant (below).

## Constants

| Type | Shown as | Meaning |
|---|---|---|
| `\pi` | π | π |
| `\e` (or `\exponentiale`) | e (upright) | Euler's number |
| `\inf` (or `\infty`, `\infinity`) | ∞ | infinity |
| `\nan` (or `\notanumber`) | NaN | not a number |
| `\true`, `\false` | true, false | the logical constants |

The toolbar has buttons for π, e and ∞. A typed letter `e` is a variable called e, shown
in italics; only `\e` gives Euler's number, shown upright as in print. Likewise the typed
letters `pi` are a variable called pi. Constants export as MathML's own elements (`<pi/>`,
`<exponentiale/>`, `<infinity/>`, …), so in CellML they need no units.

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

`<=`, `>=` and `!=` combine into one symbol as you type the `=`. The toolbar has a
button for each (except ⊻).

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
**Shift+Tab** to the previous one. An operator with nothing after it (`x+`) gets an empty
slot in the output rather than an error.

Anything the editor can't place, such as a stray `_`, a comma outside a function's
brackets or a malformed number like `1.2.3`, gets a red wavy underline; point at it to
see what's wrong. The problems in the equation you're editing are also listed in a
warning box under it. The marked part is otherwise ignored, and the rest of the
equation is still understood.

## Moving and editing

| Key | Action |
|---|---|
| ← → | Move one position. Structures are entered and left in reading order. |
| ↑ ↓ | Move between numerator and denominator (or root index and body); otherwise to the previous or next line |
| Home / End | Start / end of the equation |
| Click | Put the caret at the nearest position. A click on a fraction bar goes before or after the whole fraction. |
| Space | Step out of the fraction, exponent or bracket the caret is in |
| Tab / Shift+Tab | Next / previous empty slot |
| Backspace | Delete the thing before the caret. Next to a fraction or other structure, the first press steps inside it rather than deleting everything; an empty structure goes in one press. At the start of a structure's first slot, it removes the structure but keeps its contents; in a later slot, it moves back to the end of the previous one. |
| Delete | The same, forwards |
| Enter | Start a new equation line |
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
- Copying also puts **LaTeX** on the clipboard for other applications. A multi-character
  name is written as `\mathit{Vm\_init}`, so LaTeX treats it as one name too.
- Pasting text from elsewhere accepts **LaTeX** (`\frac{1}{2}`, `\sqrt{x}`,
  `\left|x\right|`, …) or **plain maths as you would type it** (`y = (x+1)/2 + sin(x)^2`),
  read with the same rules as typing. In pasted text, `a/b` always makes a fraction,
  and a LaTeX subscript keeps its underscore: `x_{12}` becomes the name `x_12`.
- **Copy as** in the toolbar copies the selection, or the whole equation, as **LaTeX**,
  **MathJSON** or **Content MathML**. A selection is exported on its own, so selecting
  `a+b` in `y=a+b` gives just `a+b`.
- In **CellML mode** (set by the application using the editor), Content MathML is
  ready for a CellML 2.0 model: it declares the CellML namespace, and every number gets
  `cellml:units="undefined"` as a placeholder for its units, which you'll need to
  replace with the real ones.

## `\` commands

Type `\`, the command's name, then Space, Enter, Tab or `(`. Esc cancels.

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
| anything else | the name typed out as letters (`\speed` gives `speed`) |

## Not supported yet

- **Subscript and superscript formatting in names.** Underscores are kept literally (see
  *Names*).
- **Declaring your own functions**, so that `f(x)` is a function call rather than f × x.
- **Chained comparisons** such as `a < b < c`: join them with ∧ instead.
- **Integrals, sums, products, limits and matrices.**
- **Typing a Greek letter's name without a backslash** to get the letter.
- **Pasting several lines as several equations.** Pasted text all goes into one equation.
