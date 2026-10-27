import { buildRows, type CardVM, type Palette } from "../src/render.ts"
import { palette as theme } from "../src/palette.ts"

const card = (index: number): CardVM => ({
  id: `s${index}`,
  title: `Session ${index}`,
  path: "C:\\github\\opencode-session-dashboard",
  model: "openai/gpt-5",
  agent: "build",
  status: index % 3 === 0 ? "running" : "idle",
  active: index === 0,
  ctxLabel: "12.3k of 200k",
  ctxRatio: 0.42,
  tokensLabel: "123k in / 45k out",
  costLabel: "$1.23",
  ageLabel: "4m ago",
  tree: [
    { connector: "├─ ", title: "explore", detail: "running", status: "running" },
    { connector: "└─ ", title: "reviewer", detail: "done", status: "idle" },
  ],
})

const width = Number(process.argv[2] ?? 220)
const height = Number(process.argv[3] ?? 55)
const screensaver = process.argv[4] !== "off"

const cards = Array.from({ length: 8 }, (_, index) => card(index))
const vm = {
  width,
  height,
  offsetX: 0,
  offsetY: 0,
  screensaver,
  seconds: 12.5,
  idleMs: 600_000,
  idleLimit: 300_000,
  cards,
  palette: {} as Palette,
  sourceLabel: "source: tabs",
  empty: "",
}

const themePalette: Palette = {
  text: theme(0.55),
  muted: theme(0.6),
  faint: theme(0.65),
  background: [20, 20, 20],
  border: [90, 90, 90],
  accent: [120, 170, 255],
  ok: [110, 200, 120],
  warn: [230, 190, 100],
  error: [230, 120, 120],
}
vm.palette = themePalette

const started = performance.now()
let rows = buildRows(vm)
const buildMs = performance.now() - started
let runs = 0
for (const row of rows) runs += row.length

// second frame (animation) to see whether frames differ a lot
vm.seconds += 0.09
rows = buildRows(vm)
let runs2 = 0
for (const row of rows) runs2 += row.length

console.log({ width, height, screensaver, buildMs: Math.round(buildMs * 100) / 100, runs, runs2, cells: width * height })
