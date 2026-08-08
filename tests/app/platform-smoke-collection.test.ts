import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// `scripts/collect-platform-smoke.mjs` is the producer that
// `simplemark.platform-smoke.v1` never had: the schema was defined, verified,
// and fixture-tested, but nothing wrote one, so `release-promote.yml` could
// never pass and no release could be published.
//
// The tests that matter here are the ones that keep it honest. A collector that
// can be talked into writing `true` converts missing evidence into a green
// result — the failure `RELEASE-CONTRACT.md` §10 forbids,
// and strictly worse than having no gate, because the gate would then be
// trusted. Every guardrail below exists to make that impossible.

const script = join(process.cwd(), 'scripts', 'collect-platform-smoke.mjs');
const SHA = 'a'.repeat(40);
// These integration cases invoke macOS disk-image tooling. Under the complete
// parallel suite, the OS call can cross Vitest's 5 s unit-test default even
// though the collector itself remains bounded and finishes in a few seconds.
const COLLECTOR_INTEGRATION_TIMEOUT_MS = 15_000;
const made: string[] = [];

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'simplemark-smoke-test-'));
  made.push(directory);
  return directory;
}

/**
 * A file that satisfies `verify-native-artifact.mjs`'s dmg check — a UDIF
 * `koly` trailer — without being a mountable image. That is deliberate: it lets
 * the argument and evidence-shape rules be tested without a real installer,
 * and the install step then honestly reports failure.
 */
function fakeDmg(directory: string, name = 'SimpleMark-0.1.0-macos-arm64.dmg'): string {
  const path = join(directory, name);
  const body = Buffer.alloc(2048, 7);
  const trailer = Buffer.alloc(512);
  trailer.write('koly', 0, 'ascii');
  writeFileSync(path, Buffer.concat([body, trailer]));
  return path;
}

