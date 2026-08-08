#!/usr/bin/env node

// `docs/RELEASE-CONTRACT.md` §9: the draft release body is assembled from
// inputs, not generated prose.
//
//   1. the CHANGELOG.md section for this version, if the file has one,
//   2. otherwise commit subjects since the previous tag,
//   3. always appended: the artifact table with each SHA-256, the canonical
//      source SHA, and the Switchboard task ids referenced since the last tag.
//
// A missing changelog section produces a visible note in the body. It does not
// produce an empty body and it does not fail the build — the artifacts are still
// good, and whoever reviews the draft decides whether the note is acceptable.
//
// Nothing here writes marketing copy. A release note describing what no human
// wrote is a release note nobody can trust.
//
// Usage:
//   node scripts/release-notes.mjs --tag v0.3.1 --sha <40-char> \
//     --sums SHA256SUMS [--changelog CHANGELOG.md] [--commits commits.txt]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : (process.argv[index + 1] ?? '');
}

function readOrNull(path) {
  if (!path) return null;
  try {
    return readFileSync(resolve(path), 'utf8');
  } catch {
    return null;
  }
}

/**
 * The section of a keep-a-changelog file for exactly this version.
 * Matches `## [0.3.1]` and `## 0.3.1`, and stops at the next same-level heading.
 */
function changelogSection(source, version) {
  if (!source) return '';
  const lines = source.split('\n');
  const heading = new RegExp(`^##\\s+\\[?${version.replace(/\./g, '\\.')}\\]?(\\s|$)`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return '';

  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    body.push(line);
  }
  return body.join('\n').trim();
}

/** Commit subjects, one per line, as a Markdown list. */
function commitList(commits) {
  const subjects = (commits ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return subjects.map((subject) => `- ${subject}`).join('\n');
}

/**
 * Switchboard task ids referenced since the last tag, deduped and sorted.
 * Conventional-commit scopes (`feat(APP-7): …`) and bare mentions both count.
 */
function taskIds(commits) {
  const found = new Set();
  for (const match of (commits ?? '').matchAll(/\b([A-Z][A-Z0-9]{1,15}-\d+)\b/g)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found].sort();
}

/**
 * `sha256sum -c` format -> the artifact table.
 * The manifest is the single source for both the table and the attached
 * SHA256SUMS file, so the body cannot disagree with the checksums it ships.
 */
function artifactRows(sums) {
  const rows = [];
  for (const line of (sums ?? '').split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (match?.[1] && match[2]) rows.push({ sha256: match[1].toLowerCase(), name: match[2] });
  }
  return rows;
}

function artifactTable(rows) {
  if (!rows.length) return '_No artifacts were recorded for this release._';
  const header = '| Artifact | SHA-256 |\n|---|---|';
  const body = rows.map((row) => `| \`${row.name}\` | \`${row.sha256}\` |`).join('\n');
  return `${header}\n${body}`;
}

function buildNotes({ tag, version, sha, sums, changelog, commits }) {
  const sections = [];

  const section = changelogSection(changelog, version);
  if (section) {
    sections.push(section);
  } else {
    const list = commitList(commits);
    sections.push(
      `> **No \`CHANGELOG.md\` section for ${version}.** The commit subjects since the previous tag are listed below in its place. Whoever publishes this draft decides whether that is acceptable.`,
    );
    if (list) sections.push(`### Commits since the previous tag\n\n${list}`);
  }

  sections.push(`### Artifacts\n\n${artifactTable(artifactRows(sums))}`);

  const ids = taskIds(commits);
  const provenance = [
    `- Tag: \`${tag}\``,
    `- Canonical source SHA: \`${sha}\``,
    `- Switchboard tasks: ${ids.length ? ids.map((id) => `\`${id}\``).join(', ') : '_none referenced_'}`,
  ].join('\n');
  sections.push(`### Provenance\n\n${provenance}`);

  sections.push(
    '---\n\nThis release is a **draft**. Checksums prove integrity, not authenticity — signing is verified by `.github/actions/release-trust-gate`, which must pass for every platform before this draft is published (`docs/RELEASE-TRUST.md`).',
  );

  return `${sections.join('\n\n')}\n`;
}

function main() {
  const tag = option('--tag');
  const sha = option('--sha');
  if (!tag || !sha) {
    process.stderr.write('release-notes: pass --tag <vX.Y.Z> and --sha <commit>\n');
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    buildNotes({
      tag,
      version: tag.replace(/^v/, ''),
      sha,
      sums: readOrNull(option('--sums')) ?? '',
      changelog: readOrNull(option('--changelog') || 'CHANGELOG.md'),
      commits: readOrNull(option('--commits')) ?? '',
    }),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
