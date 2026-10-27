/**
 * Copies the plugin sources into the local OpenCode plugin directory.
 *
 * The installed copy is source-only: OpenCode resolves `@opencode/plugin`,
 * `@opentui/*` and `solid-js` from its own runtime, so no node_modules are
 * needed (and a local copy would shadow the host instances).
 */
import { copyFile, mkdir, readdir, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)))
const source = join(root, "src")
const target = join(homedir(), ".config", "opencode", "plugins", "session-dashboard")

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })

const entries = await readdir(source)
let copied = 0
for (const entry of entries) {
  if (!/\.(ts|tsx)$/.test(entry)) continue
  await copyFile(join(source, entry), join(target, entry))
  copied++
}

console.log(`deployed ${copied} source file(s) to ${target}`)
