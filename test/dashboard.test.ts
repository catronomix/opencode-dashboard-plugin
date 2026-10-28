import { test } from "node:test"
import assert from "node:assert/strict"

import { createMatrixField, createNoiseField, createSkyField, createSweepField, palette, Perlin, readable, SAVER_FLOOR } from "../src/palette.ts"
import { flattenTree, formatAge, formatCost, formatTokens, formatClock, padEnd, truncate, type SubVM } from "../src/view.ts"
import { ATTENTION_RANK, buildRows, cardHeight, cardLeft, cardWidths, clampOffsets, contentSize, DETAIL_ROWS, HEADER_ROWS, hitTest, SCREENSAVER_LOOKS, saverLookOf, type CardVM, type Layout, type Palette } from "../src/render.ts"
import { DEFAULT_CONFIG, DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH, configPath, parseConfig } from "../src/config.ts"

const theme: Palette = {
  text: [220, 220, 220],
  muted: [160, 160, 160],
  faint: [110, 110, 110],
  background: [20, 20, 20],
  border: [90, 90, 90],
  accent: [120, 170, 255],
  ok: [110, 200, 120],
  warn: [230, 190, 100],
  error: [230, 120, 120],
}

const sub: SubVM = {
  path: "~/code/project/sub",
  model: "deepseek-v4.1-flash",
  agent: "builder",
  ctxLabel: "40k/200k",
  ctxRatio: 0.2,
  tokensLabel: "120k",
  costLabel: "$0.02",
  ageLabel: "1m",
}

const view = {
  width: 80,
  height: 12,
  offsetX: 0,
  offsetY: 0,
  screensaver: false,
  saverEnabled: true,
  expanded: false,
  cardWidth: DEFAULT_WIDTH,
  dynamic: false,
  selectedIndex: 0,
  seconds: 0,
  idleMs: 0,
  idleLimit: 120_000,
  palette: theme,
  sourceLabel: "source: tabs",
  empty: "empty",
}

const plain: Layout = { base: DEFAULT_WIDTH, dynamic: false, selected: 0, expanded: false }

/** Indexes of every `glyph` in `text`, for frame-corner assertions. */
const collect = (text: string, glyph: string): number[] =>
  Array.from(text).flatMap((ch, index) => (ch === glyph ? [index] : []))

function card(overrides: Partial<CardVM> = {}): CardVM {
  return {
    id: "ses_1",
    title: "Fix auth bug",
    path: "~/code/project",
    model: "deepseek-v4.1-flash",
    agent: "build",
    status: "running",
    active: true,
    ctxLabel: "132k/200k",
    ctxRatio: 0.66,
    tokensLabel: "8.1M · 6.1M cache",
    costLabel: "$0.12",
    ageLabel: "2m",
    tree: [],
    ...overrides,
  }
}

test("palette is black below 40%", () => {
  assert.deepEqual(palette(0), [0, 0, 0])
  assert.deepEqual(palette(0.39), [0, 0, 0])
})

test("palette fades from black to red between 40% and 50%", () => {
  assert.deepEqual(palette(0.4), [0, 0, 0])
  assert.deepEqual(palette(0.45), [127, 0, 0])
  assert.deepEqual(palette(0.5), [255, 0, 0])
})

test("palette walks a full hue cycle from 50% to 100%", () => {
  const at60 = palette(0.6)
  const at80 = palette(0.8)
  assert.notDeepEqual(at60, at80)
  // 100% completes the loop back to red.
  assert.deepEqual(palette(1), [255, 0, 0])
  // Saturated full-brightness colours only.
  for (const step of [0.55, 0.62, 0.7, 0.83, 0.97]) {
    const color = palette(step)
    assert.equal(Math.max(...color), 255)
    assert.equal(Math.min(...color), 0)
  }
  assert.deepEqual(palette(2), palette(1))
})

