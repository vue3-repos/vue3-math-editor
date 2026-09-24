// DOM geometry for the cursor: where to draw the caret for a cursor, and
// which cursor a click lands on. Works on KaTeX output produced from
// renderers/layoutLatex.ts, where every atom carries data-atom=<id> and
// every row data-row=<encoded path>.
//
// This is the only place the editor reads the DOM, and it only reads it: the
// cursor itself always lives in the model (cursor.ts).

import type { Cursor } from './cursor'
import { type Atom, type Row, type RowPath, getRow } from './layout'
import { decodeRowPath, encodeRowPath } from '../renderers/layoutLatex'

export interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

// ---------------------------------------------------------------------------
// Painted bounds
// ---------------------------------------------------------------------------

// KaTeX span boxes don't match what is painted:
// - inter-atom spacing is an `.mspace` margin placed *inside* the previous
//   atom's span, so an atom's own box includes the gap after it;
// - fraction and script rows are zero-height `.vlist > span` markers shifted
//   with `position: relative`, so ancestors are shorter than their content;
// - radical signs are huge SVGs clipped by an `overflow: hidden` ancestor;
// - fractions carry invisible `.nulldelimiter` padding on each side.
// So measure leaves only, skip spacing, struts and padding, and stop at
// clipping ancestors (whose own box is the visible, clipped size).

const SKIP_CLASSES = ['mspace', 'strut', 'pstrut', 'vlist-s', 'nulldelimiter']

function clipsOverflow(el: Element): boolean {
  const style = window.getComputedStyle(el)
  return style.overflow === 'hidden' || style.overflowX === 'hidden' || style.overflowY === 'hidden'
}

export function paintedBounds(target: Element): Bounds | null {
  const bounds: Bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }

  const grow = (rect: DOMRect) => {
    if (rect.width === 0 && rect.height === 0) return
    bounds.left = Math.min(bounds.left, rect.left)
    bounds.top = Math.min(bounds.top, rect.top)
    bounds.right = Math.max(bounds.right, rect.right)
    bounds.bottom = Math.max(bounds.bottom, rect.bottom)
  }

  const visit = (el: Element) => {
    if (SKIP_CLASSES.some((name) => el.classList.contains(name))) return

    if (el.children.length === 0 || clipsOverflow(el)) {
      grow(el.getBoundingClientRect())
      return
    }

    for (const child of Array.from(el.children)) visit(child)
  }

  visit(target)

  return Number.isFinite(bounds.left) ? bounds : null
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

function atomElement(container: Element, atom: Atom): Element | null {
  return container.querySelector(`[data-atom="${atom.id}"]`)
}

function rowElement(container: Element, path: RowPath): Element | null {
  return container.querySelector(`[data-row="${encodeRowPath(path)}"]`)
}

function atomBounds(container: Element, atom: Atom | undefined): Bounds | null {
  if (!atom) return null
  const el = atomElement(container, atom)
  return el ? paintedBounds(el) : null
}

const isTextLike = (atom: Atom | undefined) => atom?.kind === 'symbol' || atom?.kind === 'function'

// ---------------------------------------------------------------------------
// Gap geometry
// ---------------------------------------------------------------------------

export interface GapGeometry {
  // Client coordinates.
  x: number
  top: number
  bottom: number
  // The gap is an empty row, shown as a placeholder box.
  placeholder: boolean
}

// Where the gap at `offset` in the row at `path` is painted.
export function gapGeometry(
  container: Element,
  root: Row,
  path: RowPath,
  offset: number,
): GapGeometry | null {
  const row = getRow(root, path)
  if (!row) return null

  if (row.length === 0) {
    // Empty row: the gap is the placeholder itself.
    const el = rowElement(container, path)
    const box = el ? paintedBounds(el) : null
    return box
      ? { x: (box.left + box.right) / 2, top: box.top, bottom: box.bottom, placeholder: true }
      : null
  }

  // Atoms that aren't drawn (a number's hidden units) are passed over.
  const drawn = (atom: Atom | undefined) => !!atom && !!atomElement(container, atom)
  let b = offset - 1
  while (b >= 0 && !drawn(row[b]) && row[b].kind === 'units') b--
  let a = offset
  while (a < row.length && !drawn(row[a]) && row[a].kind === 'units') a++
  const before = row[b]
  const after = row[a]
  const beforeBox = atomBounds(container, before)
  const afterBox = atomBounds(container, after)

  let x: number
  if (beforeBox && afterBox) x = (beforeBox.right + afterBox.left) / 2
  else if (beforeBox) x = beforeBox.right + 1
  else if (afterBox) x = afterBox.left - 1
  else return null

  // Height: follow the text around the gap rather than a tall neighbour
  // (the caret beside a fraction is text-height, centred on the baseline).
  const vertical =
    [before, after].filter(isTextLike).map((atom) => atomBounds(container, atom))[0] ??
    atomBounds(container, row.find(isTextLike)) ??
    beforeBox ??
    afterBox!

  return { x, top: vertical.top, bottom: vertical.bottom, placeholder: false }
}

