/**
 * Turns a dashboard view-model into styled text rows.
 *
 * The dashboard composes a fixed character canvas and emits one styled row per
 * terminal line. That keeps horizontal/vertical scrolling, clipping and the
 * per-cell screensaver recolour exact, and avoids re-laying out hundreds of
 * nested boxes on every frame.
 */

import {
  createMatrixField,
  createNoiseField,
  createSkyField,
  createSweepField,
  readable,
  type RGB,
  type SaverLook,
} from "./palette.ts"
import { formatClock, padEnd, truncate, type SubVM, type TreeLine } from "./view.ts"

/** Columns between two cards. */
export const CARD_GAP = 2
/** A card narrower than this cannot show its fields at all. */
export const MIN_CARD_WIDTH = 24
/** `D`ynamic: the selected card grows by this factor... */
export const DYNAMIC_WIDE = 1.2
/** ...while every other card shrinks to this factor. */
export const DYNAMIC_SLIM = 0.75

/** Rows a subagent detail block adds under its tree line: path, agent·model, ctx, tok, cost·age. */
export const DETAIL_ROWS = 5

export interface Palette {
  readonly text: RGB
  readonly muted: RGB
  readonly faint: RGB
  readonly background: RGB
  readonly border: RGB
  readonly accent: RGB
  readonly ok: RGB
  readonly warn: RGB
  readonly error: RGB
}

export interface CardVM {
  readonly id: string
  readonly title: string
  readonly path: string
  readonly model: string
  readonly agent: string
  readonly status: "running" | "idle"
  readonly active: boolean
  readonly unread?: "activity" | "error"
  readonly ctxLabel: string
  readonly ctxRatio: number | null
  readonly tokensLabel: string
  readonly costLabel: string
  readonly ageLabel: string
  readonly tree: readonly TreeLine[]
  /** The keyboard selection rests on this card (on the card itself). */
  readonly selected?: boolean
}

export interface ViewModel {
  readonly width: number
  readonly height: number
  readonly offsetX: number
  readonly offsetY: number
  readonly screensaver: boolean
  /** Screensaver is enabled at all; when false the clock reads `screensaver off`. */
  readonly saverEnabled: boolean
  /** Subagent detail blocks are expanded (toggled with `f`, persisted). */
  readonly expanded: boolean
  /** Which screensaver look is showing (cycled with the arrow keys, persisted). */
  readonly saverLook?: number
  /** Default card width in columns (from the settings file). */
  readonly cardWidth: number
  /** `D`ynamic widths: the selected card is wider, the rest slimmer. */
  readonly dynamic: boolean
  /** Index of the selected card, so `dynamic` knows which one to widen. */
  readonly selectedIndex: number
  readonly seconds: number
  readonly idleMs: number
  readonly idleLimit: number
  readonly cards: readonly CardVM[]
  readonly palette: Palette
  readonly sourceLabel: string
  readonly empty: string
}

/** How cards are sized: plain, or the `D`ynamic emphasis around the selection. */
export interface Layout {
  /** Default card width in columns. */
  readonly base: number
  readonly dynamic: boolean
  readonly selected: number
  readonly expanded: boolean
}

export function layoutOf(vm: ViewModel): Layout {
  return { base: vm.cardWidth, dynamic: vm.dynamic, selected: vm.selectedIndex, expanded: vm.expanded }
}

/** Per-card widths; with `dynamic` the selected card gains 20%, the rest lose 25%. */
export function cardWidths(count: number, layout: Layout): number[] {
  const base = Math.max(MIN_CARD_WIDTH, layout.base)
  if (!layout.dynamic) return Array.from({ length: count }, () => base)
  const wide = Math.max(MIN_CARD_WIDTH, Math.round(base * DYNAMIC_WIDE))
  const slim = Math.max(MIN_CARD_WIDTH, Math.round(base * DYNAMIC_SLIM))
  return Array.from({ length: count }, (_, index) => (index === layout.selected ? wide : slim))
}

/** Left column of a card, in un-scrolled content coordinates (first card at 1). */
export function cardLeft(widths: readonly number[], index: number): number {
  let left = 1
  for (let at = 0; at < index && at < widths.length; at++) left += widths[at] + CARD_GAP
  return left
}

