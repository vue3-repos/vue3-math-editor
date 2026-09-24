// Loads libcellml.js (a devDependency) for the units checker's tests, which
// run in Node: // @vitest-environment node
import { createRequire } from 'node:module'

import type { LibCellML } from '../src/units/libcellml'

const require = createRequire(import.meta.url)

let loading: Promise<LibCellML> | undefined

export function loadLibCellML(): Promise<LibCellML> {
  loading ??= (require('libcellml.js/libcellml.common') as () => Promise<LibCellML>)()
  return loading
}

// A CellML 2.0 file defining `units`, each as (name, [reference, prefix?, exponent?][]).
export function unitsFile(
  units: Record<string, [string, string?, number?][]>,
  version: '2.0' | '1.1' = '2.0',
): string {
  const body = Object.entries(units)
    .map(
      ([name, parts]) =>
        `<units name="${name}">${parts
          .map(
            ([reference, prefix, exponent]) =>
              `<unit units="${reference}"${prefix ? ` prefix="${prefix}"` : ''}${exponent !== undefined ? ` exponent="${exponent}"` : ''}/>`,
          )
          .join('')}</units>`,
    )
    .join('')
  return `<?xml version="1.0"?><model xmlns="http://www.cellml.org/cellml/${version}#" name="units">${body}</model>`
}