function collect(args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

function evidenceOf(out: string) {
  return JSON.parse(readFileSync(out, 'utf8'));
}

afterEach(() => {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('refuses to be talked into a green result', () => {
  it('will not let a machine-measured check be attested', () => {
    const w = workspace();
    const result = collect([
      '--target', 'macos', '--artifact', fakeDmg(w), '--commit', SHA,
      '--out', join(w, 'e.json'), '--attest', 'install,open', '--tester', 'A Tester',
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('install and open are measured here and can never be attested');
  });

  it('refuses an anonymous attestation', () => {
    const w = workspace();
    const result = collect([
      '--target', 'macos', '--artifact', fakeDmg(w), '--commit', SHA,
      '--out', join(w, 'e.json'), '--attest', 'editSaveReopen',
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--attest requires --tester');
  });

  it('refuses an unknown check name rather than ignoring it', () => {
    const w = workspace();
    const result = collect([
      '--target', 'macos', '--artifact', fakeDmg(w), '--commit', SHA,
      '--out', join(w, 'e.json'), '--attest', 'everythingIsFine', '--tester', 'A Tester',
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('refused: everythingIsFine');
  });

  it('records unattested interaction checks as false, never absent', () => {
    const w = workspace();
    const out = join(w, 'e.json');
    collect(['--target', 'macos', '--artifact', fakeDmg(w), '--commit', SHA, '--out', out, '--skip-launch']);
    const evidence = evidenceOf(out);
    for (const check of ['openApprovedMarkdown', 'editSaveReopen', 'externalChangeHandled']) {
      expect(evidence.checks[check], check).toBe(false);
      expect(evidence.collection.checkMethod[check].by).toBe('unperformed');
    }
  }, COLLECTOR_INTEGRATION_TIMEOUT_MS);

  it('exits nonzero and says so when the evidence cannot pass the gate', () => {
    const w = workspace();
    const result = collect([
      '--target', 'macos', '--artifact', fakeDmg(w), '--commit', SHA,
      '--out', join(w, 'e.json'), '--skip-launch',
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('will NOT pass the release trust gate');
  }, COLLECTOR_INTEGRATION_TIMEOUT_MS);

  it('never reports a launch it did not attempt, and says why not', () => {
    const w = workspace();
    const out = join(w, 'e.json');
    // This artifact cannot mount, so install fails and the launch is never
    // reached. `open` must still be false with a reason — the invariant is that
    // a `true` here always means a process really ran, never that a step was
    // skipped. (A successful launch is exercised against a real installer;
    // no synthetic file can be mounted or executed.)
    collect(['--target', 'macos', '--artifact', fakeDmg(w), '--commit', SHA, '--out', out, '--skip-launch']);
    const evidence = evidenceOf(out);
    expect(evidence.checks.open).toBe(false);
    expect(evidence.collection.checkMethod.open.by).toBe('machine');
    expect(evidence.collection.checkMethod.open.detail).not.toBe('');
    expect(evidence.checks.install).toBe(false);
  }, COLLECTOR_INTEGRATION_TIMEOUT_MS);
});

describe('the facts it records are read off the artifact', () => {
  it('records the real SHA-256 of the bytes, not a supplied value', () => {
    const w = workspace();
    const artifact = fakeDmg(w);
    const out = join(w, 'e.json');
    collect(['--target', 'macos', '--artifact', artifact, '--commit', SHA, '--out', out, '--skip-launch']);
    const expected = createHash('sha256').update(readFileSync(artifact)).digest('hex');
    expect(evidenceOf(out).artifact.sha256).toBe(expected);
  }, COLLECTOR_INTEGRATION_TIMEOUT_MS);

  it('emits the schema and shape the trust gate reads', () => {
    const w = workspace();
    const out = join(w, 'e.json');
    collect(['--target', 'macos', '--artifact', fakeDmg(w), '--commit', SHA, '--out', out, '--skip-launch']);
    const evidence = evidenceOf(out);
    expect(evidence.schema).toBe('simplemark.platform-smoke.v1');
    expect(evidence.target).toBe('macos');
    expect(evidence.commit).toBe(SHA);
    expect(Object.keys(evidence.checks).sort()).toEqual(
      ['editSaveReopen', 'externalChangeHandled', 'install', 'open', 'openApprovedMarkdown'],
    );
    expect(Object.keys(evidence.trust).sort()).toEqual(['codeSigned', 'notarized', 'stapled']);
  }, COLLECTOR_INTEGRATION_TIMEOUT_MS);

  it('omits the trust block for Linux, which has no signing lane', () => {
    const w = workspace();
    const out = join(w, 'e.json');
    const appimage = join(w, 'SimpleMark-0.1.0-linux-x64.AppImage');
    const head = Buffer.alloc(64);
    head.write('\x7fELF', 0, 'binary');
    head[8] = 0x41; head[9] = 0x49; head[10] = 0x02;
    writeFileSync(appimage, head);
    collect(['--target', 'linux', '--artifact', appimage, '--commit', SHA, '--out', out, '--skip-launch']);
    expect(evidenceOf(out).trust).toBeUndefined();
  });
});

describe('argument validation', () => {
  it('rejects a target it cannot collect for', () => {
    const w = workspace();
    const result = collect(['--target', 'ios', '--artifact', fakeDmg(w), '--commit', SHA, '--out', join(w, 'e.json')]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--target macos, windows, or linux');
  });

  it('requires the exact 40-character canonical commit', () => {
    const w = workspace();
    for (const commit of ['', 'abc123', 'z'.repeat(40)]) {
      const result = collect(['--target', 'macos', '--artifact', fakeDmg(w), '--commit', commit, '--out', join(w, 'e.json')]);
      expect(result.status, commit).not.toBe(0);
      expect(result.stderr, commit).toContain('40-character');
    }
  });

  it('refuses an artifact that is not the installer it claims to be', () => {
    const w = workspace();
    const impostor = join(w, 'SimpleMark-0.1.0-macos-arm64.dmg');
    writeFileSync(impostor, Buffer.from('PK this is a zip, not a disk image'));
    const result = collect(['--target', 'macos', '--artifact', impostor, '--commit', SHA, '--out', join(w, 'e.json')]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('not an Apple disk image');
  });

  it('refuses an artifact that does not exist', () => {
    const w = workspace();
    const result = collect(['--target', 'macos', '--artifact', join(w, 'nope.dmg'), '--commit', SHA, '--out', join(w, 'e.json')]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('does not exist');
  });
});
