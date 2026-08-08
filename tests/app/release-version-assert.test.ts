import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// `docs/RELEASE-CONTRACT.md` §5: the tag is the source of truth, and all three
// versioned files must equal it before any build step runs. Both versioned files
// read `0.0.0` today, so without this gate the first real release ships as
// `SimpleMark-0.0.0-macos-arm64.dmg` — wrong in every About window, and
// unfixable after publication.
//
// Exercised through the CLI, the same way `release-trust-gates.test.ts` covers
// `verify-release-trust.mjs`: the workflow calls this as a command, so the
// command is the contract worth pinning.

const script = join(process.cwd(), 'scripts', 'assert-release-version.mjs');
const made: string[] = [];

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'simplemark-version-'));
  made.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

function complete(version: string): Record<string, string> {
  return {
    'package.json': JSON.stringify({ name: 'simplemark', version }),
    'src-tauri/tauri.conf.json': JSON.stringify({ version }),
    'src-tauri/Cargo.toml': `[package]\nname = "simplemark"\nversion = "${version}"\n`,
  };
}

function run(tag: string, root: string) {
  return spawnSync(process.execPath, [script, '--tag', tag, '--root', root], { encoding: 'utf8' });
}

afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('the tag is the source of truth (§5)', () => {
  it('passes when all three files agree with the tag', () => {
    const result = run('v0.3.1', tree(complete('0.3.1')));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('matches every versioned file');
  });

  it('accepts a prerelease tag', () => {
    expect(run('v1.0.0-rc.1', tree(complete('1.0.0-rc.1'))).status).toBe(0);
  });

  it('refuses anything that is not a release tag', () => {
    const root = tree(complete('0.3.1'));
    for (const tag of ['0.3.1', 'release-0.3.1', 'v0.3', 'vX.Y.Z']) {
      const result = run(tag, root);
      expect(result.status, tag).not.toBe(0);
      expect(result.stderr, tag).toContain('is not a vX.Y.Z release tag');
    }
  });

  it('fails without a tag at all', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('pass --tag');
  });
});

describe('naming what drifted (§5)', () => {
  it('names the file and the value it holds', () => {
    const files = complete('0.3.1');
    files['src-tauri/Cargo.toml'] = '[package]\nname = "simplemark"\nversion = "0.3.0"\n';
    const result = run('v0.3.1', tree(files));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('src-tauri/Cargo.toml');
    expect(result.stderr).toContain('0.3.0');
    expect(result.stderr).toContain('expected 0.3.1');
  });

  it('catches the 0.0.0 default this gate was written for', () => {
    const result = run('v0.3.1', tree(complete('0.0.0')));
    expect(result.status).not.toBe(0);
    for (const file of ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml']) {
      expect(result.stderr).toContain(file);
    }
  });

  it('treats an unreadable or malformed file as a mismatch, never a skip', () => {
    const files = complete('0.3.1');
    delete files['src-tauri/Cargo.toml'];
    files['package.json'] = '{ not json';
    const result = run('v0.3.1', tree(files));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('package.json is not valid JSON');
    expect(result.stderr).toContain('src-tauri/Cargo.toml cannot be read');
  });

  it('does not take a dependency version when [package] has none', () => {
    const files = complete('0.3.1');
    files['src-tauri/Cargo.toml'] = '[dependencies]\nserde = "1.0"\nversion = "0.3.1"\n';
    const result = run('v0.3.1', tree(files));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('has no [package] version');
  });

  it('reads [package] version even when other tables carry one', () => {
    const files = complete('0.3.1');
    files['src-tauri/Cargo.toml'] = [
      '[package]',
      'name = "simplemark"',
      'version = "0.3.1"',
      '',
      '[dependencies.tauri]',
      'version = "2.0.0"',
    ].join('\n');
    expect(run('v0.3.1', tree(files)).status).toBe(0);
  });
});
