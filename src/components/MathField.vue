<script setup lang="ts">
// The equation editing surface: renders a layout row with KaTeX, draws the
// caret and selection as overlays, moves the cursor with the arrow keys and
// the mouse, and runs editing commands for typed keys (editor/keymap.ts).
//
// It owns no state. Navigation and selection emit `navigate` with the new
// { cursor, anchor }; edits emit `edit` with the new { root, cursor } and what
// kind of edit it was (so the parent can record undo history, grouping
// consecutive typing; see editor/history.ts). Keys it doesn't use bubble up:
// Ctrl/Cmd/Alt shortcuts other than select-all, ↑/↓ with no row above/below,
// and Backspace/Delete/Tab/Enter when they have nothing to do here (e.g.
// Backspace in an empty equation, Enter outside a piecewise).
//
// Marks underline atoms with a problem (red for a parser diagnostic, amber
// for a units issue) and show the message when the pointer is over them;
// hint marks (a variable's units) show only on hover.
//
// Copy, cut and paste use the browser's clipboard events (so the system
// shortcuts and menus work): copying writes the selection as the editor's own
// format plus LaTeX text; pasting reads either (editor/clipboard.ts), and
// equations from elsewhere (editor/pasteFormats.ts) are handed to the
// parent, which decides where they go: Content MathML as an `import`, and
// Word's equations and Presentation MathML as a `paste-presentation`.
//
// A plain click (no modifier keys, not a double click or a drag) also emits
// `atom-click` with the id of the atom it landed on, for the parent to tell
// whether it was a name (the workbench's `variable-click`).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import katex from 'katex'

import {
  type SelectionBox,
  atomsBox,
  caretBox,
  hitTest,
  nearestOffset,
  rowBox,
  selectionBox,
} from '../editor/caretGeometry'
import { CLIPBOARD_MIME, rowToLatexSource, serializeAtoms } from '../editor/clipboard'
import { type EditorState, deleteBackward, insertAtoms } from '../editor/commands'
import {
  type Cursor,
  type PickOffset,
  cursorAtEnd,
  cursorAtStart,
  cursorsEqual,
} from '../editor/cursor'
import { type EditInfo, OTHER_EDIT } from '../editor/history'
import { commandForKey, typedText } from '../editor/keymap'
import type { MathMLImport } from '../editor/mathmlImport'
import { readPastedData } from '../editor/pasteFormats'
import type { PresentationPaste } from '../editor/presentationImport'
import { type Row, getRow } from '../editor/layout'
import { type Mark, type MarkKind, isProblem, markKind } from '../editor/marks'
import { isExponentSignPosition } from '../editor/numbers'
import { isUnits, openUnitsId } from '../editor/numberUnits'
import {
  collapseSelection,
  extendSelection,
  extendSelectionTo,
  navigateHorizontal,
  navigateVertical,
  selectAll,
  selectBetween,
  selectedAtoms,
  selectionOf,
} from '../editor/selection'
import { KATEX_EDITOR_OPTIONS, rowToLatex } from '../renderers/layoutLatex'

export interface NavigationState {
  cursor: Cursor
  anchor: Cursor | null
}

// What to underline or explain on hover (editor/marks.ts). A ParseDiagnostic
// is a Mark.
export type { Mark, MarkKind } from '../editor/marks'

const props = withDefaults(
  defineProps<{
    modelValue: Row
    cursor: Cursor
    anchor?: Cursor | null
    active?: boolean
    readonly?: boolean
    marks?: readonly Mark[]
    // Greek letters drawn as letters (editor/names.ts); off, spelled out.
    greekNames?: boolean
    // Names' subscripts and superscripts typeset (editor/nameScripts.ts);
    // off, drawn as typed.
    typesetNames?: boolean
  }>(),
  {
    anchor: null,
    active: true,
    readonly: false,
    marks: () => [],
    greekNames: true,
    typesetNames: true,
  },
)

const emit = defineEmits<{
  navigate: [state: NavigationState]
  edit: [state: EditorState, info: EditInfo]
  // Content MathML was pasted (editor/mathmlImport.ts), or something that
  // couldn't be read (no equations, and the problem).
  import: [result: MathMLImport]
  // Word's equations or Presentation MathML were pasted, to be read
  // (editor/presentationImport.ts).
  'paste-presentation': [paste: PresentationPaste]
  // A plain click ended on this atom (see handleMousedown); a click on a
  // typeset name gives its first atom.
  'atom-click': [atomId: string]
}>()

