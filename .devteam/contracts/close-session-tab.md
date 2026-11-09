# Contract - close the selected session tab

Status: accepted (task #1), extended by task #2 (last tab leaves for a new
session)

## Purpose

From the dashboard, close the OpenCode session tab of the selected card without
leaving the dashboard.

## Public behavior

- A card is "selected" when `selection.row === -1` (one of the card stacks,
  not a subagent row). In that state `d` and `delete` close that card's root
  session tab through `context.ui.tabs.close(sessionID)`.
- Success keeps the dashboard open; the card list is reactive and drops the tab.
- Closing the last open tab is the exception: `tabs.close` removes it, then the
  dashboard leaves via `props.close({ type: "home" })`, so OpenCode lands on the
  new-session page and creates a tab when a session starts - the same result as
  closing the last tab outside the dashboard.
- Leaving the dashboard (`esc`/`q`) never navigates back to a session whose tab
  is closed: when the dashboard was opened from a session tab, it returns to
  that tab while it is still open, else the active tab, else the first open tab,
  else `home`. Opened from home/new (`previousTab` undefined) or with tabs
  disabled, the old `back` route stands.
- A subagent row selected (`row >= 0`): `delete` and `d` do not close anything
  (subagents are not root tabs; closing the parent card would surprise).
- A card without an open tab (an `a`-mode extra session): no-op, debug line.
- Tabs disabled (`ui.tabs.enabled() === false`): no-op.
- The screensaver keeps priority: a key press wakes it first and does not leak
  the close action.

## Key chart

| Key | Action |
| --- | --- |
| `d` / `delete` | Close the selected card's session tab |
| `shift+d` (`D`) | `D`ynamic widths (moved from `d`) |

`D` keeps the mnemonic; `shift+g` is the existing precedent for a shifted
binding.

## API / data

- Host: `context.ui.tabs.close(sessionID): boolean` (`@opencode/plugin` >= 2.1.4
  `dist/tui/context.d.ts` lines 459-460). Returns false when no tab matched.
- Pure helper: `resolveCloseTarget(cards, selection): string | undefined` in
  `src/view.ts`, where a card carries `id` and whether it has a tab.
- Pure helpers (task #2, `src/view.ts`, exported `TabState` = `sessionID` plus
  optional `active`):
  - `isEmptyAfterClose(tabs, target): boolean` - true when no tab other than
    `target` is open; safe on the list as it is after the close (target already
    dropped) and on an empty list.
  - `resolveExitTarget(previous, tabs): string | undefined` - `previous` while
    it is still an open tab, else the active tab, else the first tab, else
    undefined ("go home"). A closed previous tab never wins.
- No new config keys; persisted settings are untouched.

## Error paths

- `tabs.close` returns false or the target is undefined: no toast, debug line,
  dashboard unchanged.

## Invariants

- Never closes a subagent id.
- Never navigates back to a session whose tab is not open; the host re-admits a
  tab for any session it routes to, so a closed tab would come back.
- Closing the last tab is the only close that leaves the dashboard, and it
  lands on `home`.
- Existing shortcuts (escape/q, arrows, enter, space, f, a, s, PgUp/PgDn, g/G)
  keep working.

## Compatibility

Peer `@opencode/plugin >=2.1.4` already exposes `ui.tabs.close`; no dependency
change.

## Close-out

The change is live only after `npm run deploy`, with the installed
`~/.config/opencode/plugins/session-dashboard/` hashes equal to `src/`, and a
restart of the running OpenCode TUI (it keeps the plugin loaded at startup).

## Non-goals

Confirm dialog, undo, bulk close, closing subagent sessions, mouse close
gesture.

## Tests that pin it

- `node --test`: `resolveCloseTarget` unit cases (card with tab -> id; subagent
  row -> undefined; card without tab -> undefined; out-of-range -> undefined)
  and a keymap assertion that `d`/`delete` bind close-tab while `shift+d` binds
  toggle-dynamic.
- `node --test`: `isEmptyAfterClose` unit cases (single tab, stale list still
  holding the target, empty list -> true; any other open tab -> false) and
  `resolveExitTarget` unit cases (previous open -> previous; previous closed
  among others -> active, never previous; no active -> first; no tabs ->
  undefined), plus a source assertion that `closeSelected` checks
  `isEmptyAfterClose` and routes home through `props.close({ type: "home" })`
  and that the leave routine builds its fallback with `resolveExitTarget`.
- README Keys table, close-tab note and return note document the behaviour.