test("perlin noise is deterministic and bounded", () => {
  const left = new Perlin(42)
  const right = new Perlin(42)
  for (let index = 0; index < 50; index++) {
    const x = index * 0.31
    const y = index * 0.17
    const z = index * 0.07
    const value = left.noise3(x, y, z)
    assert.equal(value, right.noise3(x, y, z))
    assert.ok(value > -1.2 && value < 1.2, `noise out of range: ${value}`)
  }
})

test("noise field animates over time", () => {
  const field = createNoiseField()
  const points: Array<[number, number]> = [
    [10, 4],
    [24, 9],
    [48, 12],
    [70, 20],
  ]
  const changed = points.some(([x, y]) => {
    const still = field.at(x, y, 0)
    const later = field.at(x, y, 3.5)
    for (const channel of still) assert.ok(channel >= 0 && channel <= 255)
    return still.join() !== later.join()
  })
  assert.ok(changed, "no sample changed colour over 3.5s")
})

test("token and cost formatting", () => {
  assert.equal(formatTokens(0), "0")
  assert.equal(formatTokens(999), "999")
  assert.equal(formatTokens(1200), "1.2k")
  assert.equal(formatTokens(12345), "12k")
  assert.equal(formatTokens(8_123_456), "8.12M")
  assert.equal(formatCost(0), "$0")
  assert.equal(formatCost(0.0012), "$0.001")
  assert.equal(formatCost(1.234), "$1.23")
})

test("ages and clock", () => {
  assert.equal(formatAge(1_000, 2_000), "now")
  assert.equal(formatAge(0, 30_000), "30s")
  assert.equal(formatAge(0, 5 * 60_000), "5m")
  assert.equal(formatAge(0, 3 * 3_600_000), "3h")
  assert.equal(formatClock(65_000), "1:05")
})

test("truncate and padEnd respect display width", () => {
  assert.equal(truncate("abcdef", 10), "abcdef")
  assert.equal(truncate("abcdef", 4), "abc…")
  assert.equal(truncate("abcdef", 1), "…")
  assert.equal(padEnd("ab", 4), "ab  ")
  assert.equal(padEnd("abcdef", 3), "abc")
})

test("tree flattening keeps connectors and depth", () => {
  const lines = flattenTree([
    { id: "a", title: "builder", detail: "running", status: "running", children: [
      { id: "b", title: "reviewer", detail: "idle", status: "idle", children: [] },
    ] },
    { id: "c", title: "explore", detail: "idle", status: "idle", children: [] },
  ])
  assert.deepEqual(
    lines.map((line) => `${line.connector}${line.title}`),
    ["├─ builder", "│  └─ reviewer", "└─ explore"],
  )
  assert.deepEqual(
    lines.map((line) => line.id),
    ["a", "b", "c"],
  )
})

test("tree flattening carries the subagent detail block", () => {
  const lines = flattenTree([
    { id: "a", title: "builder", detail: "running", status: "running", sub, children: [] },
  ])
  assert.deepEqual(lines[0].sub, sub)
})

test("card height grows with the subagent tree", () => {
  assert.equal(cardHeight(card()), 8)
  const withTree = card({
    tree: [
      { id: "a", connector: "├─ ", title: "builder", detail: "running", status: "running", sub },
      { id: "b", connector: "└─ ", title: "reviewer", detail: "idle", status: "idle" },
    ],
  })
  assert.equal(cardHeight(withTree), 11)
  // Each subagent with a detail payload adds its block only when expanded.
  assert.equal(cardHeight(withTree, true), 11 + DETAIL_ROWS)
})

test("content size covers every card plus gaps", () => {
  const size = contentSize([card(), card()], plain)
  assert.equal(size.width, 2 * DEFAULT_WIDTH + 2 + 2)
  assert.equal(size.height, 8)
})

test("offsets clamp to scrollable range", () => {
  const cards = [card(), card(), card()]
  assert.deepEqual(clampOffsets(cards, 40, 20, 0, 0, plain), { offsetX: 0, offsetY: 0 })
  const max = clampOffsets(cards, 40, 20, 10_000, 10_000, plain)
  assert.ok(max.offsetX > 0)
  assert.equal(max.offsetY, 0)
})

