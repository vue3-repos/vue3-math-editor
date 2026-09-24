// Mathematical and logical constants: the ones CellML 2.0 allows in its
// MathML subset (<pi/>, <exponentiale/>, <infinity/>, <notanumber/>, <true/>,
// <false/>).
//
// Each is one symbol atom whose value is the constant's name, inserted with a
// \ command. They are drawn the way they are written in print, distinct from
// variables: π, an upright e (a typed letter e is the variable e), ∞, NaN,
// true, false. The Greek letter π (\pi) is always the constant.

import type { MathJsonValue } from '../renderers/mathjson'

export interface Constant {
  // The symbol atom's value, and the Constant AST node's name.
  symbol: string
  // LaTeX, as drawn and as copied.
  latex: string
  // Content MathML element name.
  mathml: string
  mathJson: MathJsonValue
  // \ commands that insert it while typing.
  commands: readonly string[]
}

export const CONSTANTS: readonly Constant[] = [
  { symbol: 'pi', latex: '\\pi', mathml: 'pi', mathJson: 'Pi', commands: ['pi'] },
  {
    symbol: 'exponentiale',
    latex: '\\mathrm{e}',
    mathml: 'exponentiale',
    mathJson: 'ExponentialE',
    commands: ['e', 'exponentiale'],
  },
  {
    symbol: 'infinity',
    latex: '\\infty',
    mathml: 'infinity',
    mathJson: { num: '+Infinity' },
    commands: ['inf', 'infty', 'infinity'],
  },
  {
    symbol: 'notanumber',
    latex: '\\mathrm{NaN}',
    mathml: 'notanumber',
    mathJson: { num: 'NaN' },
    commands: ['nan', 'NaN', 'notanumber'],
  },
  { symbol: 'true', latex: '\\mathrm{true}', mathml: 'true', mathJson: 'True', commands: ['true'] },
  {
    symbol: 'false',
    latex: '\\mathrm{false}',
    mathml: 'false',
    mathJson: 'False',
    commands: ['false'],
  },
]

const BY_SYMBOL = new Map(CONSTANTS.map((c) => [c.symbol, c]))
const BY_COMMAND = new Map(CONSTANTS.flatMap((c) => c.commands.map((name) => [name, c] as const)))

export const constantForSymbol = (value: string) => BY_SYMBOL.get(value)
export const constantForCommand = (name: string) => BY_COMMAND.get(name)

// Reading pasted LaTeX: \pi and \infty, and \mathrm{…} of e, NaN, true or
// false. (\mathrm{e} straight before a brace is the e of a number in
// scientific notation instead; see clipboard.ts.)
const LATEX_COMMANDS = new Map([
  ['pi', 'pi'],
  ['infty', 'infinity'],
])
const LATEX_UPRIGHT = new Map([
  ['e', 'exponentiale'],
  ['NaN', 'notanumber'],
  ['true', 'true'],
  ['false', 'false'],
])

export const constantForLatexCommand = (name: string) => LATEX_COMMANDS.get(name)
export const constantForUprightText = (text: string) => LATEX_UPRIGHT.get(text)
