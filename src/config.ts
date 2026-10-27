/**
 * User settings, read from a JSON file next to the OpenCode config.
 *
 * A missing or broken file must never break the dashboard, so every value is
 * clamped and every failure falls back to the defaults. The file is written
 * with the defaults on first run so it is discoverable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const MIN_WIDTH = 40
export const MAX_WIDTH = 100
export const DEFAULT_WIDTH = 45

export const MIN_SAVER_SECONDS = 10
export const MAX_SAVER_SECONDS = 3600
export const DEFAULT_SAVER_SECONDS = 120

export interface DashboardConfig {
  /** Default card width in columns, clamped to MIN_WIDTH..MAX_WIDTH. */
  readonly width: number
  /** Idle time before the screensaver starts, in seconds. */
  readonly screensaverSeconds: number
}

export const DEFAULT_CONFIG: DashboardConfig = {
  width: DEFAULT_WIDTH,
  screensaverSeconds: DEFAULT_SAVER_SECONDS,
}

const FILE_NAME = "session-dashboard.json"

/** `~/.config/opencode/session-dashboard.json`, or under the config dir override. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const configDir = env.OPENCODE_CONFIG_DIR?.trim()
  if (configDir) return join(configDir, FILE_NAME)
  return join(homedir(), ".config", "opencode", FILE_NAME)
}

const integer = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value)
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return Math.round(parsed)
  }
  return undefined
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Total: any input, including junk, yields a valid config. */
export function parseConfig(raw: unknown): DashboardConfig {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  // Accept a couple of spellings so a hand-edited file is forgiving.
  const width = integer(source.width ?? source.cardWidth)
  const seconds = integer(source.screensaverSeconds ?? source.screensaver_seconds ?? source.saverSeconds)
  return {
    width: clamp(width ?? DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH),
    screensaverSeconds: clamp(seconds ?? DEFAULT_SAVER_SECONDS, MIN_SAVER_SECONDS, MAX_SAVER_SECONDS),
  }
}

/**
 * Loads the settings file, creating it with the defaults when absent. Errors
 * (unreadable directory, bad JSON) fall back to the defaults silently; the
 * caller can log the returned `error`.
 */
export function loadConfig(onError?: (message: string) => void): DashboardConfig {
  const path = configPath()
  try {
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8")
      return DEFAULT_CONFIG
    }
    return parseConfig(JSON.parse(readFileSync(path, "utf8")))
  } catch (error) {
    onError?.(`config ${path}: ${error instanceof Error ? error.message : String(error)}`)
    return DEFAULT_CONFIG
  }
}
