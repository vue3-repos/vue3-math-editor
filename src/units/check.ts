// Checking the units of the workbench's equation lines with libCellML.
//
// Each line is checked on its own, in a check model of its own: a component
// holding the line's maths and a variable for each name it uses, with the
// units the user gave it, plus the library units those need. So one bad line
// doesn't stop the others being checked, and a line's result depends only on
// its MathML and its variables' units, which is what results are cached by.
//
// Before libCellML sees a line, two things are checked here, because either
// would stop libCellML's analyser: every variable must have units, and every
// units name must be known.

import type { EquationLine, UnitsIssue, VariableUnits } from '../editor/units'
import {
  Handles,
  LEVEL_ERROR,
  RULE_ANALYSER_UNITS,
  loggerIssues,
  type LibCellML,
} from './libcellml'
import type { UnitsLibrary } from './library'
import {
  describeUnitsMessage,
  operandNumbers,
  operandVariables,
  readUnitsMessage,
} from './messages'

type LineIssue = Omit<UnitsIssue, 'lineId'>

// A line's variables that have no units yet.
export function missingUnits(line: EquationLine, variableUnits: VariableUnits): string[] {
  return line.variables.filter((name) => !variableUnits[name])
}

const CACHE_LIMIT = 500

export class UnitsChecker {
  private readonly cache = new Map<string, LineIssue[]>()

  constructor(
    private readonly lc: LibCellML,
    private readonly library: UnitsLibrary,
  ) {}

  // The units issues of every complete line (incomplete lines aren't checked).
  check(lines: readonly EquationLine[], variableUnits: VariableUnits): UnitsIssue[] {
    return lines.flatMap((line) => this.checkLine(line, variableUnits))
  }

  // A line's units issues; none for an incomplete line, which isn't checked.
  checkLine(line: EquationLine, variableUnits: VariableUnits): UnitsIssue[] {
    if (!line.complete) return []
    const issues = this.prechecked(line, variableUnits) ?? this.analysed(line, variableUnits)
    return issues.map((issue) => ({ lineId: line.id, ...issue }))
  }

  // Problems that stop the line being analysed: variables without units, and
  // units names that aren't defined. Null when there are none.
  private prechecked(line: EquationLine, variableUnits: VariableUnits): LineIssue[] | null {
    const missing = missingUnits(line, variableUnits)
    if (missing.length) {
      return missing.map((name) => ({ message: `${name} has no units`, variables: [name] }))
    }

    const unknown = [
      ...new Set([...line.variables.map((name) => variableUnits[name]), ...line.units]),
    ].filter((units) => !this.library.isKnown(units))
    if (unknown.length) {
      return unknown.map((units) => ({
        message: `No units called ${units} are defined`,
        variables: line.variables.filter((name) => variableUnits[name] === units),
        units: line.units.includes(units) ? [units] : [],
      }))
    }

    return null
  }

  private analysed(line: EquationLine, variableUnits: VariableUnits): LineIssue[] {
    const key = `${line.mathml}\n${line.variables.map((name) => `${name}:${variableUnits[name]}`).join(' ')}`
    const cached = this.cache.get(key)
    if (cached) return cached

    const issues = this.analyse(line, variableUnits)
    if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(key, issues)
    return issues
  }

  private analyse(line: EquationLine, variableUnits: VariableUnits): LineIssue[] {
    const { lc } = this
    const handles = new Handles()
    try {
      const model = handles.track(new lc.Model())
      model.setName('units_check')
      this.library.addTo(
        model,
        [...line.variables.map((name) => variableUnits[name]), ...line.units],
        handles,
      )

      const component = handles.track(new lc.Component())
      component.setName('equation')
      for (const name of line.variables) {
        const variable = handles.track(new lc.Variable())
        variable.setName(name)
        variable.setUnitsByName(variableUnits[name])
        component.addVariable(variable)
      }
      component.setMath(line.mathml)
      model.addComponent(component)
      // Variables' units and units made from other units are set by name;
      // without linking, the analyser takes library units as undefined and
      // skips them.
      model.linkUnits()

      // The analyser only runs on a valid model. The prechecks cover what
      // the user can get wrong, so errors here mean the check model itself
      // is wrong; they are passed on rather than hidden.
      const validator = handles.track(new lc.Validator())
      validator.validateModel(model)
      const errors = loggerIssues(validator).filter((issue) => issue.level === LEVEL_ERROR)
      if (errors.length) {
        return errors.map((error) => ({
          message: `libCellML: ${withoutCheckModel(error.message)}`,
        }))
      }

      const analyser = handles.track(new lc.Analyser())
      analyser.analyseModel(model)
      // Other analyser issues are about the model (unknown variables,
      // uninitialised states), which a single equation always has.
      const messages = loggerIssues(analyser)
        .filter((issue) => issue.rule === RULE_ANALYSER_UNITS)
        .map((issue) => issue.message)

      return [...new Set(messages)].map((message) => lineIssue(message, line.variables))
    } finally {
      handles.dispose()
    }
  }

  dispose(): void {
    this.cache.clear()
  }
}

// A libCellML units message as an issue: the variables in the operands at
// fault, or where an operand has no variables, its numbers.
function lineIssue(message: string, variables: readonly string[]): LineIssue {
  const parsed = readUnitsMessage(message)
  if (!parsed) return { message: withoutCheckModel(message) }

  const underlined = new Set<string>()
  const numbers = new Set<number>()
  for (const operand of parsed.operands) {
    const found = operandVariables(operand.text, variables)
    for (const name of found) underlined.add(name)
    if (found.length === 0) for (const number of operandNumbers(operand.text)) numbers.add(number)
  }

  return {
    message: describeUnitsMessage(parsed),
    ...(underlined.size ? { variables: [...underlined] } : {}),
    ...(numbers.size ? { numbers: [...numbers] } : {}),
  }
}

// libCellML's message without the parts naming the check model.
function withoutCheckModel(message: string): string {
  return message.replace(/ in component 'equation'/g, '').replace(/ in model 'units_check'/g, '')
}
