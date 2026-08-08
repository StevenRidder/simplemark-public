import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// `docs/RELEASE-CONTRACT.md` §12 assigns APP-7 these rows: §2's tag trigger, §5,
// §6, §9, §7's release retention, §8's elevated job and `release-signing`
// environment, and invoking the release-trust gate per §10. A workflow cannot be
// exercised in the gate — GitHub is the only runtime it has — so what the gate
// can prove is that the file still says what the contract requires. Each
// assertion cites the section it enforces, so a future edit that breaks one is
// told which document it has to change first.

const release = readFileSync(
  join(process.cwd(), '.github', 'workflows', 'release.yml'),
  'utf8',
);
const promote = readFileSync(
  join(process.cwd(), '.github', 'workflows', 'release-promote.yml'),
  'utf8',
);

function width(line: string): number {
  return (/^\s*/.exec(line) ?? [''])[0].length;
}

/**
 * The workflow with its comment lines removed.
 *
 * "Must not contain" assertions run against this rather than the raw file,
 * because these workflows explain in prose which permissions they deliberately
 * do not take. A comment reading `no id-token, no packages` is the opposite of
 * a violation, and a test that cannot tell the two apart pushes the next author
 * to delete the explanation to get green.
 */
function code(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

/** The `- key: value` entries under `include:`, as objects. */
function matrixInclude(source: string): Record<string, string>[] {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => /^\s*include:\s*$/.test(line));
  if (start === -1) return [];
  const indent = width(lines[start] ?? '');

  const entries: Record<string, string>[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (width(line) <= indent) break;
    const item = line.trim();
    if (item.startsWith('- ')) entries.push({});
    const pair = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(item.replace(/^-\s*/, ''));
    const entry = entries[entries.length - 1];
    if (pair?.[1] && entry) entry[pair[1]] = (pair[2] ?? '').replace(/^['"]|['"]$/g, '');
  }
  return entries;
}

/** Each step of the workflow as its own block of text. */
function steps(source: string): string[] {
  const blocks: string[] = [];
  let indent = -1;
  for (const line of source.split('\n')) {
    const column = width(line);
    if (/^\s*- (name|uses|run):/.test(line) && column >= 6 && (indent === -1 || column === indent)) {
      indent = column;
      blocks.push(line);
      continue;
    }
    const open = blocks.length - 1;
    if (open < 0) continue;
    if (line.trim() === '' || column > indent) blocks[open] += `\n${line}`;
    else indent = -1;
  }
  return blocks;
}

const uploads = steps(release).filter((step) => step.includes('actions/upload-artifact'));

describe('tagged release workflow', () => {
  it('triggers only on a version tag, and on nothing else (§2)', () => {
    const block = release.split(/^on:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';
    const triggers = block
      .split('\n')
      .filter((line) => /^ {2}\S/.test(line))
      .map((line) => line.trim().replace(/:.*$/, ''));
    expect(triggers).toEqual(['push']);
    expect(block).toContain("- 'v*'");
    // §2: push to main does not build installers, and there is no schedule.
    expect(block).not.toMatch(/branches:|schedule:|pull_request:/);
  });

  it('never publishes a release (§2, §10)', () => {
    expect(release).toContain('--draft');
    // The specific commands that would promote a draft, rather than the word
    // "publish" — which this file uses to say it does not do that.
    expect(code(release)).not.toMatch(/--draft[= ]false|gh release edit|softprops|action-gh-release/);
  });

  it('checks the version before the matrix, not inside it (§5)', () => {
    expect(release).toContain('scripts/assert-release-version.mjs');
    // The build legs depend on the version job, so a typo cannot cost four
    // twenty-minute compiles.
    expect(release).toMatch(/build:\n(?:.*\n)*?\s*needs: version/);
  });

  it('builds the four contracted legs on pinned native runners (§3)', () => {
    expect(matrixInclude(release)).toEqual([
      { leg: 'macos-arm64', runner: 'macos-26', target: 'aarch64-apple-darwin', bundles: 'dmg', os: 'macos', arch: 'arm64' },
      { leg: 'macos-x64', runner: 'macos-15-intel', target: 'x86_64-apple-darwin', bundles: 'dmg', os: 'macos', arch: 'x64' },
      { leg: 'windows-x64', runner: 'windows-2025', target: 'x86_64-pc-windows-msvc', bundles: 'msi,nsis', os: 'windows', arch: 'x64' },
      { leg: 'linux-x64', runner: 'ubuntu-22.04', target: 'x86_64-unknown-linux-gnu', bundles: 'appimage,deb', os: 'linux', arch: 'x64' },
    ]);
  });

  it('pins runner labels instead of tracking a rolling image (§3)', () => {
    expect(code(release)).not.toMatch(/-latest/);
    expect(code(promote)).not.toMatch(/-latest/);
  });

  it('installs the Ayatana appindicator and libfuse2 (§3)', () => {
    expect(release).toContain('libayatana-appindicator3-dev');
    expect(release).not.toContain('libappindicator3-dev');
    expect(release).toContain('libfuse2');
  });

  it('asserts the bundle at the path Tauri writes it to before renaming (§3)', () => {
    expect(release).toContain('src-tauri/target/${{ matrix.target }}/release/bundle');
  });

  it('asserts artifact type by reading the bytes (§10)', () => {
    expect(release).toContain('scripts/verify-native-artifact.mjs');
    expect(release).toContain('--target "${{ matrix.os }}"');
  });

  it('ships the five first-lane assets and not the .deb (§3, §4)', () => {
    for (const asset of [
      'SimpleMark-$version-macos-arm64.dmg',
      'SimpleMark-$version-macos-x64.dmg',
      'SimpleMark-$version-windows-x64.msi',
      'SimpleMark-$version-windows-x64-setup.exe',
      'SimpleMark-$version-linux-x64.AppImage',
    ]) {
      expect(release).toContain(asset);
    }
    // §3: the .deb is built by the matrix but is not a first-lane release asset.
    expect(release).not.toContain('SimpleMark-$version-linux-x64.deb');
  });

  it('generates one central SHA256SUMS after every leg (§6)', () => {
    expect(release).toContain('SHA256SUMS');
    expect(release).toContain('sha256sum -c SHA256SUMS');
    const draft = release.split(/^ {2}draft:$/m)[1] ?? '';
    expect(draft).toContain('SHA256SUMS');
  });

  it('assembles release notes from inputs rather than prose (§9)', () => {
    expect(release).toContain('scripts/release-notes.mjs');
    expect(release).toContain('--notes-file');
  });

  it('retains the handoff artifacts for thirty days (§7)', () => {
    expect(uploads.length).toBeGreaterThan(0);
    for (const step of uploads) expect(step).toContain('retention-days: 30');
  });

  it('reads the repository except in the one elevated job (§8)', () => {
    expect(release).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(code(release)).not.toMatch(/id-token|packages:|pull-requests:|actions: write/);
    expect(release).toContain('persist-credentials: false');
    // Exactly one job elevates, and it is the one that declares the environment.
    expect(code(release).match(/contents: write/g)).toHaveLength(1);
    expect(release).toContain('environment: release-signing');
  });

  it('requires every leg before the draft job runs (§10)', () => {
    expect(release).toMatch(/needs: \[version, build\]/);
    expect(release).toMatch(/fail-fast:\s*false/);
  });

  it('pins third-party actions by commit SHA (§8)', () => {
    for (const source of [release, promote]) {
      const used = [...source.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1] ?? '');
      expect(used.length).toBeGreaterThan(0);
      for (const action of used) {
        if (action.startsWith('./')) continue;
        if (action.startsWith('actions/')) {
          expect(action, 'first-party actions may pin a major version').toMatch(/@v\d+$/);
          continue;
        }
        expect(action, 'third-party actions must pin a full commit SHA').toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });

  it('never manufactures a green release from a failed step (§10)', () => {
    expect(code(release)).not.toMatch(/continue-on-error|\|\| true/);
    // §10 permits `if: always()` only on a diagnostic upload.
    for (const step of steps(release)) {
      if (step.includes('always()')) expect(step).toContain('release-log');
    }
  });
});

describe('release promotion workflow', () => {
  it('is the only automated publish path, and it is manual (§2)', () => {
    const block = promote.split(/^on:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';
    const triggers = block
      .split('\n')
      .filter((line) => /^ {2}\S/.test(line))
      .map((line) => line.trim().replace(/:.*$/, ''));
    expect(triggers).toEqual(['workflow_dispatch']);
    expect(promote).toContain('--draft=false');
  });

  it('runs the trust gate for every platform before publishing (§10)', () => {
    const gates = [...promote.matchAll(/uses:\s*\.\/\.github\/actions\/release-trust-gate/g)];
    expect(gates).toHaveLength(3);
    for (const target of ['macos', 'windows', 'linux']) {
      expect(promote).toContain(`target: ${target}`);
    }
  });

  it('puts every gate before the publish step, with no way around them (§10)', () => {
    const lastGate = promote.lastIndexOf('release-trust-gate');
    const publish = promote.indexOf('--draft=false');
    expect(lastGate).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(lastGate);
    expect(code(promote)).not.toMatch(/continue-on-error|\|\| true|if:\s*\$\{\{\s*always/);
  });

  it('elevates once, inside the protected environment (§8)', () => {
    expect(promote).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(code(promote).match(/contents: write/g)).toHaveLength(1);
    expect(promote).toContain('environment: release-signing');
    expect(code(promote)).not.toMatch(/id-token|packages:|pull-requests:|actions: write/);
  });

  it('refuses to act on a release that is not a draft', () => {
    expect(promote).toContain('--json isDraft');
  });

  it('never synthesises its own smoke evidence', () => {
    // Evidence a workflow wrote about itself proves nothing; it is downloaded
    // from the draft, where APP-6's smoke lanes attached it.
    expect(promote).toContain('platform-smoke-');
    expect(promote).toMatch(/gh release download/);
    expect(code(promote)).not.toMatch(/schema.*platform-smoke|cat\s*>.*platform-smoke/);
  });
});