test("buildRows fills the viewport with styled rows", () => {
  const rows = buildRows({ ...view, cards: [card()] })
  assert.equal(rows.length, 12)
  for (const row of rows) {
    const width = row.reduce((total, run) => total + Array.from(run.text).length, 0)
    assert.equal(width, 80)
  }
  const header = rows[0].map((run) => run.text).join("")
  assert.match(header, /OPENCODE DASHBOARD/)
  assert.match(header, /1 sessions/)
  assert.match(header, /screensaver in 2:00/)
})

test("scrolling shifts card content and clips at the edges", () => {
  const base = {
    ...view,
    width: 60,
    height: 20,
    offsetY: 0,
    cards: [card(), card({ id: "ses_2", title: "Second" }), card({ id: "ses_3", title: "Third" })],
  }
  // Scroll to the far right of the content, the way the dashboard clamps it.
  const maxX = clampOffsets(base.cards, 60, 20, 10_000, 0, plain).offsetX
  const left = buildRows({ ...base, offsetX: 0 }).map((row) => row.map((run) => run.text).join("")).join("\n")
  const right = buildRows({ ...base, offsetX: maxX }).map((row) => row.map((run) => run.text).join("")).join("\n")
  assert.match(left, /Fix auth bug/)
  assert.doesNotMatch(right, /Fix auth bug/)
  assert.match(right, /Third/)
})

test("the subagent divider lines up with the card sides", () => {
  const rows = buildRows({
    ...view,
    cards: [
      card({
        tree: [{ id: "a", connector: "└─ ", title: "builder", detail: "running", status: "running" }],
      }),
    ],
  })
  const lines = rows.map((row) => row.map((run) => run.text).join(""))
  const top = lines[HEADER_ROWS]
  const divider = lines[HEADER_ROWS + 7]
  const left = top.indexOf("╭")
  const right = top.indexOf("╮")
  assert.equal(left, 1)
  // ├ and ┤ sit exactly under the card's vertical borders, one cell in.
  assert.equal(divider.indexOf("├"), left)
  assert.equal(divider.indexOf("┤"), right)
  assert.equal(divider.slice(left + 1, right), "─".repeat(right - left - 1))
})

test("selection is visible on the card header and the selected subagent row", () => {
  const tree = [
    { id: "a", connector: "├─ ", title: "builder", detail: "running", status: "running" as const, sub },
    { id: "b", connector: "└─ ", title: "reviewer", detail: "idle", status: "idle" as const },
  ]
  const text = (rows: ReturnType<typeof buildRows>) =>
    rows.map((row) => row.map((run) => run.text).join("")).join("\n")
  const onCard = text(buildRows({ ...view, height: 24, cards: [card({ selected: true, tree })] }))
  assert.match(onCard, /· selected/)

  const onRow = text(
    buildRows({
      ...view,
      height: 24,
      cards: [
        card({
          tree: tree.map((line, index) => ({ ...line, selected: index === 1 })),
        }),
      ],
    }),
  )
  assert.match(onRow, /◂/)
  assert.match(onRow, /reviewer/)
})

test("expanded details repeat the card fields under each subagent", () => {
  const tree = [{ id: "a", connector: "└─ ", title: "builder", detail: "running", status: "running" as const, sub }]
  const collapsed = buildRows({ ...view, height: 24, cards: [card({ tree })] })
  const expanded = buildRows({ ...view, height: 24, expanded: true, cards: [card({ tree })] })
  const text = (rows: ReturnType<typeof buildRows>) =>
    rows.map((row) => row.map((run) => run.text).join("")).join("\n")
  assert.doesNotMatch(text(collapsed), /project\/sub/)
  const shown = text(expanded)
  assert.match(shown, /project\/sub/)
  assert.match(shown, /builder · deepseek-v4\.1-flash/)
  assert.match(shown, /ctx /)
  assert.match(shown, /tok 120k/)
})

