// The parts of libcellml.js (libCellML compiled to WebAssembly) that the units
// checker uses, typed structurally so that nothing here imports libcellml.js:
// the host loads it (usually through the vue3-libcellml.js plugin) and passes
// the loaded module in. Only what the checker calls is listed.
//
// Every object libcellml.js returns wraps C++ memory that JavaScript's garbage
// collector can't see, so each must be released with delete() when done with;
// `Handles` below keeps track of them.

export interface Deletable {
  delete(): void
}

export interface LcEnum {
  value: number
}

export interface LcIssue extends Deletable {
  description(): string
  level(): LcEnum
  // Undefined for some parser issues (XML errors).
  referenceRule(): LcEnum | undefined
}

export interface LcLogger extends Deletable {
  issueCount(): number
  issue(index: number): LcIssue
}

export interface LcUnits extends Deletable {
  name(): string
  setName(name: string): void
  unitCount(): number
  unitAttributeReference(index: number): string
  isImport(): boolean
  clone(): LcUnits
}

export interface LcVariable extends Deletable {
  setName(name: string): void
  setUnitsByName(name: string): void
}

export interface LcComponent extends Deletable {
  setName(name: string): void
  setMath(math: string): void
  addVariable(variable: LcVariable): boolean
}

export interface LcModel extends Deletable {
  setName(name: string): void
  unitsCount(): number
  unitsByIndex(index: number): LcUnits
  unitsByName(name: string): LcUnits | null
  addUnits(units: LcUnits): boolean
  addComponent(component: LcComponent): boolean
  // Point units referred to by name at the model's units of that name.
  linkUnits(): boolean
}

export interface LcParser extends LcLogger {
  parseModel(text: string): LcModel
}

export interface LcValidator extends LcLogger {
  validateModel(model: LcModel): void
}

export interface LcAnalyser extends LcLogger {
  analyseModel(model: LcModel): void
}

export interface LcPrinter extends Deletable {
  printModel(model: LcModel): string
}

// The loaded libcellml.js module.
export interface LibCellML {
  Parser: new (strict: boolean) => LcParser
  Validator: new () => LcValidator
  Analyser: new () => LcAnalyser
  Printer: new () => LcPrinter
  Model: new () => LcModel
  Component: new () => LcComponent
  Variable: new () => LcVariable
  Units: {
    new (): LcUnits
    equivalent(a: LcUnits, b: LcUnits): boolean
    // Names of libCellML's built-in units, as enum keys (AMPERE, …).
    StandardUnit: Record<string, unknown>
  }
}

// Issue levels.
export const LEVEL_ERROR = 0
export const LEVEL_WARNING = 1

// The analyser's reference rule for units problems (ANALYSER_UNITS).
export const RULE_ANALYSER_UNITS = 112

// The issues a logger (parser, validator or analyser) has, as plain data.
export function loggerIssues(logger: LcLogger): { message: string; level: number; rule: number }[] {
  const issues = []
  for (let i = 0; i < logger.issueCount(); i++) {
    const issue = logger.issue(i)
    const level = issue.level()
    const rule = issue.referenceRule()
    issues.push({ message: issue.description(), level: level.value, rule: rule?.value ?? -1 })
    deleteEnum(level)
    if (rule) deleteEnum(rule)
    issue.delete()
  }
  return issues
}

// Enum values are plain objects in some builds and handles in others.
function deleteEnum(value: LcEnum) {
  ;(value as Partial<Deletable>).delete?.()
}

// Collects libcellml.js objects so they can all be released at once.
export class Handles {
  private readonly held: Deletable[] = []

  track<T extends Deletable | null>(handle: T): T {
    if (handle) this.held.push(handle)
    return handle
  }

  dispose(): void {
    for (const handle of this.held.splice(0).reverse()) handle.delete()
  }
}

// libCellML's built-in units names: ampere, becquerel, … weber.
export function standardUnitsNames(lc: LibCellML): string[] {
  return Object.keys(lc.Units.StandardUnit)
    .filter((key) => /^[A-Z_]+$/.test(key))
    .map((key) => key.toLowerCase())
}