const surfaceEl = ref<HTMLElement | null>(null)
const focused = ref(false)
const caretStyle = ref<Record<string, string> | null>(null)
const caretInPlaceholder = ref(false)
const selectionStyle = ref<Record<string, string> | null>(null)
// The part of the equation the cursor is in (under a root, in a numerator,
// an exponent), tinted so it's clear which level the caret is at: at the end
// of √x the caret is either still under the root (tinted) or after it (not).
const rowTintStyle = ref<Record<string, string> | null>(null)
const markBoxes = ref<Array<{ box: SelectionBox; message: string; kind: MarkKind }>>([])
// The mark under the pointer. Its tooltip is position: fixed, so the field's
// horizontal scrolling doesn't clip it, and placed from where a fixed
// element's left: 0; top: 0 actually is (fixedOriginEl): a transformed host,
// such as a PrimeVue Dialog, places fixed elements rather than the viewport.
const hoveredMark = ref<{ message: string; left: number; top: number } | null>(null)
const fixedOriginEl = ref<HTMLElement | null>(null)
// Bumped on every move so the blink animation restarts and the caret is
// visible straight after moving.
const caretKey = ref(0)

function state(): EditorState {
  return { root: props.modelValue, cursor: props.cursor, anchor: props.anchor }
}

const selection = computed(() => selectionOf(state()))

// A number's units are drawn only while being edited, or when a problem
// underlines them (editor/numberUnits.ts); otherwise they show on hover.
const shownUnits = computed(() => {
  const ids = new Set(props.marks.filter(isProblem).flatMap((mark) => mark.atomIds))
  const open = props.active ? openUnitsId(props.modelValue, props.cursor) : null
  if (open) ids.add(open)
  return ids
})

const html = computed(() =>
  katex.renderToString(
    rowToLatex(props.modelValue, {
      activeRow: props.active ? props.cursor.path : null,
      shownUnits: shownUnits.value,
      greekNames: props.greekNames,
      typesetNames: props.typesetNames,
      // The name being edited is drawn as typed.
      cursors: props.active ? [props.cursor, props.anchor] : [],
    }),
    KATEX_EDITOR_OPTIONS,
  ),
)

// While something is selected the selection box stands in for the caret.
const showCaret = computed(
  () =>
    props.active &&
    focused.value &&
    !selection.value &&
    caretStyle.value !== null &&
    !caretInPlaceholder.value,
)

const showRowTint = computed(() => props.active && focused.value && rowTintStyle.value !== null)

const showSelection = computed(() => props.active && selectionStyle.value !== null)

// Measured after every redraw, on resize, and when the pointer enters the
// field: its layout may have changed since without either (a host's font
// size, a pane resized, a dialog's opening animation).
function updateOverlays() {
  const container = surfaceEl.value
  const box = container ? caretBox(container, props.modelValue, props.cursor) : null

  caretStyle.value = box
    ? { left: `${box.left}px`, top: `${box.top}px`, height: `${box.height}px` }
    : null
  caretInPlaceholder.value = box?.placeholder ?? false

  // Not the whole equation, and not an empty row: its placeholder is
  // highlighted already.
  const path = props.cursor.path
  const tint =
    container && path.length > 0 && getRow(props.modelValue, path)?.length
      ? rowBox(container, path)
      : null
  rowTintStyle.value = tint
    ? {
        left: `${tint.left}px`,
        top: `${tint.top}px`,
        width: `${tint.width}px`,
        height: `${tint.height}px`,
      }
    : null

  const range = selection.value
  const area = container && range ? selectionBox(container, props.modelValue, range) : null
  selectionStyle.value = area
    ? {
        left: `${area.left}px`,
        top: `${area.top}px`,
        width: `${area.width}px`,
        height: `${area.height}px`,
      }
    : null

  markBoxes.value = container
    ? props.marks.flatMap((mark) => {
        const box = atomsBox(container, mark.atomIds, 1)
        return box ? [{ box, message: mark.message, kind: markKind(mark) }] : []
      })
    : []
  hoveredMark.value = null
}

