# opencode-session-dashboard

A fullscreen TUI plugin for [OpenCode](https://opencode.ai)

```
Do you ever feel like you are staring at the prompt input box a bit too much, 
flicking trough tabs to see what your agents are doing?
 
Then this plugin is for you! 
OpenCode Dashboard is a fullscreen overlay that shows all open/active sessions, 
listing statistics for all your agents in one overview. See the session title, 
location, model, context fill, token hits and spenditure of each agent, 
including subagents - nesting supported!
 
Maybe that's still TMI for you? No worries! 
The f key quickly folds all subagents in single lines. 
 
Things can be pretty boring after a few minutes of staring at your 
swarm crawls trough your precious token budget. But no more: when idle, 
you will get treated to a groovy perlin noise animation.
This plugin is entirely created and maintained with OpenCode, 
prompted with love.
```

<img width="1844" height="682" alt="image" src="https://github.com/user-attachments/assets/5b1553f5-a112-48c8-a336-a9340a6465e0" />

> **AI-generated.** This plugin was written almost entirely by an AI coding
> agent (working under human direction and review). Treat it as such: read the
> source before relying on it, and expect rough edges. Issues and pull requests
> are welcome.

---

## Features

- **Session cards** — one card per open tab: title, working directory, agent and
  model, a context-window bar, token totals, cost and age. The card whose tab is
  focused is marked `· focused`; running sessions get a green header dot.
- **Subagent tree** — child sessions are listed under their parent with a status
  and their current activity. Each subagent has an expandable detail block
  (path, agent · model, context bar, tokens, cost · age).
- **Keyboard selection** — move across cards with `←`/`→`, down into the tree
  with `↑`/`↓`, and open the selected session in the main TUI with `enter`.
- **Screensaver** — after two minutes of no input (configurable) the dashboard
  fades to a black background and the whole canvas is recoloured as an
  animation. Four looks ship in truecolor: **perlin drift** (the original
  groovy noise palette), **falling matrix** (green digital rain with a
  white-green head and a decaying trail), **sine sweep** (a soft band of
  drifting hue that travels down the screen) and **sparkling sky** (random
  grayscale characters fading gently in and out of the empty cells). `←`/`→`
  (or `↑`/`↓`) cycle the looks without waking the screensaver; any other key
  wakes it without leaking into the UI behind.
- **Mouse** — hovering a column selects it (the highlight and `D`ynamic widths
  follow the pointer), clicking a session card opens it, clicking a subagent
  header row folds or unfolds it, clicking a subagent's detail block opens that
  subagent, and the wheel scrolls the view.
- **`D`ynamic widths** — the selected card grows to 120% of the default width
  while every other card shrinks to 75%.
- **Returns you where you were** — opening focuses the card for the tab you came
  from, and closing re-opens that tab instead of dumping you on a new chat.
- **Persisted preferences** — screensaver on/off and its current look, dynamic
  widths and the global fold state are stored across restarts via the plugin
  storage API.

## Keys

| Key | Action |
| --- | --- |
| `ctrl+shift+d` / `alt+d` | Open the dashboard |
| `esc` / `q` | Close (back to the previous tab) |
| `←` / `→` | Previous / next session card (while the screensaver runs: previous / next look) |
| `↑` / `↓` | Step from card into subagent rows and back (while the screensaver runs: previous / next look) |
| `enter` / `return` | Open the selected session (card or subagent) and exit |
| `space` | Expand/collapse the selection (one subagent row, or all rows of a selected card) |
| `f` | Fold/expand all subagent details (persisted, clears per-row overrides) |
| `d` | `D`ynamic widths: emphasise the selected card, slim the others |
| `a` | Show active sessions only |
| `s` | Toggle the screensaver on/off (persisted; re-enabling shows it at once) |
| `PgUp` / `PgDn` | Scroll a page |
| `g` / `G` | Jump to top / bottom |

### Mouse

| Action | Result |
| --- | --- |
| Hover a card | Select that column (highlight follows the pointer; the row resets to the card) |
| Hover a subagent row | Select that row as well as its column |
| Click a session card | Open that session (same as `enter` on the card) |
| Click a subagent header row | Expand/collapse that subagent's detail block |
| Click a subagent detail block | Open that subagent's session |
| Wheel up / down | Scroll the view three rows per notch |

Moving the pointer never wakes the screensaver (hovering is not activity); a
click or a wheel notch does.

## Screensaver looks

After the idle delay the dashboard goes black and the whole canvas is recoloured
as an animation. Every look runs in truecolor (no 256-colour approximation) and
recolours the glyphs that are already on screen, so nothing is re-laid out.
While the screensaver is up, `←`/`↑` show the previous look and `→`/`↓` the
next one; the arrows do not wake it, and the chosen look is remembered across
restarts. Any other key wakes the dashboard.

| # | Look | What it does |
| --- | --- | --- |
| 1 | `perlin drift` | Smooth 3D Perlin noise through the spectrum palette, floored at a readable dark grey |
| 2 | `falling matrix` | Green digital rain: one stream per column at its own speed, near-white head and a decaying trail |
| 3 | `sine sweep` | Soft horizontal band of drifting hue travelling down the screen |
| 4 | `sparkling sky` | Random narrow grayscale glyphs fading gently in and out of the empty cells |

The current look, its number and its name are shown in the header clock while
the screensaver runs.

<img width="1844" height="737" alt="image" src="https://github.com/user-attachments/assets/410f37a5-a679-4450-b6f1-43868bf7217b" />

## Settings

Settings live in `~/.config/opencode/session-dashboard.json` (or
`$OPENCODE_CONFIG_DIR/session-dashboard.json`). The file is written with the
defaults on first run:

```json
{
  "width": 45,
  "screensaverSeconds": 120
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `width` | `45` | Default card width in columns, clamped to 40–100 |
| `screensaverSeconds` | `120` | Idle seconds before the screensaver starts, clamped to 10–3600 |

Bad or missing values fall back to the defaults; a malformed file never breaks
the dashboard. The persisted view toggles (`s`, `d`, `f`) and the current
screensaver look are stored by the host, not in this file.

## Install

OpenCode loads plugins from `~/.config/opencode/plugins/<name>/`.
The installed copy is **source-only**: OpenCode resolves `@opencode/plugin`,
`@opentui/*` and `solid-js` from its own runtime, so the plugin directory needs
no `node_modules` (and a local copy would shadow the host's instances).

```bash
git clone https://github.com/catronomix/opencode-dashboard-plugin.git opencode-session-dashboard
cd opencode-session-dashboard
npm install          # dev dependencies, for typecheck and tests only
npm run deploy       # copies src/*.ts|tsx to ~/.config/opencode/plugins/session-dashboard
```

Then restart the TUI. `npm run deploy` wipes and replaces the target directory,
so local edits belong in `src/` here, never in the installed copy.

## Development

```bash
npm test         # node --test on test/dashboard.test.ts (rendering, layout, keys, screensaver looks)
npm run typecheck  # tsc --noEmit
npm run deploy     # copy the sources into the live plugin directory
```

The TUI half of a plugin has no console, so runtime diagnostics are appended to
`%TEMP%/session-dashboard-debug.log` (`$TMPDIR` elsewhere). Nothing else is
written to disk.

### Layout

| File | Role |
| --- | --- |
| `src/index.ts` | Server-side plugin entry; the dashboard itself is TUI-only |
| `src/tui.tsx` | Plugin setup, routing/close logic, view models, selection and keymap |
| `src/render.ts` | Pure canvas renderer: card layout/widths, cards, subagent detail blocks, chrome, rows, mouse hit-testing |
| `src/config.ts` | Settings file path, parsing and clamping (width, screensaver delay) |
| `src/view.ts` | View types, tree flattening and the token/cost/age formatters |
| `src/palette.ts` | Screensaver looks (noise, matrix, sine sweep, sparkling sky) and their truecolor LUTs |
| `scripts/deploy.mjs` | Copy `src/*.ts|tsx` into the local plugin directory |
| `test/dashboard.test.ts` | Regression tests for layout, selection and screensaver |
| `test/bench.ts` | Frame-timing harness for `buildRows`, run manually (`node test/bench.ts`) |

Rendering is kept pure (`render.ts`) so it can be asserted on without a
terminal; all animation and I/O live in `tui.tsx`.

---

<img width="1855" height="788" alt="image" src="https://github.com/user-attachments/assets/d8b39ddb-c41a-4fbc-ade1-fc85ecddc1fe" />

## Notes

- The plugin targets `@opencode/plugin` ≥ 2.1.4 and `@opentui/*` ≥ 0.6.6.
- `npm run deploy` targets the default config directory
  (`~/.config/opencode/plugins`); edit the `target` path in
  `scripts/deploy.mjs` if yours differs.
- This repository is not affiliated with the OpenCode project.

## License

MIT — see [LICENSE](LICENSE).
