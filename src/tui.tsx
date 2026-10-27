import { RGBA, StyledText, TextAttributes, type TextRenderable } from "@opentui/core"
import { Plugin } from "@opencode/plugin/tui"
import type { Context, Route } from "@opencode/plugin/tui/context"
import { appendFileSync } from "node:fs"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"

import { buildRows, cardHeight, cardLeft, cardWidths, clampOffsets, HEADER_ROWS, type CardVM, type Layout, type Palette, type Row } from "./render.ts"
import { flattenTree, formatAge, formatCost, formatTokens, type SubVM, type TreeNode } from "./view.ts"
import { loadConfig } from "./config.ts"
import type { RGB } from "./palette.ts"

const PAGE = "session-dashboard"
const BLOCK_BG = "#000000"
const DEBUG_FILE = `${process.env.TEMP ?? process.env.TMPDIR ?? "."}/session-dashboard-debug.log`

// Frame timing goes to a file because the TUI side of a plugin has no console.
let debugOn = true
function debug(message: string) {
  if (!debugOn) return
  try {
    appendFileSync(DEBUG_FILE, `${new Date().toISOString()} ${message}\n`)
  } catch {
    debugOn = false
  }
}

// Route data comes from the host: proxies, cycles and BigInts are all possible.
// A debug line must never be able to throw inside render, so serialisation is
// always total.
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    try {
      return String(value)
    } catch {
      return "[unserializable]"
    }
  }
}

type Fill = { used: number; at: number }
type MessageLike = {
  type?: string
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  }
}

// Theme tokens may hand us 0-1 floats, 0-255 ints or strings; anything
// unusable falls back to a sane default so text never renders invisible.
function channel(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  const scaled = value <= 1 ? value * 255 : value
  return Math.max(0, Math.min(255, Math.round(scaled)))
}

const rgb = (color: unknown, fallback: RGB): RGB => {
  if (!color || typeof color !== "object") return fallback
  const source = color as { r?: unknown; g?: unknown; b?: unknown }
  const r = channel(source.r)
  const g = channel(source.g)
  const b = channel(source.b)
  if (r === undefined || g === undefined || b === undefined) return fallback
  return [r, g, b]
}
export default Plugin.define({
  id: "session-dashboard.tui",
  async setup(context) {
    const unregister = context.ui.router.register({
      name: PAGE,
      render: ({ data }) => {
        try {
          debug(`render page data=${safeJson(data)}`)
          const back = (data?.previous as Route | undefined) ?? ({ type: "home" } as Route)
          // The tab the user was looking at when the dashboard opened. Closing
          // returns there instead of the new-chat home page.
          const previousTab = typeof data?.previousTab === "string" ? data.previousTab : undefined
          const close = (destination?: Route) => {
            const fallback: Route =
              previousTab && context.data.session.get(previousTab)
                ? { type: "session", sessionID: previousTab }
                : back
            const target = destination ?? fallback
            debug(`navigate back to ${safeJson(target)}`)
            context.ui.router.navigate(target)
            // Safety net: never leave the user trapped on a blank page.
            setTimeout(() => {
              const now = context.ui.router.current()
              debug(`route after close=${safeJson(now)}`)
              if (now.type === "plugin" && now.name === PAGE) context.ui.router.navigate({ type: "home" })
            }, 250)
          }
          return <Dashboard context={context} close={close} initialTab={previousTab} />
        } catch (error) {
          // A throwing render leaves an empty page and a toast with no detail.
          // Draw the failure instead, so it is visible and in the debug log.
          const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
          const stack = error instanceof Error ? (error.stack ?? message) : message
          debug(`render failed: ${stack}`)
          console.error("session-dashboard: render failed", error)
          return (
            <box width="100%" height="100%" flexDirection="column" backgroundColor="#000000" padding={1}>
              <text content={`SESSION DASHBOARD ERROR  ${message}`} fg="#ff5555" wrapMode="word" />
              <text content={stack} fg="#aa8888" wrapMode="word" />
            </box>
          )
        }
      },
    })

    function open() {
      const current = context.ui.router.current()
      if (current.type === "plugin" && current.name === PAGE) return
      debug(`open from ${JSON.stringify(current)}`)
      // The route carries its own return destination, so a plugin reload while
      // the dashboard is open cannot lose the place the user came from. The
      // active tab rides along because closing must return to a session page,
      // never to the new-chat home route.
      const tabs = context.ui.tabs.enabled() ? context.ui.tabs.list() : []
      const previousTab = tabs.find((tab) => tab.active)?.sessionID
      context.ui.router.navigate({ type: "plugin", name: PAGE, data: { previous: current, previousTab } })
    }

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "session-dashboard.open",
          title: "Session dashboard",
          description: "Fullscreen dashboard of open tabs, subagents and context use",
          group: "Dashboard",
          bind: "ctrl+shift+d,alt+d",
          palette: true,
          slash: { name: "dash", aliases: ["dashboard"] },
          suggested: true,
          run: () => open(),
        },
      ],
    }))

    console.error("session-dashboard: ready (ctrl+shift+d, alt+d or /dash)")

    return () => {
      unregister()
    }
  },
})

