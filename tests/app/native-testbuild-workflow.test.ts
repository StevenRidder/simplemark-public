import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// `docs/RELEASE-CONTRACT.md` §12 assigns APP-5 these rows: §2's pull-request
// trigger, §3's matrix, §4's test-build names, §7's pull-request retention, §8's
// permissions, and §10's failure rules. A workflow cannot be exercised in the
// gate — GitHub is the only runtime it has — so what the gate can prove is that
// the file still says what the contract requires. Each assertion below cites the
// section it enforces, so a future edit that breaks one is told which document
// it has to change first.

const workflow = readFileSync(
  join(process.cwd(), '.github', 'workflows', 'native-testbuild.yml'),
  'utf8',
);

function width(line: string): number {
  return (/^\s*/.exec(line) ?? [''])[0].length;
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

const uploads = steps(workflow).filter((step) => step.includes('actions/upload-artifact'));

describe('native test-build workflow', () => {
  it('triggers on pull requests and manual dispatch, and nothing else (§2)', () => {
    const block = workflow.split(/^on:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';
    const triggers = block
      .split('\n')
      .filter((line) => /^ {2}\S/.test(line))
      .map((line) => line.trim().replace(/:.*$/, ''));
    expect(triggers.sort()).toEqual(['pull_request', 'workflow_dispatch']);
  });

  it('never touches a GitHub Release (§2)', () => {
    expect(workflow).not.toMatch(/gh release|action-gh-release|create-release|softprops/);
  });

  it('builds the four contracted legs on pinned native runners (§3)', () => {
    expect(matrixInclude(workflow)).toEqual([
      { leg: 'macos-arm64', runner: 'macos-26', target: 'aarch64-apple-darwin', bundles: 'dmg', os: 'macos', arch: 'arm64' },
      { leg: 'macos-x64', runner: 'macos-15-intel', target: 'x86_64-apple-darwin', bundles: 'dmg', os: 'macos', arch: 'x64' },
      { leg: 'windows-x64', runner: 'windows-2025', target: 'x86_64-pc-windows-msvc', bundles: 'msi,nsis', os: 'windows', arch: 'x64' },
      { leg: 'linux-x64', runner: 'ubuntu-22.04', target: 'x86_64-unknown-linux-gnu', bundles: 'appimage,deb', os: 'linux', arch: 'x64' },
    ]);
  });

  it('pins runner labels instead of tracking a rolling image (§3)', () => {
    expect(workflow).not.toMatch(/-latest/);
  });

  it('installs the Ayatana appindicator and libfuse2, not the pre-Ayatana package (§3)', () => {
    expect(workflow).toContain('libayatana-appindicator3-dev');
    expect(workflow).not.toContain('libappindicator3-dev');
    expect(workflow).toContain('libfuse2');
  });

  it('asserts the bundle at the path Tauri writes it to before renaming it (§3)', () => {
    expect(workflow).toContain('src-tauri/target/${{ matrix.target }}/release/bundle');
  });

  it('asserts artifact type by reading the bytes (§10)', () => {
    expect(workflow).toContain('scripts/verify-native-artifact.mjs');
    expect(workflow).toContain('--target "${{ matrix.os }}"');
  });

  it('names the test build for the commit, not the version (§4)', () => {
    expect(uploads.some((step) => /name: simplemark-testbuild-\$\{\{ matrix\.os \}\}-\$\{\{ matrix\.arch \}\}-/.test(step))).toBe(true);
    expect(workflow).toMatch(/SHORT_SHA|short-sha|short_sha/);
  });

  it('retains every uploaded artifact for seven days, not the 90-day default (§7)', () => {
    expect(uploads.length).toBeGreaterThan(0);
    for (const step of uploads) expect(step).toContain('retention-days: 7');
  });

  it('reads the repository and nothing more, with no usable token left behind (§8)', () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(workflow).not.toMatch(/contents: write|id-token|packages:|pull-requests:|actions: write/);
    expect(workflow).toContain('persist-credentials: false');
  });

  it('pins third-party actions by commit SHA (§8)', () => {
    const used = [...workflow.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1] ?? '');
    expect(used.length).toBeGreaterThan(0);
    for (const action of used) {
      if (action.startsWith('./')) continue;
      if (action.startsWith('actions/')) {
        expect(action, 'first-party actions may pin a major version').toMatch(/@v\d+$/);
        continue;
      }
      expect(action, 'third-party actions must pin a full commit SHA').toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('never manufactures a green leg from a failed step (§10)', () => {
    expect(workflow).not.toMatch(/continue-on-error|\|\| true/);
  });

  it('lets the other three platforms report when one fails (§10)', () => {
    expect(workflow).toMatch(/fail-fast:\s*false/);
  });

  it('uploads the installer unconditionally and only the diagnostic log on failure (§10)', () => {
    const installer = uploads.filter((step) => step.includes('simplemark-testbuild-'));
    expect(installer).toHaveLength(1);
    expect(installer[0]).not.toContain('if:');
    for (const step of uploads) {
      if (step.includes('always()')) expect(step).toContain('build-log');
    }
  });
});
