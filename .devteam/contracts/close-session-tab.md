# Contract - close the selected session tab

Status: accepted (task #1)

## Purpose

From the dashboard, close the OpenCode session tab of the selected card without
leaving the dashboard.

## Public behavior

- A card is "selected" when `selection.row === -1` (one of the card stacks,
  not a subagent row). In that state `d` and `delete` close that card's root
  session tab through `context.ui.tabs.close(sessionID)`.
- Success keeps the dashboard open; the card list is reactive and drops the tab.
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
- No new config keys; persisted settings are untouched.

## Error paths

- `tabs.close` returns false or the target is undefined: no toast, debug line,
  dashboard unchanged.

## Invariants

- Never closes a subagent id.
- Never navigates away on success; closing the previous tab may fall back to
  the host's default routing only when the user closes the dashboard itself.
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
- README Keys table and hint row document the new binding.