function markStyle(box: SelectionBox): Record<string, string> {
  return {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    // Room below the glyphs for the wavy underline.
    height: `${box.height + 4}px`,
  }
}

function handleHover(event: MouseEvent) {
  const container = surfaceEl.value
  if (!container || dragAnchor || markBoxes.value.length === 0) {
    hoveredMark.value = null
    return
  }

  const base = container.getBoundingClientRect()
  const x = event.clientX - base.left + container.scrollLeft
  const y = event.clientY - base.top + container.scrollTop
  const under = markBoxes.value.filter(
    ({ box }) =>
      x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height + 4,
  )
  // A problem's message rather than a hint, where both apply.
  const hit = under.find((mark) => mark.kind !== 'hint') ?? under[0]
  const origin = fixedOriginEl.value?.getBoundingClientRect() ?? { left: 0, top: 0 }

  hoveredMark.value = hit
    ? {
        message: hit.message,
        left: base.left + hit.box.left - container.scrollLeft - origin.left,
        top: base.top + hit.box.top + hit.box.height + 6 - container.scrollTop - origin.top,
      }
    : null
}

watch(
  [html, () => props.cursor, () => props.anchor, () => props.active, () => props.marks],
  async () => {
    await nextTick()
    updateOverlays()
    caretKey.value++
  },
  { immediate: true, deep: true },
)

onMounted(() => {
  window.addEventListener('resize', updateOverlays)
  document.addEventListener('copy', handleCopy)
  document.addEventListener('cut', handleCut)
  document.addEventListener('paste', handlePaste)
  // Glyph metrics shift once the math fonts load.
  document.fonts?.ready.then(updateOverlays)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateOverlays)
  document.removeEventListener('copy', handleCopy)
  document.removeEventListener('cut', handleCut)
  document.removeEventListener('paste', handlePaste)
  // A press still down is no click: the field is going.
  clickedAtom = null
  stopDrag()
})

// ↑/↓ land on the gap nearest the caret's current x position.
const pickByCaretX: PickOffset = (_target, targetPath) => {
  const container = surfaceEl.value
  const box = container ? caretBox(container, props.modelValue, props.cursor) : null

  if (!container || !box) return props.cursor.offset

  const x = container.getBoundingClientRect().left + box.left - container.scrollLeft
  return nearestOffset(container, props.modelValue, targetPath, x)
}

function navigate(next: EditorState) {
  emit('navigate', { cursor: next.cursor, anchor: next.anchor ?? null })
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

function handleKeydown(event: KeyboardEvent) {
  const current = state()

  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    navigate(selectAll(current))
    return
  }

  if (event.altKey || event.ctrlKey || event.metaKey) return

  let next: EditorState | null

  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowRight': {
      const direction = event.key === 'ArrowRight' ? 'forward' : 'backward'
      next = event.shiftKey
        ? extendSelection(current, direction)
        : navigateHorizontal(current, direction)
      break
    }
    case 'ArrowUp':
    case 'ArrowDown':
      next = navigateVertical(current, event.key === 'ArrowUp' ? 'up' : 'down', pickByCaretX)
      if (!next) return // let the parent move to the previous/next equation
      break
    case 'Home':
    case 'End': {
      const edge = event.key === 'Home' ? 'start' : 'end'
      next = event.shiftKey
        ? extendSelectionTo(current, edge)
        : {
            ...current,
            cursor: edge === 'start' ? cursorAtStart() : cursorAtEnd(current.root),
            anchor: null,
          }
      break
    }
    case 'Escape':
      if (!current.anchor) return
      next = collapseSelection(current)
      break
    default:
      handleEditKey(event, current)
      return
  }

  event.preventDefault()

  if (next) {
    navigate(next)
  }
}

// Keys that do nothing here bubble up for the parent to use.
const BUBBLE_WHEN_UNUSED = new Set(['Backspace', 'Delete', 'Tab', 'Enter'])

function handleEditKey(event: KeyboardEvent, current: EditorState) {
  if (props.readonly) return

  const command = commandForKey(event)
  if (!command) return

  const next = command(current)

  if (next === current) {
    if (!BUBBLE_WHEN_UNUSED.has(event.key)) event.preventDefault()
    return
  }

  event.preventDefault()
  emit('edit', next, editInfo(event, current))
}

