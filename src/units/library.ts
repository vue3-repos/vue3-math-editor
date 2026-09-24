// The units the user's equations can use: libCellML's built-in units plus the
// units defined in the user's CellML files. Only the <units> of each file are
// kept; components, variables and maths are ignored, so any CellML model can
// serve as a units file. CellML 1.0 and 1.1 files are read too (libCellML
// converts them).
//
// Loading has no side effects on the files: units the user defines later go
// into a units-only file of their own (see docs/design.md).

import {
  Handles,
  LEVEL_ERROR,
  loggerIssues,
  standardUnitsNames,
  type LcModel,
  type LcUnits,
  type LibCellML,
} from './libcellml'

// A CellML file's name (for messages) and text.
export interface UnitsSource {
  name: string
  text: string
}

// Something wrong with a units file: it couldn't be read, it defines units
// that were already defined differently, or it imports units.
export interface UnitsLibraryProblem {
  source: string
  message: string
}

export class UnitsLibrary {
  // The defined units names, in the order they were loaded.
  readonly names: readonly string[]
  // Each source file's units names, as kept.
  readonly sources: readonly { name: string; units: readonly string[] }[]
  readonly problems: readonly UnitsLibraryProblem[]

  private readonly standard: ReadonlySet<string>
  private readonly defined = new Map<string, LcUnits>()
  private readonly handles = new Handles()

  private constructor(
    private readonly lc: LibCellML,
    sources: readonly UnitsSource[],
  ) {
    this.standard = new Set(standardUnitsNames(lc))

    const kept: { name: string; units: string[] }[] = []
    const problems: UnitsLibraryProblem[] = []
    const definedIn = new Map<string, string>()

    for (const source of sources) {
      const units: string[] = []
      kept.push({ name: source.name, units })

      const model = this.parse(source, problems)

      for (let i = 0; i < model.unitsCount(); i++) {
        const found = this.handles.track(model.unitsByIndex(i))
        const name = found.name()
        const problem = (message: string) => problems.push({ source: source.name, message })

        if (found.isImport()) {
          problem(`"${name}" is imported from another file, which isn't supported; it was skipped`)
        } else if (this.standard.has(name)) {
          problem(`"${name}" is a built-in units name, so this definition was skipped`)
        } else if (this.defined.has(name)) {
          if (!this.lc.Units.equivalent(this.defined.get(name)!, found)) {
            problem(
              `"${name}" is already defined differently in ${definedIn.get(name)}; that definition is used`,
            )
          }
        } else {
          this.defined.set(name, found)
          definedIn.set(name, source.name)
          units.push(name)
        }
      }
    }

    for (const [name, units] of this.defined) {
      for (let i = 0; i < units.unitCount(); i++) {
        const reference = units.unitAttributeReference(i)
        if (!this.isKnown(reference)) {
          problems.push({
            source: definedIn.get(name)!,
            message: `"${name}" is made from "${reference}", which isn't defined`,
          })
        }
      }
    }

    this.names = [...this.defined.keys()]
    this.sources = kept
    this.problems = problems
  }

  static load(lc: LibCellML, sources: readonly UnitsSource[]): UnitsLibrary {
    return new UnitsLibrary(lc, sources)
  }

  // A built-in units name.
  isStandard(name: string): boolean {
    return this.standard.has(name)
  }

  // Built in, or defined in the library.
  isKnown(name: string): boolean {
    return this.standard.has(name) || this.defined.has(name)
  }

  // The defined units that `names` need: themselves and, recursively, the
  // units their definitions refer to. Built-in and unknown names are left out.
  requiredBy(names: Iterable<string>): string[] {
    const needed: string[] = []
    const visit = (name: string) => {
      const units = this.defined.get(name)
      if (!units || needed.includes(name)) return
      needed.push(name)
      for (let i = 0; i < units.unitCount(); i++) visit(units.unitAttributeReference(i))
    }
    for (const name of names) visit(name)
    return needed
  }

  // Copy the units `names` need into `model`.
  addTo(model: LcModel, names: Iterable<string>, handles: Handles): void {
    for (const name of this.requiredBy(names)) {
      model.addUnits(handles.track(this.defined.get(name)!.clone()))
    }
  }

  dispose(): void {
    this.defined.clear()
    this.handles.dispose()
  }

  // Whatever units the parser could read, with its errors as problems.
  private parse(source: UnitsSource, problems: UnitsLibraryProblem[]): LcModel {
    // Not strict, so CellML 1.x files are read too.
    const parser = new this.lc.Parser(false)
    try {
      const model = this.handles.track(parser.parseModel(source.text))
      for (const issue of loggerIssues(parser)) {
        if (issue.level === LEVEL_ERROR)
          problems.push({ source: source.name, message: issue.message })
      }
      return model
    } finally {
      parser.delete()
    }
  }
}