export interface Run {
  readonly text: string
  readonly fg: RGB
  readonly bold: boolean
}

export type Row = readonly Run[]

interface Cell {
  ch: string
  fg: RGB
  bold: boolean
}

class Canvas {
  private readonly rows: Cell[][]
  readonly width: number
  readonly height: number

  constructor(width: number, height: number, fg: RGB) {
    this.width = width
    this.height = height
    this.rows = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => ({ ch: " ", fg, bold: false })),
    )
  }

  put(x: number, y: number, ch: string, fg: RGB, bold = false) {
    if (y < 0 || y >= this.height || x < 0 || x >= this.width) return
    this.rows[y][x] = { ch, fg, bold }
  }

  /** Writes text, clipping at the right edge and at `maxWidth` cells. */
  text(x: number, y: number, value: string, fg: RGB, bold = false, maxWidth = Number.POSITIVE_INFINITY) {
    if (y < 0 || y >= this.height) return
    const chars = Array.from(value)
    const limit = Math.min(chars.length, maxWidth)
    for (let index = 0; index < limit; index++) this.put(x + index, y, chars[index], fg, bold)
  }

  fill(x: number, y: number, width: number, ch: string, fg: RGB, bold = false) {
    for (let index = 0; index < width; index++) this.put(x + index, y, ch, fg, bold)
  }

  row(index: number): Cell[] {
    return this.rows[index] ?? []
  }

  toRuns(saver: SaverLook | undefined, seconds: number, glyphStartRow = 0): Row[] {
    return this.rows.map((cells, y) => {
      const runs: Run[] = []
      let current: { text: string; fg: RGB; bold: boolean } | undefined
      cells.forEach((cell, x) => {
        let ch = cell.ch
        let fg = cell.fg
        if (saver && y >= glyphStartRow && cell.ch === " ") {
          // Glyph overrides only fill empty cells, so the dashboard's own text
          // keeps its characters under a sparkling look. The header band is
          // excluded so the clock and key hints stay readable.
          const glyph = saver.glyph?.(x, y, seconds)
          if (glyph !== undefined) ch = glyph
        }
        if (saver && ch !== " ") fg = readable(saver.at(x, y, seconds), saver.floor)
        if (current && current.fg === fg && current.bold === cell.bold) {
          current.text += ch
          return
        }
        if (current) runs.push(current)
        current = { text: ch, fg, bold: cell.bold }
      })
      if (current) runs.push(current)
      return runs
    })
  }
}

/**
 * Every screensaver look, in cycle order. Each one recolours the same canvas,
 * so switching is instant and the dashboard stays readable underneath.
 */
export const SCREENSAVER_LOOKS: readonly SaverLook[] = [
  createNoiseField(),
  createMatrixField(),
  createSweepField(),
  createSkyField(),
]

/** Wraps around, and tolerates junk from a hand-edited settings file. */
export function saverLookOf(index: number | undefined): SaverLook {
  const count = SCREENSAVER_LOOKS.length
  const safe = Number.isFinite(index) ? Math.round(index as number) : 0
  return SCREENSAVER_LOOKS[((safe % count) + count) % count]
}

/**
 * What the mouse is over. The dashboard is a character canvas, so a click is
 * resolved against the same geometry `buildRows` draws: a card, a subagent tree
 * row (its header line) or an expanded subagent detail block.
 */
export type DashboardHit =
  | { readonly kind: "none" }
  | { readonly kind: "chrome" }
  | { readonly kind: "card"; readonly card: number; readonly id: string }
  | { readonly kind: "row"; readonly card: number; readonly row: number; readonly id: string }
  | { readonly kind: "detail"; readonly card: number; readonly row: number; readonly id: string }

/** Card-relative line offsets, shared with `drawCard`: 6 fields, separator, tree. */
const TREE_FIRST_LINE = 8

