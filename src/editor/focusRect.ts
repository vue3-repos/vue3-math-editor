// KaTeX marks the focused node with an inline span, but an inline element's
// CSS background only covers its own line box, not tall children such as
// fractions. The caller measures the span instead and draws an absolutely
// positioned ring from the rect returned here.
//
// Fractions (and the derivative operator, which reuses \frac) are built by
// KaTeX as a table-cell (.vlist) with an explicit short CSS height, while its
// numerator/denominator rows are shifted into view via `position: relative`
// offsets from zero-height wrapper spans. Relative offsets move painted
// pixels without growing the ancestor's box, so the focused span's own
// getBoundingClientRect() stays as short as that nominal container height.
// To get the true painted extent we union the rects of all descendants too.
//
// Radical signs (\sqrt, \root) are drawn with an <svg> whose intrinsic width
// is a huge fixed value (e.g. 400em) that gets visually clipped by an
// ancestor with `overflow: hidden` and an explicit small width/height. That
// ancestor's own rect reflects the real clipped size, but the raw <svg>'s
// rect does not shrink to match, so we must stop descending once we reach a
// clipping ancestor instead of unioning in its (oversized) children.
export interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

function clipsOverflow(el: Element): boolean {
  const style = window.getComputedStyle(el)
  return style.overflow === 'hidden' || style.overflowX === 'hidden' || style.overflowY === 'hidden'
}

// Each row of a KaTeX .vlist (numerator, frac-line, denominator, ...) is an
// otherwise-unclassed `.vlist > span`: `display: block; height: 0; position:
// relative`, shifted into place with an inline `top` offset. Its own
// getBoundingClientRect() is a zero-height reference mark, not a content
// box — and when a row is itself nested inside another vlist (e.g. a
// superscript inside a fraction's numerator, as in the derivative operator
// d/dt), that mark can land far outside the row's actual painted content.
// Its real content lives in its children, which we still need to visit.
function isVlistRow(el: Element): boolean {
  return el.parentElement?.classList.contains('vlist') === true
}

export function measureFocusRect(target: Element): Bounds {
  const bounds: Bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }

  const grow = (rect: DOMRect) => {
    if (rect.width === 0 && rect.height === 0) return
    bounds.left = Math.min(bounds.left, rect.left)
    bounds.top = Math.min(bounds.top, rect.top)
    bounds.right = Math.max(bounds.right, rect.right)
    bounds.bottom = Math.max(bounds.bottom, rect.bottom)
  }

  const visit = (el: Element) => {
    // pstrut spans are invisible baseline-alignment helpers, not real
    // content; including them would inflate the ring beyond the visible
    // glyphs.
    if (el.classList.contains('pstrut')) return

    if (!isVlistRow(el)) grow(el.getBoundingClientRect())

    if (clipsOverflow(el)) return

    for (const child of Array.from(el.children)) {
      visit(child)
    }
  }

  visit(target)

  return bounds
}
