import { Plugin } from "@opencode/plugin"

/**
 * Server-side half of the dashboard plugin.
 *
 * The dashboard is a TUI-only feature; this entry exists so the package can be
 * loaded as an ordinary plugin while `./tui` supplies the terminal UI.
 */
export default Plugin.define({
  id: "session-dashboard",
  setup() {},
})