interface DashboardProps {
  readonly context: Context
  readonly close: (destination?: Route) => void
  /** Session of the tab that was active when the dashboard opened. */
  readonly initialTab?: string
}

function Dashboard(props: DashboardProps) {
  const context = props.context
  // Settings live in `session-dashboard.json` next to the OpenCode config:
  // default card width (clamped 40..100) and the screensaver delay.
  const config = loadConfig((message) => debug(message))
  const limitMs = config.screensaverSeconds * 1000
  const [size, setSize] = createSignal({
    width: Math.max(1, context.renderer.width),
    height: Math.max(1, context.renderer.height),
  })
  const [offset, setOffset] = createSignal({ x: 0, y: 0 })
  const [includeActive, setIncludeActive] = createSignal(false)
  const [lastInput, setLastInput] = createSignal(Date.now())
  const [now, setNow] = createSignal(Date.now())
  const [fills, setFills] = createSignal<Record<string, Fill>>({})
  // Durable view settings: screensaver on/off, subagent details expanded, and
  // the `D`ynamic card widths.
  const [settings, updateSettings] = context.storage.store("session-dashboard", {
    initial: { saver: true, expanded: true, dynamic: false },
  })
  // Selection: a card, or one of its subagent rows (row === -1 = the card).
  const [selection, setSelection] = createSignal<{ card: number; row: number }>({ card: 0, row: -1 })
  // Per-subagent expand overrides: space toggles one row, `f` clears them all.
  const [overrides, setOverrides] = createSignal<Record<string, boolean>>({})

  // The page container sizes itself to its content, so measuring the box gave
  // 1x1 while the content text was still empty (black screen). The renderer
  // knows the real terminal size; follow its resize event instead.
  const onResize = (width: number, height: number) => {
    const next = { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) }
    debug(`resize ${next.width}x${next.height}`)
    setSize((previous) => (previous.width === next.width && previous.height === next.height ? previous : next))
  }
  context.renderer.on("resize", onResize)
  onCleanup(() => context.renderer.off("resize", onResize))

  const idleMs = () => Math.max(0, now() - lastInput())
  const screensaver = () => settings.saver && idleMs() >= limitMs

  // Animation clock: fast while the screensaver runs, relaxed otherwise.
  let timer: ReturnType<typeof setTimeout> | undefined
  let ticks = 0
  let wasSaver = false
  const schedule = () => {
    timer = setTimeout(() => {
      setNow(Date.now())
      ticks++
      if (screensaver() !== wasSaver) {
        wasSaver = screensaver()
        debug(`screensaver -> ${wasSaver} (idle ${idleMs()}ms, size ${size().width}x${size().height})`)
      }
      if (ticks % 60 === 1) debug(`tick #${ticks} saver=${screensaver()} idle=${idleMs()}ms`)
      schedule()
    }, screensaver() ? 130 : 1000)
  }
  schedule()
  onCleanup(() => clearTimeout(timer))

  const palette = createMemo<Palette>(() => {
    const theme = context.theme
    return {
      text: rgb(theme.text.base, [220, 220, 220]),
      muted: rgb(theme.text.muted, [160, 160, 160]),
      faint: rgb(theme.text.faint, [110, 110, 110]),
      background: rgb(theme.background.base, [20, 20, 20]),
      border: rgb(theme.border.base, [90, 90, 90]),
      accent: rgb(theme.text.action.primary.base, [120, 170, 255]),
      ok: rgb(theme.text.feedback.success.base, [110, 200, 120]),
      warn: rgb(theme.text.feedback.warning.base, [230, 190, 100]),
      error: rgb(theme.text.feedback.error.base, [230, 120, 120]),
    }
  })

  // Model context windows, keyed by provider/model.
  let limits = new Map<string, number>()
  const location = context.location ?? context.data.location.default()
  void (async () => {
    try {
      await context.data.location.model.sync(location)
      const models = context.data.location.model.list(location) ?? []
      for (const model of models) {
        if (!model.limit?.context) continue
        limits.set(`${model.providerID}/${model.modelID}`, model.limit.context)
        if (model.id) limits.set(`${model.providerID}/${model.id}`, model.limit.context)
      }
    } catch (error) {
      console.error("session-dashboard: could not read model limits", error)
    }
  })()

  const limitFor = (model: { providerID?: string; id?: string } | undefined): number | undefined => {
    if (!model?.providerID || !model.id) return undefined
    return limits.get(`${model.providerID}/${model.id}`)
  }

  const syncing = new Set<string>()
  function syncFill(sessionID: string, updated: number) {
    const cached = fills()[sessionID]
    if (cached && cached.at >= updated) return
    if (syncing.has(sessionID)) return
    syncing.add(sessionID)
    void (async () => {
      try {
        await context.data.session.message.sync(sessionID)
        const messages = context.data.session.message.list(sessionID) as unknown as MessageLike[]
        for (let index = messages.length - 1; index >= 0; index--) {
          const message = messages[index]
          if (message?.type !== "assistant" || !message.tokens) continue
          const tokens = message.tokens
          const used =
            (tokens.input ?? 0) +
            (tokens.cache?.read ?? 0) +
            (tokens.cache?.write ?? 0) +
            (tokens.output ?? 0)
          if (used > 0) setFills((previous) => ({ ...previous, [sessionID]: { used, at: updated } }))
          break
        }
      } catch (error) {
        console.error(`session-dashboard: could not read messages for ${sessionID}`, error)
      } finally {
        syncing.delete(sessionID)
      }
    })()
  }

  // The detail block shared by main cards and subagents: same fields, same order.
  const detailsFor = (sessionID: string, session: ReturnType<typeof context.data.session.get>): SubVM => {
    const fill = fills()[sessionID]
    const limit = limitFor(session?.model)
    const ratio = fill && limit ? Math.min(1, fill.used / limit) : null
    const tokens = session
      ? session.tokens.input +
        session.tokens.output +
        session.tokens.reasoning +
        session.tokens.cache.read +
        session.tokens.cache.write
      : 0
    const cache = session ? session.tokens.cache.read + session.tokens.cache.write : 0
    return {
      path: session?.location?.directory ? context.ui.format.path(session.location.directory) : "unknown workspace",
      model: session?.model?.id ?? "",
      agent: session?.agent ?? "",
      ctxLabel: fill && limit ? `${formatTokens(fill.used)}/${formatTokens(limit)}` : fill ? formatTokens(fill.used) : "—",
      ctxRatio: ratio,
      tokensLabel: `${formatTokens(tokens)}${cache ? ` · ${formatTokens(cache)} cache` : ""}`,
      costLabel: formatCost(session?.cost ?? 0),
      ageLabel: formatAge(session?.time.updated ?? 0, now()),
    }
  }

  const cards = createMemo<CardVM[]>(() => {
    const tabs = context.ui.tabs.enabled() ? context.ui.tabs.list() : []
    const sessions = context.data.session.list()
    const byID = new Map(sessions.map((session) => [session.id, session]))
    const childrenOf = new Map<string, string[]>()
    for (const session of sessions) {
      if (!session.parentID) continue
      const list = childrenOf.get(session.parentID)
      if (list) list.push(session.id)
      else childrenOf.set(session.parentID, [session.id])
    }

    const roots: Array<{ id: string; tab?: (typeof tabs)[number] }> = tabs.map((tab) => ({
      id: tab.sessionID,
      tab,
    }))
    const seen = new Set(roots.map((root) => root.id))

    if (includeActive() || !tabs.length) {
      const extras = sessions
        .filter((session) => !seen.has(session.id) && !session.parentID)
        .filter((session) => context.data.session.status(session.id) === "running")
        .sort((left, right) => right.time.updated - left.time.updated)
        .slice(0, 12)
      for (const session of extras) roots.push({ id: session.id })
    }

    const buildTree = (sessionID: string, depth: number): TreeNode[] => {
      const children = childrenOf.get(sessionID) ?? []
      return children.map((childID) => {
        const child = byID.get(childID)
        const details = detailsFor(childID, child)
        const status = context.data.session.status(childID) === "running" ? "running" : "idle"
        const detail = [
          status,
          details.ctxRatio !== null ? `${Math.round(details.ctxRatio * 100)}%` : undefined,
          cardTokens(childID) ? formatTokens(cardTokens(childID)) : undefined,
        ]
          .filter(Boolean)
          .join(" · ")
        return {
          id: childID,
          title: child?.title ?? childID.slice(4, 12),
          detail,
          status,
          sub: details,
          children: depth < 3 ? buildTree(childID, depth + 1) : [],
        }
      })
    }

    const { card: selectedCard, row: selectedRow } = selection()
    const rowOverrides = overrides()

    return roots.map(({ id, tab }, index) => {
      const session = byID.get(id)
      const details = detailsFor(id, session)
      const tree = flattenTree(buildTree(id, 0)).map((line, row) => ({
        ...line,
        expanded: rowOverrides[line.id] ?? settings.expanded,
        selected: selectedCard === index && selectedRow === row,
      }))
      return {
        id,
        title: session?.title ?? tab?.title ?? id.slice(4, 12),
        path: details.path,
        model: details.model,
        agent: details.agent,
        status: tab ? (tab.busy ? "running" : context.data.session.status(id)) : context.data.session.status(id),
        active: tab?.active ?? false,
        unread: tab?.unread,
        ctxLabel: details.ctxLabel,
        ctxRatio: details.ctxRatio,
        tokensLabel: details.tokensLabel,
        costLabel: details.costLabel,
        ageLabel: details.ageLabel,
        selected: selectedCard === index,
        tree,
      } satisfies CardVM
    })
  })

  function cardTokens(sessionID: string): number {
    const session = context.data.session.get(sessionID)
    if (!session) return 0
    return (
      session.tokens.input +
      session.tokens.output +
      session.tokens.reasoning +
      session.tokens.cache.read +
      session.tokens.cache.write
    )
  }

  // Load context windows for the sessions on screen (and their subagents)
  // whenever the card set changes.
  createEffect(() => {
    for (const card of cards()) {
      try {
        const family = context.data.session.family(card.id)
        for (const sessionID of family.length ? family : [card.id]) {
          const session = context.data.session.get(sessionID)
          syncFill(sessionID, session?.time.updated ?? 0)
        }
      } catch (error) {
        console.error(`session-dashboard: could not load session family for ${card.id}`, error)
      }
    }
  })

  // Keep the selection inside the card/row set as tabs come and go.
  createEffect(() => {
    const list = cards()
    const current = selection()
    if (!list.length) {
      if (current.card !== 0 || current.row !== -1) setSelection({ card: 0, row: -1 })
      return
    }
    const card = Math.max(0, Math.min(current.card, list.length - 1))
    const row = Math.max(-1, Math.min(current.row, list[card].tree.length - 1))
    if (card !== current.card || row !== current.row) setSelection({ card, row })
  })

  const sourceLabel = createMemo(() => {
    if (!context.ui.tabs.enabled()) return "active sessions"
    return includeActive() ? "tabs + active" : "tabs"
  })

  // Card sizing: the settings-file default, optionally emphasised around the
  // selection with `D`ynamic widths.
  const layout = createMemo<Layout>(() => ({
    base: config.width,
    dynamic: Boolean(settings.dynamic),
    selected: selection().card,
    expanded: settings.expanded,
  }))

  const rows = createMemo<Row[]>(() => {
    const current = size()
    const scroll = offset()
    const clamped = clampOffsets(cards(), current.width, current.height, scroll.x, scroll.y, layout())
    return buildRows({
      width: Math.max(1, current.width),
      height: Math.max(1, current.height),
      offsetX: clamped.offsetX,
      offsetY: clamped.offsetY,
      screensaver: screensaver(),
      saverEnabled: settings.saver,
      expanded: settings.expanded,
      cardWidth: config.width,
      dynamic: Boolean(settings.dynamic),
      selectedIndex: selection().card,
      seconds: now() / 1000,
      idleMs: idleMs(),
      idleLimit: limitMs,
      cards: cards(),
      palette: palette(),
      sourceLabel: sourceLabel(),
      empty: "No open session tabs. Press a to include every running session.",
    })
  })

  const content = createMemo(() => toStyledText(rows()))
  // The reconciled `content` prop must stay non-empty: it is what creates the
  // text buffer the renderer paints from. The coloured StyledText is written on
  // top of it below, so this mirror only ever shows if that write fails.
  const plainText = createMemo(() => rows().map((row) => row.map((run) => run.text).join("")).join("\n"))
  const background = createMemo(() => (screensaver() ? BLOCK_BG : rgbaToHex(palette().background)))

  // The JSX `content` prop is stringified by the reconciler, so the composed
  // StyledText is assigned straight onto the renderable instead. The write is
  // deferred so the node is attached to the native scene first.
  const [textNode, setTextNode] = createSignal<TextRenderable | undefined>(undefined)
  const applyContent = (node: TextRenderable, value: StyledText) => {
    const started = performance.now()
    try {
      node.content = value
      frames++
      const elapsed = performance.now() - started
      const readBack = node.chunks?.length ?? -1
      if (frames === 1) {
        debug(`theme text.base=${JSON.stringify(context.theme.text.base)} bg.base=${JSON.stringify(context.theme.background.base)}`)
        debug(`resolved palette=${JSON.stringify(palette())}`)
        const sample = value.chunks.slice(0, 4).map((chunk) => [
          String(chunk.text ?? "").slice(0, 6),
          chunk.fg && typeof chunk.fg.toInts === "function" ? chunk.fg.toInts() : String(chunk.fg),
        ])
        debug(`first chunks=${JSON.stringify(sample)} nodeFg=${JSON.stringify(node.fg?.toInts?.() ?? node.fg)}`)
      }
      if (frames === 1 || frames % 20 === 1 || elapsed > 30) {
        debug(
          `paint #${frames} ${elapsed.toFixed(1)}ms chunks=${value.chunks.length} readBack=${readBack} saver=${screensaver()} ` +
            `size=${size().width}x${size().height} node=${node.x},${node.y},${node.width}x${node.height} ` +
            `vis=${node.visible} parent=${node.parent?.id ?? "none"} bg=${background()}`,
        )
      }
    } catch (error) {
      debug(`paint failed: ${error instanceof Error ? error.message : String(error)}`)
      console.error("session-dashboard: could not paint the dashboard", error)
    }
  }
  let frames = 0
  createEffect(() => {
    const value = content()
    const node = textNode()
    if (!node) return
    queueMicrotask(() => applyContent(node, value))
  })

  const touch = () => setLastInput(Date.now())

  const scroll = (dx: number, dy: number) => {
    touch()
    setOffset((previous) => {
      const current = size()
      const next = clampOffsets(
        cards(),
        current.width,
        current.height,
        previous.x + dx,
        previous.y + dy,
        layout(),
      )
      return { x: next.offsetX, y: next.offsetY }
    })
  }

  const page = () => Math.max(3, size().height - HEADER_ROWS - 1)

  const finish = () => {
    debug(`close requested (saver=${screensaver()})`)
    touch()
    props.close()
  }

  // While the screensaver runs, a key wakes the dashboard and is not passed on.
  const wake = (action?: () => void) => {
    if (screensaver()) {
      debug(`wake`)
      touch()
      return
    }
    action?.()
  }

  // Scrolls just enough that the selected card is on screen.
  const reveal = (cardIndex: number) => {
    const list = cards()
    const card = list[cardIndex]
    if (!card) return
    const current = size()
    const viewport = Math.max(1, current.height - HEADER_ROWS)
    const height = cardHeight(card, settings.expanded)
    const widths = cardWidths(list.length, { ...layout(), selected: cardIndex })
    const width = widths[cardIndex] ?? config.width
    const left = cardLeft(widths, cardIndex)
    setOffset((previous) => {
      let offsetX = previous.x
      let offsetY = previous.y
      if (left - offsetX < 1) offsetX = Math.max(0, left - 1)
      if (left + width - offsetX > current.width) offsetX = left + width - current.width
      // Cards are laid out side by side, so a card that fits simply starts at
      // the top; a taller one keeps whatever vertical scroll it had.
      if (height <= viewport) offsetY = 0
      const next = clampOffsets(list, current.width, current.height, offsetX, offsetY, {
        ...layout(),
        selected: cardIndex,
      })
      return { x: next.offsetX, y: next.offsetY }
    })
  }

  // Open on the tab the user came from, not always the leftmost card.
  let preselected = false
  createEffect(() => {
    const list = cards()
    if (preselected || !list.length) return
    preselected = true
    const index = props.initialTab ? list.findIndex((card) => card.id === props.initialTab) : -1
    if (index <= 0) return
    debug(`preselect card ${index} for ${props.initialTab}`)
    setSelection({ card: index, row: -1 })
    reveal(index)
  })

  const moveCard = (delta: number) => {
    touch()
    const list = cards()
    if (!list.length) return
    const card = Math.max(0, Math.min(list.length - 1, selection().card + delta))
    setSelection({ card, row: -1 })
    reveal(card)
  }

  const moveRow = (delta: number) => {
    touch()
    const list = cards()
    if (!list.length) return
    let { card, row } = selection()
    if (delta < 0) {
      if (row > -1) row -= 1
      else if (card > 0) {
        card -= 1
        row = Math.max(-1, list[card].tree.length - 1)
      }
    } else {
      if (row < list[card].tree.length - 1) row += 1
      else if (card < list.length - 1) {
        card += 1
        row = -1
      }
    }
    setSelection({ card, row })
    reveal(card)
  }

  const openSelected = () => {
    const list = cards()
    const { card, row } = selection()
    const entry = list[card]
    if (!entry) return
    const sessionID = row >= 0 ? entry.tree[row]?.id : entry.id
    if (!sessionID) return
    touch()
    debug(`open session ${sessionID} (card=${card} row=${row})`)
    props.close({ type: "session", sessionID })
  }

  // Space expands/collapses the selection: one subagent row, or every row of
  // the card when the card itself is selected. `f` is still the global fold.
  const toggleSelectedDetails = () => {
    touch()
    const list = cards()
    const { card, row } = selection()
    const entry = list[card]
    if (!entry) return
    const line = row >= 0 ? entry.tree[row] : undefined
    if (!line) {
      debug(`toggle all details (card=${card})`)
      void updateSettings((draft) => {
        draft.expanded = !draft.expanded
      })
      setOverrides({})
      return
    }
    const current = overrides()[line.id] ?? settings.expanded
    debug(`toggle details for ${line.id} -> ${!current}`)
    setOverrides((previous) => ({ ...previous, [line.id]: !current }))
  }

  context.keymap.layer(() => ({
    mode: "global",
    priority: 100,
    commands: [
      { id: "session-dashboard.close.escape", bind: "escape,q", run: () => wake(finish) },
      { id: "session-dashboard.card.prev", bind: "left", run: () => wake(() => moveCard(-1)) },
      { id: "session-dashboard.card.next", bind: "right", run: () => wake(() => moveCard(1)) },
      { id: "session-dashboard.row.prev", bind: "up", run: () => wake(() => moveRow(-1)) },
      { id: "session-dashboard.row.next", bind: "down", run: () => wake(() => moveRow(1)) },
      { id: "session-dashboard.open", bind: "return,enter", run: () => wake(openSelected) },
      { id: "session-dashboard.expand", bind: "space", run: () => wake(toggleSelectedDetails) },
      { id: "session-dashboard.pageup", bind: "pageup", run: () => wake(() => scroll(0, -page())) },
      { id: "session-dashboard.pagedown", bind: "pagedown", run: () => wake(() => scroll(0, page())) },
      { id: "session-dashboard.top", bind: "g", run: () => wake(() => scroll(-1_000_000, -1_000_000)) },
      { id: "session-dashboard.bottom", bind: "shift+g", run: () => wake(() => scroll(1_000_000, 1_000_000)) },
      {
        id: "session-dashboard.toggle-active",
        bind: "a",
        run: () =>
          wake(() => {
            touch()
            setIncludeActive((value) => !value)
          }),
      },
      {
        // Fold/expand every subagent detail block; the choice is persisted.
        id: "session-dashboard.toggle-details",
        bind: "f",
        run: () =>
          wake(() => {
            touch()
            void updateSettings((draft) => {
              draft.expanded = !draft.expanded
            })
            setOverrides({})
          }),
      },
      {
        // `D`ynamic widths: the selected card gains 20%, the rest lose 25%.
        id: "session-dashboard.toggle-dynamic",
        bind: "d",
        run: () =>
          wake(() => {
            touch()
            void updateSettings((draft) => {
              draft.dynamic = !draft.dynamic
            })
          }),
      },
      {
        // Enables/disables the screensaver, persisted across restarts. Pressing
        // it while the screensaver is on also wakes the dashboard; turning it
        // back on starts the screensaver immediately instead of waiting out the
        // idle delay.
        id: "session-dashboard.toggle-saver",
        bind: "s",
        run: () => {
          if (settings.saver) touch()
          else {
            // Re-enabling shows the screensaver at once: backdate the last
            // input past the idle limit and repaint on this tick.
            setLastInput(Date.now() - limitMs)
            setNow(Date.now())
            debug(`screensaver enabled -> on (limit ${limitMs}ms)`)
          }
          void updateSettings((draft) => {
            draft.saver = !draft.saver
          })
        },
      },
    ],
  }))

  return (
    <box
      width={size().width}
      height={size().height}
      flexDirection="column"
      backgroundColor={background()}
    >
      <text
        ref={(node: TextRenderable) => setTextNode(node)}
        content={plainText()}
        wrapMode="none"
        width={size().width}
        height={size().height}
      />
    </box>
  )
}

const rgbaCache = new Map<string, RGBA>()

function rgbaFor(color: RGB): RGBA {
  const key = `${color[0]},${color[1]},${color[2]}`
  const cached = rgbaCache.get(key)
  if (cached) return cached
  const created = RGBA.fromInts(color[0], color[1], color[2])
  if (rgbaCache.size > 8192) rgbaCache.clear()
  rgbaCache.set(key, created)
  return created
}

function rgbaToHex(color: RGB): string {
  return `#${color.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`
}

function toStyledText(rows: readonly Row[]): StyledText {
  const chunks: Array<{ __isChunk: true; text: string; fg?: RGBA; attributes?: number }> = []
  rows.forEach((row, index) => {
    if (index > 0) chunks.push({ __isChunk: true, text: "\n" })
    for (const run of row) {
      if (!run.text) continue
      chunks.push({
        __isChunk: true,
        text: run.text,
        fg: rgbaFor(run.fg),
        ...(run.bold ? { attributes: TextAttributes.BOLD } : {}),
      })
    }
  })
  return new StyledText(chunks)
}