test("space expands a single subagent row regardless of the global fold", () => {
  const tree = [
    { id: "a", connector: "├─ ", title: "builder", detail: "running", status: "running" as const, sub, expanded: true },
    { id: "b", connector: "└─ ", title: "reviewer", detail: "idle", status: "idle" as const, sub: { ...sub, path: "~/code/other" }, expanded: false },
  ]
  const rows = buildRows({ ...view, height: 24, expanded: false, cards: [card({ tree })] })
  const text = rows.map((row) => row.map((run) => run.text).join("")).join("\n")
  assert.match(text, /project\/sub/)
  assert.doesNotMatch(text, /code\/other/)
  assert.equal(cardHeight(card({ tree }), false), 8 + 3 + DETAIL_ROWS)
})

test("the screensaver keeps glyphs on a readable dark grey floor", () => {  assert.deepEqual(readable([0, 0, 0]), [SAVER_FLOOR, SAVER_FLOOR, SAVER_FLOOR])
  assert.deepEqual(readable([255, 0, 40]), [255, SAVER_FLOOR, SAVER_FLOOR])
  // Identity is cached so run merging keeps working.
  const source = palette(0.2)
  assert.equal(readable(source), readable(source))
})

test("screensaver recolours glyphs and leaves blanks alone", () => {
  const rows = buildRows({
    ...view,
    height: 10,
    screensaver: true,
    seconds: 4,
    idleMs: 120_000,
    idleLimit: 120_000,
    cards: [card({ tree: [] })],
  })
  const text = rows.map((row) => row.map((run) => run.text).join("")).join("\n")
  assert.match(text, /OPENCODE DASHBOARD/)
  assert.match(text, /screensaver/)
  assert.doesNotMatch(text, /screensaver in/)
  // Nothing is painted black-on-black: every glyph colour clears the floor.
  for (const row of rows) {
    for (const run of row) {
      if (!run.text.trim()) continue
      assert.ok(Math.min(...run.fg) >= SAVER_FLOOR, `run too dark: ${run.text} ${run.fg}`)
    }
  }
})

test("a disabled screensaver never takes over", () => {
  const rows = buildRows({
    ...view,
    height: 10,
    saverEnabled: false,
    screensaver: false,
    idleMs: 120_000,
    idleLimit: 120_000,
    cards: [card()],
  })
  assert.match(rows[0].map((run) => run.text).join(""), /screensaver off/)
})

test("HEADER_ROWS leaves room for chrome", () => {
  assert.equal(HEADER_ROWS, 3)
})

test("settings clamp the card width and the screensaver delay", () => {
  assert.deepEqual(parseConfig(undefined), DEFAULT_CONFIG)
  assert.equal(DEFAULT_CONFIG.width, 45)
  assert.equal(DEFAULT_CONFIG.screensaverSeconds, 120)
  // Width is clamped to 40..100, whatever the file says.
  assert.equal(parseConfig({ width: 10 }).width, MIN_WIDTH)
  assert.equal(parseConfig({ width: 500 }).width, MAX_WIDTH)
  assert.equal(parseConfig({ width: 62 }).width, 62)
  assert.equal(parseConfig({ cardWidth: "48" }).width, 48)
  // Junk in one key must not lose the other.
  assert.equal(parseConfig({ width: "wide", screensaverSeconds: 300 }).screensaverSeconds, 300)
  assert.deepEqual(parseConfig("nonsense"), DEFAULT_CONFIG)
})

test("the settings file sits next to the OpenCode config", () => {
  assert.match(configPath({}), /session-dashboard\.json$/)
  assert.match(configPath({ OPENCODE_CONFIG_DIR: "C:/cfg" }), /cfg[\\/]session-dashboard\.json$/)
})