export interface CaretBox {
  // Relative to the container's padding box, including its scroll offset,
  // ready to use as absolute-position styles.
  left: number
  top: number
  height: number
  // The cursor is in an empty row. The editor shows the active placeholder
  // instead of drawing a caret line through it.
  placeholder: boolean
}

export function caretBox(container: HTMLElement, root: Row, cursor: Cursor): CaretBox | null {
  const gap = gapGeometry(container, root, cursor.path, cursor.offset)
  if (!gap) return null

  const base = container.getBoundingClientRect()
  const minHeight = 14

  const height = Math.max(minHeight, gap.bottom - gap.top)
  const top = (gap.top + gap.bottom) / 2 - height / 2

  return {
    left: gap.x - base.left + container.scrollLeft,
    top: top - base.top + container.scrollTop,
    height,
    placeholder: gap.placeholder,
  }
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

// The offset in the row at `path` whose gap is nearest to clientX.
export function nearestOffset(
  container: Element,
  root: Row,
  path: RowPath,
  clientX: number,
): number {
  const row = getRow(root, path)
  if (!row) return 0

  let best = 0
  let bestDistance = Infinity

  for (let offset = 0; offset <= row.length; offset++) {
    const gap = gapGeometry(container, root, path, offset)
    if (!gap) continue

    const distance = Math.abs(gap.x - clientX)
    if (distance < bestDistance) {
      best = offset
      bestDistance = distance
    }
  }

  return best
}

// Whether (x, y) is on the bar of the fraction (or derivative) that owns
// `rowEl`. Glyph boxes above and below the bar reach almost to it, so without
// this a click on the bar would land in the numerator or denominator; on the
// bar it should place the cursor before or after the whole fraction.
function onOwnFractionBar(rowEl: Element, x: number, y: number): boolean {
  const owner = rowEl.parentElement?.closest('[data-atom]')
  if (!owner) return false

  const tolerance = 2

  return Array.from(owner.querySelectorAll('.frac-line')).some((line) => {
    if (line.closest('[data-atom]') !== owner) return false // a nested fraction's bar
    const box = line.getBoundingClientRect()
    return (
      x >= box.left && x <= box.right && y >= box.top - tolerance && y <= box.bottom + tolerance
    )
  })
}

// The cursor a click at (clientX, clientY) should place: the gap nearest to
// the click in the innermost row whose painted box contains it, or in the
// root row if none does. A click on a fraction bar belongs to the row that
// contains the fraction.
export function hitTest(container: Element, root: Row, clientX: number, clientY: number): Cursor {
  const slack = 2
  let bestPath: RowPath = []

  for (const el of Array.from(container.querySelectorAll('[data-row]'))) {
    const path = decodeRowPath(el.getAttribute('data-row'))
    if (!path || path.length <= bestPath.length || !getRow(root, path)) continue
    if (onOwnFractionBar(el, clientX, clientY)) continue

    const box = paintedBounds(el)
    if (
      box &&
      clientX >= box.left - slack &&
      clientX <= box.right + slack &&
      clientY >= box.top - slack &&
      clientY <= box.bottom + slack
    ) {
      bestPath = path
    }
  }

  return { path: bestPath, offset: nearestOffset(container, root, bestPath, clientX) }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export interface SelectionBox {
  // Relative to the container, like CaretBox.
  left: number
  top: number
  width: number
  height: number
}

// The painted extent of the selected atoms (one box: a selection is always a
// contiguous range within one row).
export function selectionBox(
  container: HTMLElement,
  root: Row,
  selection: { path: RowPath; start: number; end: number },
): SelectionBox | null {
  const row = getRow(root, selection.path)
  if (!row) return null

  return atomsBox(
    container,
    row.slice(selection.start, selection.end).map((atom) => atom.id),
  )
}

// The painted extent of some atoms, as one box relative to the container,
// padded by `pad` pixels. Meant for consecutive atoms of one row (a selection,
// or the atoms a diagnostic covers). Atoms that aren't rendered are ignored.
export function atomsBox(
  container: HTMLElement,
  atomIds: readonly string[],
  pad = 2,
): SelectionBox | null {
  let bounds: Bounds | null = null

  for (const id of atomIds) {
    const el = container.querySelector(`[data-atom="${id}"]`)
    const box = el ? paintedBounds(el) : null
    if (!box) continue
    bounds = bounds
      ? {
          left: Math.min(bounds.left, box.left),
          top: Math.min(bounds.top, box.top),
          right: Math.max(bounds.right, box.right),
          bottom: Math.max(bounds.bottom, box.bottom),
        }
      : box
  }

  if (!bounds) return null

  const base = container.getBoundingClientRect()

  return {
    left: bounds.left - base.left + container.scrollLeft - pad,
    top: bounds.top - base.top + container.scrollTop - pad,
    width: bounds.right - bounds.left + pad * 2,
    height: bounds.bottom - bounds.top + pad * 2,
  }
}
