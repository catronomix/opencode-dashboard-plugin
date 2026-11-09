# Project goals

Durable, user-approved goals for this project. The lead dev maintains this file;
changes to a goal need user approval.

- Stay a self-contained OpenCode TUI plugin: no new runtime dependencies beyond
  the existing peer set (`@opencode/plugin`, `@opentui/core`, `@opentui/solid`,
  `solid-js`).
- Keep every session card, subagent row and attention decorator understandable
  at a glance - information density without unreadable layout.
- Never regress keyboard and mouse navigation: every key and pointer action
  documented in the README keeps working.
- Keep the plugin cheap while idle: rendering is diffed/folded work only, and the
  screensaver never costs tokens or API calls.
- Every behaviour change ships with a `node --test` case and a clean
  `npm run typecheck`.
- `npm run deploy` must always be safe to run: it copies `src/*.ts|tsx` into the
  live plugin directory without leaving stale files behind.
