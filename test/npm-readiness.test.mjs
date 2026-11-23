import { test } from "node:test"
import assert from "node:assert/strict"

import { checkNpmReadiness, readerFacingPackageSpecs } from "../scripts/lib/npm-readiness.mjs"

/** A manifest that passes every npm-readiness rule. */
const ready = {
  name: "@catronomix/opencode-session-dashboard",
  version: "0.1.1",
  description: "Fullscreen OpenCode TUI dashboard for every open session and subagent.",
  keywords: ["opencode", "opencode-plugin", "dashboard"],
  homepage: "https://github.com/catronomix/opencode-dashboard-plugin#readme",
  bugs: { url: "https://github.com/catronomix/opencode-dashboard-plugin/issues" },
  license: "MIT",
  author: "Innocent Coppieters",
  repository: { type: "git", url: "git+https://github.com/catronomix/opencode-dashboard-plugin.git" },
  publishConfig: { access: "public" },
  files: ["src", "README.md", "LICENSE"],
}

const readme = [
  "# dashboard",
  "",
  "```sh",
  "opencode plugin add @catronomix/opencode-session-dashboard",
  "```",
  "",
  '```json',
  '{ "plugins": ["@catronomix/opencode-session-dashboard"] }',
  "```",
].join("\n")

const check = (manifest = ready, context = { readme, hasLicense: true }) => checkNpmReadiness(manifest, context)

test("a readable manifest with install text passes", () => {
  assert.deepEqual(check(), { failures: [], warnings: [] })
})

test("a missing description blocks the release", () => {
  const { description, ...rest } = ready
  assert.match(check(rest).failures.join("\n"), /description is missing/)
})

test("a manifest without the opencode-plugin keyword blocks the release", () => {
  const manifest = { ...ready, keywords: ["opencode", "dashboard"] }
  assert.match(check(manifest).failures.join("\n"), /do not include "opencode-plugin"/)
})

test("missing registry metadata blocks the release", () => {
  const { bugs, homepage, repository, author, ...rest } = ready
  const failures = check(rest).failures.join("\n")
  assert.match(failures, /homepage is missing/)
  assert.match(failures, /bugs\.url is missing/)
  assert.match(failures, /repository is missing/)
  assert.match(failures, /author is missing/)
})

test("repository shorthand and a missing LICENSE block the release", () => {
  const manifest = { ...ready, repository: "catronomix/opencode-dashboard-plugin" }
  const failures = check(manifest, { readme, hasLicense: false }).failures.join("\n")
  assert.match(failures, /shorthand form/)
  assert.match(failures, /LICENSE file is missing/)
})

test("a scoped package without public access blocks the release", () => {
  const { publishConfig, ...rest } = ready
  assert.match(check(rest).failures.join("\n"), /publishConfig\.access/)
})

test("private: true blocks the release", () => {
  assert.match(check({ ...ready, private: true }).failures.join("\n"), /"private": true/)
})

test("a README without an install example blocks the release", () => {
  const failures = check(ready, { readme: "# dashboard\n\nNothing to copy here.\n", hasLicense: true }).failures.join("\n")
  assert.match(failures, /README has no install example/)
})

test("reader-facing install text that pins a version blocks the release", () => {
  const pinnedReadme = [
    "```sh",
    "opencode plugin add @catronomix/opencode-session-dashboard@0.1.0",
    "```",
    "",
    '```json',
    '{ "plugins": ["@catronomix/opencode-session-dashboard@0.1.0"] }',
    "```",
  ].join("\n")
  const failures = check(ready, { readme: pinnedReadme, hasLicense: true }).failures.join("\n")
  assert.match(failures, /pins @catronomix\/opencode-session-dashboard@0\.1\.0/)
})

test("a tag or a bare name is not a pin", () => {
  const tagged = [
    "```sh",
    "opencode plugin add @catronomix/opencode-session-dashboard",
    "opencode plugin add @catronomix/opencode-session-dashboard@next",
    "```",
  ].join("\n")
  assert.deepEqual(readerFacingPackageSpecs(tagged, ready.name), { sawInstall: true, pinned: [] })
})

test("specs for other packages are not attributed to this one", () => {
  const other = [
    "```sh",
    "opencode plugin add @catronomix/opencode-ctx-limit@0.2.4",
    "```",
  ].join("\n")
  assert.deepEqual(readerFacingPackageSpecs(other, ready.name), { sawInstall: false, pinned: [] })
})