function editInfo(event: KeyboardEvent, current: EditorState): EditInfo {
  const replacedSelection = selectionOf(current) !== null
  const text = typedText(event)

  if (text !== null) {
    const row = getRow(current.root, current.cursor.path)
    // At the end of a number with hidden units, typing goes before the units.
    const offset = current.cursor.offset - (isUnits(row?.[current.cursor.offset - 1]) ? 1 : 0)
    const exponentSign =
      !replacedSelection &&
      (text === '-' || text === '+') &&
      !!row &&
      isExponentSignPosition(row, offset)
    return { kind: 'type', text, replacedSelection, exponentSign }
  }
  if (event.key === 'Backspace') return { kind: 'deleteBackward', replacedSelection }
  if (event.key === 'Delete') return { kind: 'deleteForward', replacedSelection }
  return OTHER_EDIT
}

// ---------------------------------------------------------------------------
// Mouse: click to place the cursor, drag or Shift+click to select
// ---------------------------------------------------------------------------

let dragAnchor: Cursor | null = null
// Where the button went down, until the pointer moves further than
// DRAG_THRESHOLD from it: until then a press is a click, not a drag, so a
// pixel of jitter neither selects nor cancels the click.
let pressPoint: { x: number; y: number } | null = null
const DRAG_THRESHOLD = 4
// The atom a plain click started on, until the button is released: then it
// is the click's `atom-click`, unless the pointer selected something on the
// way.
let clickedAtom: string | null = null

// The atom under the pointer, as drawn: the innermost tagged atom, or a
// typeset name (its first atom), whose decorations and gaps carry no atom.
function atomAt(event: MouseEvent): string | null {
  const target = event.target instanceof Element ? event.target : null
  const el = target?.closest<HTMLElement>('[data-atom], [data-name]')
  if (!el || !surfaceEl.value?.contains(el)) return null
  return el.dataset.atom ?? el.dataset.name ?? null
}

const plainClick = (event: MouseEvent) =>
  event.button === 0 &&
  event.detail <= 1 &&
  !event.shiftKey &&
  !event.ctrlKey &&
  !event.metaKey &&
  !event.altKey

function cursorAt(event: MouseEvent): Cursor | null {
  const container = surfaceEl.value
  return container ? hitTest(container, props.modelValue, event.clientX, event.clientY) : null
}

function handleMousedown(event: MouseEvent) {
  // Stop the browser selecting KaTeX text; place the cursor ourselves.
  event.preventDefault()
  hoveredMark.value = null
  if (event.button !== 0) return

  const hit = cursorAt(event)
  if (!hit) return

  surfaceEl.value?.focus()

  // Read before navigating, which redraws: a name the caret goes into is
  // drawn as typed.
  clickedAtom = plainClick(event) ? atomAt(event) : null

  const current = state()
  pressPoint = { x: event.clientX, y: event.clientY }
  dragAnchor = event.shiftKey ? (current.anchor ?? current.cursor) : hit
  navigate(selectBetween(current, dragAnchor, hit))

  window.addEventListener('mousemove', handleDragMove)
  window.addEventListener('mouseup', stopDrag)
}

function handleDragMove(event: MouseEvent) {
  if (!dragAnchor) return
  if (pressPoint) {
    const moved = Math.hypot(event.clientX - pressPoint.x, event.clientY - pressPoint.y)
    if (moved <= DRAG_THRESHOLD) return
    pressPoint = null
  }
  const hit = cursorAt(event)
  if (!hit) return
  // Selecting, not clicking.
  if (!cursorsEqual(hit, dragAnchor)) clickedAtom = null
  navigate(selectBetween(state(), dragAnchor, hit))
}