test("D dynamic widens the selection and slims the rest", () => {
  const plainWidths = cardWidths(3, plain)
  assert.deepEqual(plainWidths, [DEFAULT_WIDTH, DEFAULT_WIDTH, DEFAULT_WIDTH])

  const dynamicWidths = cardWidths(3, { ...plain, dynamic: true, selected: 1 })
  assert.equal(dynamicWidths[1], Math.round(DEFAULT_WIDTH * 1.2))
  assert.equal(dynamicWidths[0], Math.round(DEFAULT_WIDTH * 0.75))
  assert.equal(dynamicWidths[2], dynamicWidths[0])

  // Cards stay side by side after a wider selection: lefts follow the widths.
  assert.equal(cardLeft(dynamicWidths, 0), 1)
  assert.equal(cardLeft(dynamicWidths, 1), 1 + dynamicWidths[0] + 2)
  assert.equal(cardLeft(dynamicWidths, 2), 1 + dynamicWidths[0] + dynamicWidths[1] + 4)
})

test("D dynamic keeps the selected card frame closed and intact", () => {
  const rows = buildRows({
    ...view,
    width: 200,
    dynamic: true,
    selectedIndex: 1,
    cards: [card({ id: "ses_1", title: "Left" }), card({ id: "ses_2", title: "Wide" }), card({ id: "ses_3", title: "Right" })],
  })
  const top = rows[HEADER_ROWS].map((run) => run.text).join("")
  // Three closed boxes, in order, with the middle one wider than the rest.
  const corners = collect(top, "╭")
  const ends = collect(top, "╮")
  assert.equal(corners.length, 3)
  assert.equal(ends.length, 3)
  const widths = corners.map((left, index) => ends[index] - left + 1)
  assert.equal(widths[1], Math.round(DEFAULT_WIDTH * 1.2))
  assert.equal(widths[0], Math.round(DEFAULT_WIDTH * 0.75))
})

test("the hint row brackets every key", () => {
  const rows = buildRows({ ...view, width: 200, cards: [card()] })
  const hints = rows[1].map((run) => run.text).join("")
  for (const hint of ["[esc/q] close", "[←/→] card", "[enter] open", "[F]old all", "[D]ynamic", "[S]creensaver"]) {
    assert.ok(hints.includes(hint), `missing ${hint} in ${hints}`)
  }
})

test("mouse hits resolve to cards, tree rows and subagent detail blocks", () => {
  const tree = [
    { id: "sub_a", connector: "├─ ", title: "explorer", detail: "running", status: "running" as const, sub },
    { id: "sub_b", connector: "└─ ", title: "reviewer", detail: "idle", status: "idle" as const, sub, expanded: true },
  ]
  const vm = { ...view, height: 30, cards: [card({ tree })] }
  // Card body, above the subagent tree (tree starts 8 lines under the top).
  assert.deepEqual(hitTest(vm, 2, 5), { kind: "card", card: 0, id: "ses_1" })
  // Subagent header lines: row 0 is collapsed, row 1 straight after it.
  assert.deepEqual(hitTest(vm, 2, 11), { kind: "row", card: 0, row: 0, id: "sub_a" })
  // The second row is expanded, so clicking its header folds it.
  assert.deepEqual(hitTest(vm, 2, 12), { kind: "row", card: 0, row: 1, id: "sub_b" })
  // Its detail block opens the subagent.
  assert.deepEqual(hitTest(vm, 2, 13), { kind: "detail", card: 0, row: 1, id: "sub_b" })
  assert.deepEqual(hitTest(vm, 2, 17), { kind: "detail", card: 0, row: 1, id: "sub_b" })
  // Below the last detail row is still the card itself, not the tree.
  assert.deepEqual(hitTest(vm, 2, 18), { kind: "card", card: 0, id: "ses_1" })
  // Chrome, empty space, and the gap between two cards hit nothing clickable.
  assert.deepEqual(hitTest(vm, 2, 1), { kind: "chrome" })
  assert.deepEqual(hitTest(vm, 60, 5), { kind: "none" })
  assert.deepEqual(hitTest({ ...vm, cards: [card(), card({ id: "ses_2" })] }, 46, 5), { kind: "none" })
  // Vertical scrolling moves every click target with the content.
  assert.deepEqual(hitTest({ ...vm, offsetY: 2 }, 2, 9), { kind: "row", card: 0, row: 0, id: "sub_a" })
})