export function hitTest(vm: ViewModel, x: number, y: number): DashboardHit {
  if (x < 0 || y < 0 || x >= vm.width || y >= vm.height) return { kind: "none" }
  if (y < HEADER_ROWS) return { kind: "chrome" }
  const layout = layoutOf(vm)
  const widths = cardWidths(vm.cards.length, layout)
  const top = HEADER_ROWS - vm.offsetY
  for (let index = 0; index < vm.cards.length; index++) {
    const card = vm.cards[index]
    const left = cardLeft(widths, index) - vm.offsetX
    const width = widths[index]
    const height = cardHeight(card, layout.expanded)
    if (x < left || x >= left + width || y < top || y >= top + height) continue
    let row = top + TREE_FIRST_LINE
    for (let position = 0; position < card.tree.length; position++) {
      const line = card.tree[position]
      if (y === row) return { kind: "row", card: index, row: position, id: line.id }
      row++
      if (line.sub && isExpanded(line, layout.expanded)) {
        if (y >= row && y < row + DETAIL_ROWS) {
          return { kind: "detail", card: index, row: position, id: line.id }
        }
        row += DETAIL_ROWS
      }
    }
    return { kind: "card", card: index, id: card.id }
  }
  return { kind: "none" }
}

export function cardHeight(card: CardVM, expanded = false): number {
  const tree = card.tree.length ? card.tree.length + 1 : 0
  const details = card.tree.filter((line) => line.sub && isExpanded(line, expanded)).length * DETAIL_ROWS
  return 8 + tree + details
}

/** A row's own expand flag wins over the global one (space toggles a single row). */
export function isExpanded(line: TreeLine, expanded: boolean): boolean {
  return line.expanded ?? expanded
}

export function contentSize(cards: readonly CardVM[], layout: Layout): { width: number; height: number } {
  if (!cards.length) return { width: 0, height: 0 }
  const widths = cardWidths(cards.length, layout)
  const width = widths.reduce((total, value) => total + value, 0) + (cards.length - 1) * CARD_GAP + 2
  const height = cards.reduce((max, card) => Math.max(max, cardHeight(card, layout.expanded)), 0)
  return { width, height }
}

/** Clamps both scroll axes to what is actually scrollable. */
export function clampOffsets(
  cards: readonly CardVM[],
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  layout: Layout,
): { offsetX: number; offsetY: number } {
  const content = contentSize(cards, layout)
  const viewportHeight = Math.max(1, height - HEADER_ROWS)
  const maxX = Math.max(0, content.width - width + 2)
  const maxY = Math.max(0, content.height - viewportHeight)
  return {
    offsetX: Math.max(0, Math.min(offsetX, maxX)),
    offsetY: Math.max(0, Math.min(offsetY, maxY)),
  }
}

export const HEADER_ROWS = 3

function joinRight(left: string, right: string, width: number): string {
  const rightChars = Array.from(right)
  const leftChars = Array.from(left)
  if (rightChars.length >= width) return truncate(right, width)
  if (leftChars.length + rightChars.length + 1 > width) {
    const room = Math.max(0, width - rightChars.length - 1)
    return `${padEnd(truncate(left, room), room)} ${right}`
  }
  return left + " ".repeat(width - leftChars.length - rightChars.length) + right
}

function bar(ratio: number, width: number): { filled: number; empty: number } {
  const clamped = Math.max(0, Math.min(1, ratio))
  const filled = Math.round(clamped * width)
  return { filled, empty: width - filled }
}

function statusDot(card: CardVM, palette: Palette): { glyph: string; fg: RGB } {
  if (card.unread === "error") return { glyph: "●", fg: palette.error }
  if (card.status === "running") return { glyph: "●", fg: palette.ok }
  if (card.unread === "activity") return { glyph: "◑", fg: palette.warn }
  return { glyph: "○", fg: palette.muted }
}

/** `ctx <bar> pct  used/limit`, shared by the card body and subagent detail blocks. */
function drawCtxLine(
  canvas: Canvas,
  x: number,
  y: number,
  width: number,
  label: string,
  ratio: number | null,
  palette: Palette,
) {
  const barWidth = 14
  const pct = ratio === null ? "   " : `${String(Math.round(ratio * 100)).padStart(3)}%`
  const parts = bar(ratio ?? 0, barWidth)
  const fg =
    ratio === null ? palette.faint : ratio > 0.9 ? palette.error : ratio > 0.7 ? palette.warn : palette.ok
  const prefix = "ctx "
  const pctX = x + prefix.length + barWidth + 1
  canvas.text(x, y, prefix, palette.faint)
  canvas.text(x + prefix.length, y, "█".repeat(parts.filled) + "░".repeat(parts.empty), fg)
  canvas.text(pctX, y, pct, fg)
  const room = width - (prefix.length + barWidth + 1 + pct.length + 1)
  if (room > 0) canvas.text(pctX + pct.length + 1, y, padEnd(truncate(label, room), room), palette.muted)
}