function stopDrag() {
  dragAnchor = null
  pressPoint = null
  window.removeEventListener('mousemove', handleDragMove)
  window.removeEventListener('mouseup', stopDrag)

  const atomId = clickedAtom
  clickedAtom = null
  if (atomId) emit('atom-click', atomId)
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

// Clipboard events go to the focused element, or the document when that
// isn't editable; either way, only the focused field responds.
const hasFocus = () => !!surfaceEl.value && document.activeElement === surfaceEl.value

// Put the selection on the clipboard. Returns whether there was one.
function copySelection(event: ClipboardEvent): boolean {
  const atoms = selectedAtoms(state())
  if (atoms.length === 0 || !event.clipboardData) return false

  event.preventDefault()
  event.clipboardData.setData(
    'text/plain',
    rowToLatexSource(atoms, { greekNames: props.greekNames, typesetNames: props.typesetNames }),
  )
  event.clipboardData.setData(CLIPBOARD_MIME, serializeAtoms(atoms))
  return true
}

function handleCopy(event: ClipboardEvent) {
  if (hasFocus()) copySelection(event)
}

function handleCut(event: ClipboardEvent) {
  if (!hasFocus() || props.readonly) return
  if (copySelection(event)) emit('edit', deleteBackward(state()), OTHER_EDIT)
}

function handlePaste(event: ClipboardEvent) {
  if (!hasFocus() || props.readonly || !event.clipboardData) return
  event.preventDefault()

  const data = event.clipboardData
  const pasted = readPastedData({
    own: data.getData(CLIPBOARD_MIME),
    html: data.getData('text/html'),
    text: data.getData('text/plain'),
  })

  switch (pasted.kind) {
    case 'atoms':
      if (pasted.atoms.length > 0) emit('edit', insertAtoms(pasted.atoms)(state()), OTHER_EDIT)
      return
    // Equations from elsewhere: the parent decides where they go.
    case 'content-mathml':
      emit('import', pasted.result)
      return
    case 'presentation':
      emit('paste-presentation', pasted.paste)
      return
    case 'unreadable':
      emit('import', { equations: [], problems: [pasted.message], lineProblems: [] })
      return
  }
}

// The caret's place on the screen (client coordinates), in an empty slot too:
// for the workbench's command list, shown at it.
function caretRect(): DOMRect | null {
  const container = surfaceEl.value
  const box = container ? caretBox(container, props.modelValue, props.cursor) : null
  if (!container || !box) return null
  const base = container.getBoundingClientRect()
  return new DOMRect(
    base.left + box.left - container.scrollLeft,
    base.top + box.top - container.scrollTop,
    0,
    box.height,
  )
}

defineExpose({ focus: () => surfaceEl.value?.focus(), caretRect })
</script>

<template>
  <div
    ref="surfaceEl"
    class="math-field"
    :class="{ active, focused }"
    tabindex="0"
    role="textbox"
    aria-label="Equation"
    :aria-invalid="marks.some(isProblem) || undefined"
    @keydown="handleKeydown"
    @mousedown="handleMousedown"
    @mouseenter="updateOverlays"
    @mousemove="handleHover"
    @mouseleave="hoveredMark = null"
    @focus="focused = true"
    @blur="focused = false"
  >
    <div v-if="showRowTint" class="row-tint" data-role="active-row" :style="rowTintStyle!"></div>
    <div v-if="showSelection" class="selection" :style="selectionStyle!"></div>
    <template v-for="(mark, index) in markBoxes" :key="index">
      <div
        v-if="mark.kind !== 'hint'"
        class="mark"
        :class="`mark-${mark.kind}`"
        data-role="mark"
        :data-kind="mark.kind"
        :style="markStyle(mark.box)"
      ></div>
    </template>
    <div v-if="showCaret" :key="caretKey" class="caret" :style="caretStyle!"></div>
    <div class="math-content" v-html="html"></div>
    <div
      v-if="hoveredMark"
      class="mark-tip"
      role="tooltip"
      data-role="mark-tip"
      :style="{ left: `${hoveredMark.left}px`, top: `${hoveredMark.top}px` }"
    >
      {{ hoveredMark.message }}
    </div>
    <span ref="fixedOriginEl" class="fixed-origin" aria-hidden="true"></span>
  </div>
</template>

<style scoped>
/* Colours are the workbench's (--me-accent and the rest, which a host can
   set: see EquationWorkbench.vue), with its defaults as fallbacks. */
.math-field {
  --mf-accent: var(--me-accent, #2563eb);
  --mf-units: var(--me-units, #60a5fa);

  position: relative;
  /* A host can set it on anything around the editor. */
  font-size: var(--me-line-font-size, 1.05rem);
  min-height: 2.6rem;
  padding: 0.45rem 0.7rem;
  display: flex;
  align-items: center;
  cursor: text;
  overflow-x: auto;
  outline: none;
  border-radius: 6px;
}

.math-field.focused {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--mf-accent) 35%, transparent);
}

.math-content {
  position: relative;
  z-index: 1;
  min-width: 0;
}

.selection {
  position: absolute;
  z-index: 0;
  border-radius: 3px;
  background: rgba(148, 163, 184, 0.3);
  pointer-events: none;
}

.row-tint {
  position: absolute;
  z-index: 0;
  border-radius: 3px;
  background: color-mix(in srgb, var(--mf-accent) 7%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mf-accent) 18%, transparent);
  pointer-events: none;
}

