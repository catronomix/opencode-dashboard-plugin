/**
 * Pure view-model helpers: formatting and subagent tree flattening.
 */

export function formatTokens(value: number): string {
  const tokens = Math.max(0, Math.round(value))
  if (tokens < 1000) return String(tokens)
  if (tokens < 1_000_000) {
    const scaled = tokens / 1000
    return `${scaled < 10 ? scaled.toFixed(1) : Math.round(scaled)}k`
  }
  const scaled = tokens / 1_000_000
  return `${scaled < 10 ? scaled.toFixed(2) : scaled.toFixed(1)}M`
}

export function formatCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0"
  return value < 0.01 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`
}

export function formatAge(ms: number, now: number): string {
  const elapsed = Math.max(0, now - ms)
  const seconds = Math.floor(elapsed / 1000)
  if (seconds < 5) return "now"
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

/** Truncates to `width` display cells, appending an ellipsis when it cuts. */
export function truncate(text: string, width: number): string {
  if (width <= 0) return ""
  const chars = Array.from(text)
  if (chars.length <= width) return text
  if (width === 1) return "…"
  return `${chars.slice(0, width - 1).join("")}…`
}

export function padEnd(text: string, width: number): string {
  const chars = Array.from(text)
  if (chars.length >= width) return chars.slice(0, width).join("")
  return text + " ".repeat(width - chars.length)
}

/** Full details for one subagent, rendered like the main card body. */
export interface SubVM {
  readonly path: string
  readonly model: string
  readonly agent: string
  readonly ctxLabel: string
  readonly ctxRatio: number | null
  readonly tokensLabel: string
  readonly costLabel: string
  readonly ageLabel: string
}

export interface TreeNode {
  readonly id: string
  readonly title: string
  readonly detail: string
  readonly status: "running" | "idle"
  readonly children: readonly TreeNode[]
  readonly sub?: SubVM
}

export interface TreeLine {
  readonly id: string
  readonly connector: string
  readonly title: string
  readonly detail: string
  readonly status: "running" | "idle"
  /** Detail block contents; drawn when the dashboard has details expanded. */
  readonly sub?: SubVM
  // The keyboard selection rests on this subagent row.
  readonly selected?: boolean
  /**
   * Per-row expand override for this subagent's detail block: space toggles one
   * row without touching the global setting. Undefined follows the global flag.
   */
  readonly expanded?: boolean
}

/** Flattens a subagent tree into indented lines with box-drawing connectors. */
export function flattenTree(nodes: readonly TreeNode[], depth = 0, prefix = ""): TreeLine[] {
  const lines: TreeLine[] = []
  nodes.forEach((node, index) => {
    const last = index === nodes.length - 1
    const connector = depth === 0 ? (last ? "└─ " : "├─ ") : `${prefix}${last ? "└─ " : "├─ "}`
    lines.push({
      id: node.id,
      connector,
      title: node.title,
      detail: node.detail,
      status: node.status,
      sub: node.sub,
    })
    const childPrefix = depth === 0 ? (last ? "   " : "│  ") : `${prefix}${last ? "   " : "│  "}`
    if (node.children.length) lines.push(...flattenTree(node.children, depth + 1, childPrefix))
  })
  return lines
}