/** Same fields the main card shows, indented under a subagent tree line. */
function drawSubDetail(canvas: Canvas, x: number, y: number, width: number, sub: SubVM, palette: Palette) {
  const write = (offset: number, value: string, fg: RGB) =>
    canvas.text(x, y + offset, padEnd(truncate(value, width), width), fg)
  write(0, sub.path, palette.muted)
  write(1, [sub.agent, sub.model].filter(Boolean).join(" · "), palette.faint)
  drawCtxLine(canvas, x, y + 2, width, sub.ctxLabel, sub.ctxRatio, palette)
  write(3, `tok ${sub.tokensLabel}`, palette.muted)
  write(4, joinRight(sub.costLabel, sub.ageLabel, width), palette.faint)
}

function drawCard(
  canvas: Canvas,
  x: number,
  y: number,
  width: number,
  card: CardVM,
  palette: Palette,
  expanded: boolean,
) {
  const border = card.active || card.selected ? palette.accent : palette.border
  const inner = width - 4
  const right = x + width - 1
  const dot = statusDot(card, palette)
  const rows = cardHeight(card, expanded)
  const bottom = y + rows - 1

  // Frame.
  canvas.put(x, y, "╭", border)
  canvas.text(x + 1, y, "─".repeat(width - 2), border)
  canvas.put(right, y, "╮", border)
  canvas.put(x, bottom, "╰", border)
  canvas.text(x + 1, bottom, "─".repeat(width - 2), border)
  canvas.put(right, bottom, "╯", border)
  for (let row = y + 1; row < bottom; row++) {
    canvas.put(x, row, "│", border)
    canvas.put(right, row, "│", border)
  }

  // Header strip inside the top border.
  const status = card.status === "running" ? "running" : card.unread === "error" ? "error" : "idle"
  const flags = `${card.active ? " · focused" : ""}${card.selected ? " · selected" : ""}`
  const headerLabel = ` ${dot.glyph} ${status}${flags} `
  const headerFg = card.selected
    ? palette.accent
    : card.status === "running"
      ? palette.ok
      : card.unread === "error"
        ? palette.error
        : palette.muted
  const headerX = x + 2
  canvas.put(headerX, y, dot.glyph, dot.fg, true)
  canvas.text(headerX + 2, y, headerLabel.slice(3), headerFg, true)

  const line = (index: number) => y + 1 + index
  const write = (index: number, value: string, fg: RGB, bold = false) =>
    canvas.text(x + 2, line(index), padEnd(truncate(value, inner), inner), fg, bold)

  if (card.selected) canvas.put(x + width - 2, line(0), "◂", palette.accent, true)

  write(0, card.title || "(untitled session)", card.selected ? palette.accent : palette.text, true)
  write(1, card.path, palette.muted)
  write(2, [card.agent, card.model].filter(Boolean).join(" · "), palette.faint)

  drawCtxLine(canvas, x + 2, line(3), inner, card.ctxLabel, card.ctxRatio, palette)

  write(4, `tok ${card.tokensLabel}`, palette.muted)
  write(5, joinRight(card.costLabel, card.ageLabel, inner), palette.faint)

  if (card.tree.length) {
    const separatorY = line(6)
    canvas.put(x, separatorY, "├", border)
    canvas.text(x + 1, separatorY, "─".repeat(width - 2), border)
    canvas.put(right, separatorY, "┤", border)
    let row = 7
    card.tree.forEach((entry) => {
      const detail = truncate(entry.detail, 16)
      const connector = Array.from(entry.connector).length
      const room = inner - Array.from(detail).length - 1
      const label = padEnd(
        truncate(`${entry.connector}${entry.title}`, Math.max(4, room)),
        Math.max(0, room),
      )
      const fg = entry.selected ? palette.accent : entry.status === "running" ? palette.ok : palette.muted
      if (entry.selected) canvas.put(x + width - 2, line(row), "◂", palette.accent, true)
      canvas.text(x + 2, line(row), label, fg, entry.selected)
      canvas.text(
        x + width - 3 - Array.from(detail).length,
        line(row),
        detail,
        entry.selected ? palette.accent : entry.status === "running" ? palette.ok : palette.faint,
      )
      row++
      if (entry.sub && isExpanded(entry, expanded)) {
        drawSubDetail(canvas, x + 2 + connector, line(row), Math.max(4, inner - connector), entry.sub, palette)
        row += DETAIL_ROWS
      }
    })
  }
}

