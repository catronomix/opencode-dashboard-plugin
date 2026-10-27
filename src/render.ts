/**
 * Turns a dashboard view-model into styled text rows.
 *
 * The dashboard composes a fixed character canvas and emits one styled row per
 * terminal line. That keeps horizontal/vertical scrolling, clipping and the
 * per-cell screensaver recolour exact, and avoids re-laying out hundreds of
 * nested boxes on every frame.
 */

import { createNoiseField, readable, type RGB } from "./palette.ts"
import { formatClock, padEnd, truncate, type SubVM, type TreeLine } from "./view.ts"

export const CARD_WIDTH = 50
export const CARD_GAP = 2
const INNER = CARD_WIDTH - 4

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
  readonly seconds: number
  readonly idleMs: number
  readonly idleLimit: number
  readonly cards: readonly CardVM[]
  readonly palette: Palette
  readonly sourceLabel: string
  readonly empty: string
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

  toRuns(screensaver: NoiseFieldLike | undefined, seconds: number): Row[] {
    return this.rows.map((cells, y) => {
      const runs: Run[] = []
      let current: { text: string; fg: RGB; bold: boolean } | undefined
      cells.forEach((cell, x) => {
        const fg = screensaver && cell.ch !== " " ? readable(screensaver.at(x, y, seconds)) : cell.fg
        if (current && current.fg === fg && current.bold === cell.bold) {
          current.text += cell.ch
          return
        }
        if (current) runs.push(current)
        current = { text: cell.ch, fg, bold: cell.bold }
      })
      if (current) runs.push(current)
      return runs
    })
  }
}

interface NoiseFieldLike {
  at(x: number, y: number, seconds: number): RGB
}

const screensaverField = createNoiseField()

export function cardHeight(card: CardVM, expanded = false): number {
  const tree = card.tree.length ? card.tree.length + 1 : 0
  const details = card.tree.filter((line) => line.sub && isExpanded(line, expanded)).length * DETAIL_ROWS
  return 8 + tree + details
}

/** A row's own expand flag wins over the global one (space toggles a single row). */
export function isExpanded(line: TreeLine, expanded: boolean): boolean {
  return line.expanded ?? expanded
}

export function contentSize(cards: readonly CardVM[], expanded = false): { width: number; height: number } {
  if (!cards.length) return { width: 0, height: 0 }
  const width = cards.length * CARD_WIDTH + (cards.length - 1) * CARD_GAP + 2
  const height = cards.reduce((max, card) => Math.max(max, cardHeight(card, expanded)), 0)
  return { width, height }
}

/** Clamps both scroll axes to what is actually scrollable. */
export function clampOffsets(
  cards: readonly CardVM[],
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  expanded = false,
): { offsetX: number; offsetY: number } {
  const content = contentSize(cards, expanded)
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
  card: CardVM,
  palette: Palette,
  expanded: boolean,
) {
  const border = card.active || card.selected ? palette.accent : palette.border
  const inner = INNER
  const right = x + CARD_WIDTH - 1
  const dot = statusDot(card, palette)
  const rows = cardHeight(card, expanded)
  const bottom = y + rows - 1

  // Frame.
  canvas.put(x, y, "╭", border)
  canvas.text(x + 1, y, "─".repeat(CARD_WIDTH - 2), border)
  canvas.put(right, y, "╮", border)
  canvas.put(x, bottom, "╰", border)
  canvas.text(x + 1, bottom, "─".repeat(CARD_WIDTH - 2), border)
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

  if (card.selected) canvas.put(x + CARD_WIDTH - 2, line(0), "◂", palette.accent, true)

  write(0, card.title || "(untitled session)", card.selected ? palette.accent : palette.text, true)
  write(1, card.path, palette.muted)
  write(2, [card.agent, card.model].filter(Boolean).join(" · "), palette.faint)

  drawCtxLine(canvas, x + 2, line(3), inner, card.ctxLabel, card.ctxRatio, palette)

  write(4, `tok ${card.tokensLabel}`, palette.muted)
  write(5, joinRight(card.costLabel, card.ageLabel, inner), palette.faint)

  if (card.tree.length) {
    const separatorY = line(6)
    canvas.put(x, separatorY, "├", border)
    canvas.text(x + 1, separatorY, "─".repeat(CARD_WIDTH - 2), border)
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
      if (entry.selected) canvas.put(x + CARD_WIDTH - 2, line(row), "◂", palette.accent, true)
      canvas.text(x + 2, line(row), label, fg, entry.selected)
      canvas.text(
        x + CARD_WIDTH - 3 - Array.from(detail).length,
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
  const clock = !vm.saverEnabled
    ? "screensaver off"
    : vm.screensaver
      ? "screensaver ON"
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

  const hints = "esc/q close ←/→ card ↑/↓ row enter open space fold PgUp/PgDn f all s saver"
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
    vm.cards.forEach((card, index) => {
      const x = 1 + index * (CARD_WIDTH + CARD_GAP) - vm.offsetX
      if (x + CARD_WIDTH < 0 || x >= width) return
      drawCard(canvas, x, HEADER_ROWS - vm.offsetY, card, palette, vm.expanded)
    })
  }

  return canvas.toRuns(vm.screensaver ? screensaverField : undefined, vm.seconds)
}
