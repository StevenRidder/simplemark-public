import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// `docs/RELEASE-CONTRACT.md` §9: the body is assembled from inputs, not
// generated prose. A missing changelog section produces a visible note — never
// an empty body, and never a failed build, because the artifacts are still good.
//
// Exercised through the CLI, the same way `release-trust-gates.test.ts` covers
// `verify-release-trust.mjs`.

const script = join(process.cwd(), 'scripts', 'release-notes.mjs');
const SHA = 'c'.repeat(40);
const MAC_DIGEST = 'a'.repeat(64);

const SUMS = [
  `${MAC_DIGEST}  SimpleMark-0.3.1-macos-arm64.dmg`,
  `${'b'.repeat(64)}  SimpleMark-0.3.1-linux-x64.AppImage`,
].join('\n');

const COMMITS = [
  'feat(APP-7): publish tagged installer builds as a gated draft release',
  'fix(EDITOR-4): keep links portable',
  'docs: tidy the contract',
].join('\n');

const made: string[] = [];

function notes(options: { sums?: string; changelog?: string | null; commits?: string; tag?: string }) {
  const directory = mkdtempSync(join(tmpdir(), 'simplemark-notes-'));
  made.push(directory);

  const write = (name: string, contents: string) => {
    const path = join(directory, name);
    writeFileSync(path, contents);
    return path;
  };

  const argv = [script, '--tag', options.tag ?? 'v0.3.1', '--sha', SHA];
  argv.push('--sums', write('SHA256SUMS', options.sums ?? SUMS));
  argv.push('--commits', write('commits.txt', options.commits ?? COMMITS));
  // A null changelog points at a path that does not exist, which is exactly the
  // "repository has no CHANGELOG.md" case §9.2 covers.
  argv.push(
    '--changelog',
    options.changelog === null || options.changelog === undefined
      ? join(directory, 'absent-CHANGELOG.md')
      : write('CHANGELOG.md', options.changelog),
  );

  const result = spawnSync(process.execPath, argv, { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

afterEach(() => {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('changelog input (§9.1)', () => {
  it('uses the section for exactly this version', () => {
    const body = notes({
      changelog: ['# Changelog', '## [0.3.1]', '- Added the release lane', '## [0.3.0]', '- Older entry'].join('\n'),
    });
    expect(body).toContain('Added the release lane');
    expect(body).not.toContain('Older entry');
    expect(body).not.toContain('No `CHANGELOG.md` section');
  });

  it('matches a heading without brackets', () => {
    expect(notes({ changelog: '## 0.3.1\n- Entry\n' })).toContain('- Entry');
  });

  it('does not let 0.3.1 match 0.3.10', () => {
    const body = notes({ changelog: '## [0.3.10]\n- Ten\n' });
    expect(body).not.toContain('- Ten');
    expect(body).toContain('No `CHANGELOG.md` section');
  });
});

describe('commit fallback (§9.2)', () => {
  it('falls back to commit subjects with a visible note', () => {
    const body = notes({ changelog: null });
    expect(body).toContain('No `CHANGELOG.md` section for 0.3.1');
    expect(body).toContain('- feat(APP-7): publish tagged installer builds');
    expect(body).toContain('- docs: tidy the contract');
  });
});

describe('always appended (§9.3)', () => {
  it('lists every artifact with its SHA-256', () => {
    for (const changelog of ['## [0.3.1]\n- Prose\n', null]) {
      const body = notes({ changelog });
      expect(body).toContain('SimpleMark-0.3.1-macos-arm64.dmg');
      expect(body).toContain(MAC_DIGEST);
      expect(body).toContain('SimpleMark-0.3.1-linux-x64.AppImage');
    }
  });

  it('records the canonical source SHA and the Switchboard task ids', () => {
    const body = notes({ changelog: null });
    expect(body).toContain(SHA);
    expect(body).toContain('`APP-7`');
    expect(body).toContain('`EDITOR-4`');
  });

  it('says so when the commits reference no task', () => {
    expect(notes({ commits: 'docs: tidy the contract' })).toContain('none referenced');
  });

  it('says so rather than rendering an empty artifact table', () => {
    expect(notes({ sums: 'not a checksum line\n' })).toContain('No artifacts');
  });
});

describe('the body as a whole', () => {
  it('is never empty, even with no inputs at all', () => {
    const body = notes({ sums: '', commits: '', changelog: null });
    expect(body.trim().length).toBeGreaterThan(0);
    expect(body).toContain('No `CHANGELOG.md` section');
    expect(body).toContain('No artifacts');
  });

  it('states that checksums are integrity, not authenticity (§6)', () => {
    const body = notes({ changelog: null });
    expect(body).toContain('integrity, not authenticity');
    expect(body).toContain('draft');
  });

  it('fails loudly without a tag and sha rather than emitting a body', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('pass --tag');
  });
});