/** Renders the whole dashboard into styled rows. */
export function buildRows(vm: ViewModel): Row[] {
  const { width, height, palette } = vm
  const canvas = new Canvas(width, height, palette.text)

  // Chrome.
  const title = " OPENCODE DASHBOARD "
  const running = vm.cards.filter((card) => card.status === "running").length
  const idleLeft = Math.max(0, vm.idleLimit - vm.idleMs)
  const look = saverLookOf(vm.saverLook)
  const lookNumber = SCREENSAVER_LOOKS.indexOf(look) + 1
  const clock = !vm.saverEnabled
    ? "screensaver off"
    : vm.screensaver
      ? `screensaver ON · ${lookNumber}/${SCREENSAVER_LOOKS.length} ${look.name}`
      : `screensaver in ${formatClock(idleLeft)}`
  const clockText = ` ${clock} `
  const clockFg = !vm.saverEnabled
    ? palette.faint
    : vm.screensaver
      ? palette.accent
      : idleLeft < 30_000
        ? palette.warn
        : palette.faint
  const summary = ` ${vm.cards.length} sessions · ${running} running `
  const room = Math.max(0, width - Array.from(clockText).length)
  canvas.text(0, 0, truncate(title, room), palette.accent, true)
  canvas.text(
    Math.min(Array.from(title).length - 1, room),
    0,
    truncate(summary, Math.max(0, room - Array.from(title).length + 1)),
    palette.muted,
    true,
  )
  canvas.text(Math.max(0, width - Array.from(clockText).length), 0, clockText, clockFg, vm.screensaver)

  // Key hints: letter shortcuts show the key that types them, so `[F]old all`
  // is `F`; special keys get their whole name bracketed. `·` separates groups.
  // While the screensaver runs the arrows change the look and any other key
  // wakes the dashboard, so the hints swap to say so.
  const hints = vm.screensaver
    ? [
        "[←/→] next look",
        `[${lookNumber}/${SCREENSAVER_LOOKS.length}] ${look.name}`,
        "[any other key] wake",
      ].join(" · ")
    : [
        "[esc/q] close",
        "[←/→] card",
        "[↑/↓] row",
        "[enter] open",
        "[space] fold",
        "[F]old all",
        "[D]ynamic",
        "[S]creensaver",
        "[PgUp/PgDn] scroll",
      ].join(" · ")
  canvas.text(0, 1, truncate(hints, Math.max(0, width - vm.sourceLabel.length - 2)), palette.faint)
  canvas.text(
    Math.max(0, width - Array.from(vm.sourceLabel).length),
    1,
    vm.sourceLabel,
    palette.muted,
    true,
  )
  canvas.text(0, 2, "─".repeat(width), palette.border)

  if (!vm.cards.length) {
    canvas.text(2, HEADER_ROWS, vm.empty, palette.muted)
  } else {
    const layout = layoutOf(vm)
    const widths = cardWidths(vm.cards.length, layout)
    vm.cards.forEach((card, index) => {
      const cardWidth = widths[index]
      const x = cardLeft(widths, index) - vm.offsetX
      if (x + cardWidth < 0 || x >= width) return
      drawCard(canvas, x, HEADER_ROWS - vm.offsetY, cardWidth, card, palette, vm.expanded)
    })
  }

  return canvas.toRuns(vm.screensaver ? look : undefined, vm.seconds, HEADER_ROWS)
}
