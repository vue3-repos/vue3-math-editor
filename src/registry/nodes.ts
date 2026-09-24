// The functions the editor knows: every function CellML 2.0 allows in its
// MathML subset. A typed name that is exactly one of a function's spellings
// (its name, its LaTeX name or an alias) is that function (identifiers.ts).

export interface FunctionDefinition {
  name: string
  // Its usual written name, as drawn and as a LaTeX command or operator name
  // ("arcsin", "floor").
  latexName: string
  // Whether \latexName is a standard LaTeX command (\sin, \max); if not, the
  // name is written \operatorname{…} when copying as LaTeX.
  latexCommand: boolean
  mathMlTag: string
  // MathJSON operator (CortexJS standard library names).
  mathJson: string
  // Other spellings that type it ("ceil" for ceiling).
  aliases?: readonly string[]
}

type Entry = [
  name: string,
  latexName: string,
  latexCommand: boolean,
  mathMlTag: string,
  mathJson: string,
  aliases?: string[],
]

// prettier-ignore
const ENTRIES: Entry[] = [
  ['exp', 'exp', true, 'exp', 'Exp'],
  ['log', 'log', true, 'log', 'Log'],
  ['ln', 'ln', true, 'ln', 'Ln'],
  ['floor', 'floor', false, 'floor', 'Floor'],
  ['ceiling', 'ceiling', false, 'ceiling', 'Ceil', ['ceil']],
  ['min', 'min', true, 'min', 'Min'],
  ['max', 'max', true, 'max', 'Max'],
  // Remainder of a / b (MathML rem); MathJSON's Mod rounds differently for
  // negative numbers, so this is not Mod.
  ['rem', 'rem', false, 'rem', 'Remainder'],
  ['sin', 'sin', true, 'sin', 'Sin'],
  ['cos', 'cos', true, 'cos', 'Cos'],
  ['tan', 'tan', true, 'tan', 'Tan'],
  ['sec', 'sec', true, 'sec', 'Sec'],
  ['csc', 'csc', true, 'csc', 'Csc'],
  ['cot', 'cot', true, 'cot', 'Cot'],
  ['sinh', 'sinh', true, 'sinh', 'Sinh'],
  ['cosh', 'cosh', true, 'cosh', 'Cosh'],
  ['tanh', 'tanh', true, 'tanh', 'Tanh'],
  ['sech', 'sech', false, 'sech', 'Sech'],
  ['csch', 'csch', false, 'csch', 'Csch'],
  ['coth', 'coth', true, 'coth', 'Coth'],
  ['asin', 'arcsin', true, 'arcsin', 'Arcsin'],
  ['acos', 'arccos', true, 'arccos', 'Arccos'],
  ['atan', 'arctan', true, 'arctan', 'Arctan'],
  ['asec', 'arcsec', false, 'arcsec', 'Asec'],
  ['acsc', 'arccsc', false, 'arccsc', 'Acsc'],
  ['acot', 'arccot', false, 'arccot', 'Acot'],
  ['asinh', 'arcsinh', false, 'arcsinh', 'Arsinh'],
  ['acosh', 'arccosh', false, 'arccosh', 'Arcosh'],
  ['atanh', 'arctanh', false, 'arctanh', 'Artanh'],
  ['asech', 'arcsech', false, 'arcsech', 'Asech'],
  ['acsch', 'arccsch', false, 'arccsch', 'Acsch'],
  ['acoth', 'arccoth', false, 'arccoth', 'Arcoth'],
]

export const FUNCTION_REGISTRY: Record<string, FunctionDefinition> = Object.fromEntries(
  ENTRIES.map(([name, latexName, latexCommand, mathMlTag, mathJson, aliases]) => [
    name,
    { name, latexName, latexCommand, mathMlTag, mathJson, ...(aliases && { aliases }) },
  ]),
)

export function getFunctionDefinition(name: string): FunctionDefinition | null {
  return FUNCTION_REGISTRY[name.toLowerCase()] ?? null
}

// A function's name as LaTeX: \sin, or \operatorname{arcsinh} where there is
// no standard command. A trailing space ends a command name.
export function functionLatex(name: string): string {
  const definition = getFunctionDefinition(name)
  if (!definition) return `\\operatorname{${name}}`
  return definition.latexCommand
    ? `\\${definition.latexName} `
    : `\\operatorname{${definition.latexName}}`
}

// Functions drawn as brackets rather than by name: ⌊x⌋ and ⌈x⌉. A bracket
// group with one of these opening delimiters is that function applied to its
// contents (see layout.ts GroupDelimiter).
interface BracketFunction {
  open: string
  close: string
  latexOpen: string
  latexClose: string
}

const BRACKET_FUNCTIONS: Record<string, BracketFunction> = {
  floor: { open: '⌊', close: '⌋', latexOpen: '\\lfloor', latexClose: '\\rfloor' },
  ceiling: { open: '⌈', close: '⌉', latexOpen: '\\lceil', latexClose: '\\rceil' },
}

export const bracketsForFunction = (name: string) => BRACKET_FUNCTIONS[name]

export function functionForBracket(open: string): string | undefined {
  return Object.keys(BRACKET_FUNCTIONS).find((name) => BRACKET_FUNCTIONS[name].open === open)
}

// LaTeX for a group's delimiters: ( ), | |, \lfloor \rfloor, \lceil \rceil.
export function delimiterLatex(delimiter: string): string {
  for (const brackets of Object.values(BRACKET_FUNCTIONS)) {
    if (delimiter === brackets.open) return brackets.latexOpen
    if (delimiter === brackets.close) return brackets.latexClose
  }
  return delimiter === '|' ? '|' : delimiter === ')' ? ')' : '('
}