test("attention decorates the card header and subagent header lines", () => {
  const tree = [
    {
      id: "sub_a",
      connector: "├─ ",
      title: "builder",
      detail: "permission · 20% · 120k",
      status: "running" as const,
      attention: "permission" as const,
      sub,
    },
    {
      id: "sub_b",
      connector: "└─ ",
      title: "reviewer",
      detail: "question · 10%",
      status: "idle" as const,
      attention: "question" as const,
    },
  ]
  const vm = { ...view, height: 24, cards: [card({ attention: "permission", tree })] }
  const rows = buildRows(vm)
  const text = rows.map((row) => row.map((run) => run.text).join("")).join("\n")
  // Header: glyph + the reason instead of the status word.
  assert.match(text, /! permission/)
  assert.doesNotMatch(text, /● running/)
  // Subagent header lines: glyph before the title, reason before the numbers.
  assert.match(text, /├─ ! builder/)
  assert.match(text, /└─ \? reviewer/)
  assert.match(text, /permission · 20/)
  assert.match(text, /question · 10%/)
  // The decorators carry the reason's colour, on the header and on the rows.
  const colors = rows.flatMap((row) => row.filter((run) => run.text.trim()).map((run) => [run.text, run.fg] as const))
  assert.deepEqual(
    colors.find(([value]) => value === "!")?.[1],
    theme.warn,
  )
  assert.ok(colors.some(([value, fg]) => value.includes("?") && fg.join(",") === theme.accent.join(",")))
})

test("attention ranks blocking requests before errors and unread replies", () => {
  const ordered = ["permission", "question", "error", "unread"] as const
  const ranks = ordered.map((kind) => ATTENTION_RANK[kind])
  assert.deepEqual(ranks, [...ranks].sort((left, right) => left - right))
  assert.equal(new Set(ranks).size, ordered.length)
})

test("running main sessions paint the context bar in the warn yellow", () => {
  const barColor = (status: "running" | "idle", ctxRatio: number) => {
    const rows = buildRows({ ...view, height: 24, cards: [card({ status, ctxRatio })] })
    const run = rows.flat().find((entry) => entry.text.includes("█"))
    return run?.fg
  }
  // Same yellow as a high-usage subagent bar, whatever the actual usage is.
  assert.deepEqual(barColor("running", 0.2), theme.warn)
  assert.deepEqual(barColor("running", 0.66), theme.warn)
  // Idle cards keep the green/amber/red usage ramp.
  assert.deepEqual(barColor("idle", 0.2), theme.ok)
  assert.deepEqual(barColor("idle", 0.8), theme.warn)
  // Danger still wins over the running yellow.
  assert.deepEqual(barColor("running", 0.95), theme.error)
})

test("empty dashboards explain themselves", () => {
  const rows = buildRows({ ...view, width: 50, height: 6, cards: [], empty: "No open session tabs." })
  assert.match(rows.map((row) => row.map((run) => run.text).join("")).join("\n"), /No open session tabs/)
})

test("the screensaver looks cycle in order and wrap", () => {
  assert.equal(SCREENSAVER_LOOKS.length, 4)
  assert.deepEqual(
    SCREENSAVER_LOOKS.map((look) => look.name),
    ["perlin drift", "falling matrix", "sine sweep", "sparkling sky"],
  )
  assert.equal(saverLookOf(0), SCREENSAVER_LOOKS[0])
  assert.equal(saverLookOf(3), SCREENSAVER_LOOKS[3])
  assert.equal(saverLookOf(4), SCREENSAVER_LOOKS[0])
  assert.equal(saverLookOf(-1), SCREENSAVER_LOOKS[3])
  // Junk from a hand-edited setting must not blank the screensaver.
  assert.equal(saverLookOf(undefined), SCREENSAVER_LOOKS[0])
  assert.equal(saverLookOf(Number.NaN), SCREENSAVER_LOOKS[0])
  assert.equal(saverLookOf(2.6), SCREENSAVER_LOOKS[3])
})