.math-field.focused .selection {
  background: color-mix(in srgb, var(--mf-accent) 20%, transparent);
}

/* A problem: a tint, and a wavy underline drawn in the problem's colour
   through a mask (a colour can't be a variable inside an SVG data URL). */
.mark {
  --mark-color: var(--me-danger, #dc2626);

  position: absolute;
  z-index: 0;
  pointer-events: none;
  border-radius: 2px;
  background: color-mix(in srgb, var(--mark-color) 8%, transparent);
}

.mark::after {
  --wave: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='M0 2.5 L1.5 0.5 L3 2.5 L4.5 0.5 L6 2.5' fill='none' stroke='black' stroke-width='1'/%3E%3C/svg%3E");

  content: '';
  position: absolute;
  inset: 0;
  background: var(--mark-color);
  -webkit-mask: var(--wave) repeat-x left bottom / 6px 3px;
  mask: var(--wave) repeat-x left bottom / 6px 3px;
}

/* A units problem: amber. */
.mark-units {
  --mark-color: var(--me-warn, #d97706);

  background: color-mix(in srgb, var(--mark-color) 10%, transparent);
}

/* KaTeX draws a stack reaching below the baseline (a fraction) with an empty
   strut over whatever lies there, and a root's surd over its radicand. Let a
   click through both to the atom drawn beneath (atomAt reads the target). */
.math-field :deep(.vlist-t2 > .vlist-r:nth-child(2) > .vlist),
.math-field :deep(.hide-tail) {
  pointer-events: none;
}

/* A number's units, while shown: upright and light blue after it. */
.math-field :deep(.me-units) {
  color: var(--mf-units);
}

/* An empty units slot, labelled "units": dashed and light blue, unlike the
   box of an empty fraction or exponent. */
.math-field :deep(.me-ph.me-units-ph) {
  padding: 0 0.15em;
  border: 1px dashed var(--mf-units);
  border-radius: 3px;
  color: var(--mf-units);
}

.math-field.focused :deep(.me-units-ph.me-ph-active) {
  color: color-mix(in srgb, var(--mf-units) 75%, var(--mf-accent));
  background: color-mix(in srgb, var(--mf-units) 12%, transparent);
}

/* Hidden units: a very small triangle in the number's top right corner. */
.math-field :deep(.me-units-flag) {
  position: relative;
  display: inline-block;
  width: 0;
  height: 0;
}

.math-field :deep(.me-units-flag)::after {
  content: '';
  position: absolute;
  right: -0.05em;
  bottom: 0.52em;
  border-top: 0.22em solid var(--mf-units);
  border-left: 0.22em solid transparent;
}

.fixed-origin {
  position: fixed;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  visibility: hidden;
  pointer-events: none;
}

.mark-tip {
  position: fixed;
  z-index: 10;
  width: max-content;
  max-width: 24rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.35rem;
  background: var(--me-tip-bg, #1e293b);
  color: var(--me-tip-text, #f8fafc);
  font-size: 0.75rem;
  line-height: 1.3;
  white-space: normal;
  pointer-events: none;
}

.caret {
  position: absolute;
  z-index: 2;
  width: 2px;
  margin-left: -1px;
  background: var(--mf-accent);
  pointer-events: none;
  animation: math-field-blink 1.1s step-end infinite;
}

.math-field :deep(.katex-display) {
  margin: 0;
  text-align: left;
}

.math-field :deep(.katex-display > .katex) {
  text-align: left;
}

.math-field :deep(.me-ph) {
  color: color-mix(in srgb, var(--me-muted, #64748b) 70%, transparent);
}

.math-field.focused :deep(.me-ph-active) {
  color: var(--mf-accent);
  background: color-mix(in srgb, var(--mf-accent) 12%, transparent);
  border-radius: 2px;
}

@keyframes math-field-blink {
  50% {
    opacity: 0;
  }
}
</style>
