#!/usr/bin/env node
/**
 * npm-readiness rules for a publishable plugin package.
 *
 * Pure: given a parsed manifest (and optionally the README text and whether a
 * LICENSE file exists), return the blocking failures and the warnings. No fs, no
 * network, no child processes - so it can be unit-tested and reused by any script.
 *
 * These are the rules in C:\GITHUB\PUBLISH-GUIDE.md §7 that the packed-tarball
 * checks in scripts/release-check.mjs cannot see: metadata a registry or an
 * index such as opencode.im reads, and reader-facing install text.
 */

export const REQUIRED_KEYWORD = "opencode-plugin"

const PINNED = /@v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/

/**
 * @param {Record<string, any>} pkg parsed package.json
 * @param {{ readme?: string, hasLicense?: boolean }} [context]
 * @returns {{ failures: string[], warnings: string[] }}
 */
export function checkNpmReadiness(pkg, context = {}) {
  const { readme, hasLicense = false } = context
  const failures = []
  const warnings = []

  if (!pkg || typeof pkg !== "object") {
    return { failures: ["package.json could not be read as an object"], warnings }
  }

  const name = typeof pkg.name === "string" ? pkg.name.trim() : ""
  if (!name) failures.push("name is missing")
  else if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(name)) {
    failures.push(`name "${name}" is not a scoped @scope/name package (PUBLISH-GUIDE §2)`)
  }

  if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+/.test(pkg.version.trim())) {
    failures.push("version is missing or not semver")
  }

  if (pkg.private === true) failures.push('"private": true blocks publishing; remove it')

  const description = typeof pkg.description === "string" ? pkg.description.trim() : ""
  if (!description) failures.push("description is missing; npm search and every index read it")
  else if (description.length < 20) warnings.push(`description is only ${description.length} chars; aim for one real sentence`)

  const keywords = Array.isArray(pkg.keywords) ? pkg.keywords.filter((word) => typeof word === "string") : []
  if (!keywords.length) failures.push(`keywords are missing; the package is unlisted without "${REQUIRED_KEYWORD}"`)
  else if (!keywords.includes(REQUIRED_KEYWORD)) {
    failures.push(`keywords do not include "${REQUIRED_KEYWORD}"; opencode.im and other indexes match it literally`)
  }

  if (typeof pkg.homepage !== "string" || !/^https?:\/\//.test(pkg.homepage)) {
    failures.push("homepage is missing or not an http(s) URL")
  }

  const bugs = typeof pkg.bugs === "string" ? pkg.bugs : pkg.bugs?.url
  if (typeof bugs !== "string" || !/^https?:\/\//.test(bugs)) {
    failures.push("bugs.url is missing or not an http(s) URL")
  }

  if (typeof pkg.license !== "string" || !pkg.license.trim()) failures.push("license is missing (SPDX identifier)")
  if (!hasLicense) failures.push("LICENSE file is missing next to package.json")

  if (typeof pkg.author !== "string" || !pkg.author.trim()) failures.push("author is missing")

  if (!pkg.repository) failures.push("repository is missing")
  else if (typeof pkg.repository === "string") {
    failures.push('repository uses the shorthand form; write {"type":"git","url":"git+https://…"}')
  } else if (typeof pkg.repository.url !== "string" || !pkg.repository.url.trim()) {
    failures.push("repository.url is missing")
  }

  if (name.startsWith("@") && pkg.publishConfig?.access !== "public") {
    failures.push('publishConfig.access is not "public"; scoped packages are private by default')
  }

  if (pkg.files !== undefined && (!Array.isArray(pkg.files) || !pkg.files.length)) {
    failures.push("files is present but empty")
  }

  if (typeof readme === "string") {
    const reader = readerFacingPackageSpecs(readme, name)
    if (!reader.sawInstall) {
      failures.push(`README has no install example naming ${name || "the package"} (opencode plugin add … or a "plugins" entry)`)
    }
    for (const spec of reader.pinned) {
      failures.push(`README install text pins ${spec}; reader-facing install commands stay version-agnostic (PUBLISH-GUIDE §7.3)`)
    }
  }

  return { failures, warnings }
}

/**
 * Finds the package specs a reader would copy out of a README: `opencode plugin
 * add <spec>` commands and `"plugins": ["<spec>"]` config snippets.
 *
 * A spec that names a concrete version is a pinned install command; it goes stale
 * on the next publish. `@next`-style tags and bare names are fine.
 *
 * @param {string} readme
 * @param {string} name
 * @returns {{ sawInstall: boolean, pinned: string[] }}
 */
export function readerFacingPackageSpecs(readme, name) {
  const pinned = new Set()
  let sawInstall = false
  if (!readme) return { sawInstall, pinned: [] }

  for (const line of readme.split(/\r?\n/)) {
    const addCommands = line.matchAll(/opencode\s+plugin\s+add\s+([^\s`'"]+)/g)
    for (const [, spec] of addCommands) {
      if (!name || !spec.startsWith(name)) continue
      sawInstall = true
      if (PINNED.test(spec)) pinned.add(spec)
    }

    const pluginArrays = line.matchAll(/"plugins"\s*:\s*\[([^\]]*)\]/g)
    for (const [, body] of pluginArrays) {
      for (const match of body.matchAll(/"([^"]+)"/g)) {
        const spec = match[1]
        if (!name || !spec.startsWith(name)) continue
        sawInstall = true
        if (PINNED.test(spec)) pinned.add(spec)
      }
    }
  }

  return { sawInstall, pinned: [...pinned] }
}