test("the falling matrix look runs green trails downwards", () => {
  const field = createMatrixField()
  const brightestRow = (x: number, seconds: number): number => {
    let best = -1
    let row = -1
    for (let y = 0; y < 140; y++) {
      const green = field.at(x, y, seconds)[1]
      if (green > best) {
        best = green
        row = y
      }
    }
    return row
  }
  // Every colour is green-dominant, and the trail is darker than the head.
  const head = field.at(7, brightestRow(7, 0), 0)
  assert.ok(head[1] > head[0] && head[1] >= head[2], `not green: ${head}`)
  const trail = field.at(7, Math.max(0, brightestRow(7, 0) - 6), 0)
  assert.ok(trail[1] <= head[1], `trail brighter than head: ${trail} vs ${head}`)

  // Heads travel: the brightest row differs between two frames.
  assert.notEqual(brightestRow(7, 0), brightestRow(7, 0.6))
  // Below the stream is black, so the trail is allowed past the grey floor.
  assert.ok(field.floor < SAVER_FLOOR)
})

test("the sine sweep look bands vertically and moves", () => {
  const field = createSweepField()
  const brightness = (y: number, seconds: number) => field.at(12, y, seconds).reduce((sum, channel) => sum + channel, 0)
  const peak = (seconds: number) => {
    let best = -1
    let row = 0
    for (let y = 0; y < 60; y++) {
      const value = brightness(y, seconds)
      if (value > best) {
        best = value
        row = y
      }
    }
    return row
  }
  // A band, not a flat wash: the brightest and darkest rows differ a lot.
  const columns = Array.from({ length: 60 }, (_, y) => brightness(y, 0))
  assert.ok(Math.max(...columns) - Math.min(...columns) > 60)
  // The band travels as time advances.
  assert.notEqual(peak(0), peak(1.3))
  // Colours are truecolor RGB, not quantised to a foreground ANSI palette.
  for (let y = 0; y < 60; y++) {
    for (const channel of field.at(12, y, 0)) assert.ok(channel >= 0 && channel <= 255)
  }
})

test("the sparkling sky twinkles in grayscale and blanks unlit cells", () => {
  const field = createSkyField()
  assert.equal(field.floor, 0)
  let lit = 0
  let blank = 0
  for (let x = 0; x < 60; x++) {
    for (let y = 0; y < 20; y++) {
      const color = field.at(x, y, 1.5)
      assert.equal(color[0], color[1])
      assert.equal(color[1], color[2])
      const glyph = field.glyph?.(x, y, 1.5)
      assert.ok(glyph !== undefined)
      if (glyph === " ") blank++
      else lit++
    }
  }
  assert.ok(lit > 0, "no cell ever lights up")
  assert.ok(blank > 0, "every cell is lit at once")
  // Characters change over time on at least one cell.
  const sample = Array.from({ length: 40 }, (_, x) => field.glyph?.(x, 5, 1.5)).join("")
  const later = Array.from({ length: 40 }, (_, x) => field.glyph?.(x, 5, 3.9)).join("")
  assert.notEqual(sample, later)
})

test("every screensaver look recolours the canvas and names itself", () => {
  SCREENSAVER_LOOKS.forEach((look) => {
    const rows = buildRows({
      ...view,
      width: 60,
      height: 8,
      screensaver: true,
      saverLook: SCREENSAVER_LOOKS.indexOf(look),
      seconds: 2,
      idleMs: 120_000,
      idleLimit: 120_000,
      cards: [card()],
    })
    const header = rows[0].map((run) => run.text).join("")
    assert.match(header, /screensaver/)
    assert.ok(header.includes(look.name), `missing look name in ${header}`)
    for (const row of rows) {
      for (const run of row) {
        for (const channel of run.fg) assert.ok(channel >= 0 && channel <= 255)
      }
    }
  })
})
