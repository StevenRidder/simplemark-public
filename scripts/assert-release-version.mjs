#!/usr/bin/env node

// `docs/RELEASE-CONTRACT.md` §5: the tag is the source of truth, and all three
// versioned files must equal it before any build step runs.
//
// This is cheap and it is the check that matters most. Both versioned files read
// `0.0.0` today; without this gate the first real release ships as
// `SimpleMark-0.0.0-macos-arm64.dmg` — a build that reports the wrong version to
// every user who opens the About window, unfixable after publication.
//
// It runs before the matrix, not inside it: four platforms should not spend
// twenty minutes compiling to discover a typo in a version string.
//
// Usage: node scripts/assert-release-version.mjs --tag v0.3.1 [--root .]

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : (process.argv[index + 1] ?? '');
}

/**
 * The version a tag names. `v0.3.1` -> `0.3.1`.
 * Returns '' for anything that is not a `v`-prefixed semver, so the caller
 * reports one specific error rather than comparing against a garbage value.
 */
function versionFromTag(tag) {
  const match = /^v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.exec(tag.trim());
  return match?.[1] ?? '';
}

/** `package.version` out of a Cargo manifest, ignoring every other table. */
function cargoPackageVersion(source) {
  const lines = source.split('\n');
  let inPackage = false;
  for (const line of lines) {
    const table = /^\s*\[([^\]]+)\]/.exec(line);
    if (table) {
      inPackage = table[1]?.trim() === 'package';
      continue;
    }
    if (!inPackage) continue;
    const pair = /^\s*version\s*=\s*"([^"]*)"/.exec(line);
    if (pair) return pair[1] ?? '';
  }
  return '';
}

/**
 * Every versioned file and the value it holds.
 * A file that cannot be read or parsed reports `null`, which is a mismatch —
 * never a silently skipped check.
 */
function readVersions(root) {
  const read = (relative) => {
    try {
      return readFileSync(join(root, relative), 'utf8');
    } catch {
      return null;
    }
  };

  const json = (relative, pick) => {
    const source = read(relative);
    if (source === null) return { file: relative, version: null, reason: 'cannot be read' };
    try {
      return { file: relative, version: pick(JSON.parse(source)) ?? null, reason: '' };
    } catch {
      return { file: relative, version: null, reason: 'is not valid JSON' };
    }
  };

  const cargo = read('src-tauri/Cargo.toml');
  return [
    json('package.json', (value) => value.version),
    json('src-tauri/tauri.conf.json', (value) => value.version),
    {
      file: 'src-tauri/Cargo.toml',
      version: cargo === null ? null : cargoPackageVersion(cargo) || null,
      reason: cargo === null ? 'cannot be read' : 'has no [package] version',
    },
  ];
}

/**
 * Compares each file against the expected version.
 * Returns the mismatches, each naming the file and the value it holds — §5
 * requires the failure to name both, so a fix does not need a second run.
 */
function mismatches(versions, expected) {
  return versions
    .filter((entry) => entry.version !== expected)
    .map((entry) =>
      entry.version === null
        ? `${entry.file} ${entry.reason}`
        : `${entry.file} holds ${entry.version}, expected ${expected}`,
    );
}

function main() {
  const tag = option('--tag');
  const root = resolve(option('--root') || process.cwd());

  if (!tag) {
    process.stderr.write('release-version: pass --tag <vX.Y.Z>\n');
    process.exitCode = 1;
    return;
  }

  const expected = versionFromTag(tag);
  if (!expected) {
    process.stderr.write(`release-version: ${tag} is not a vX.Y.Z release tag\n`);
    process.exitCode = 1;
    return;
  }

  const problems = mismatches(readVersions(root), expected);
  if (problems.length) {
    process.stderr.write(`release-version: ${tag} does not match the tree:\n`);
    for (const problem of problems) process.stderr.write(`  ${problem}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`release-version: ${tag} matches every versioned file (${expected})\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
