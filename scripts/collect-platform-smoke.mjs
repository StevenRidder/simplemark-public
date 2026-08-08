#!/usr/bin/env node

// Produces the `simplemark.platform-smoke.v1` evidence that
// `scripts/verify-release-trust.mjs` consumes and `release-promote.yml`
// downloads from the draft. Until this existed the gate could never pass:
// the schema was defined, verified, and fixture-tested, but nothing wrote one.
//
// `docs/RELEASE-TRUST.md` frames this as "a tester creates one JSON file". This
// keeps that model and narrows it, because a hand-written JSON file is exactly
// the thing that drifts from the bytes it claims to describe:
//
//   - Everything a machine can check, a machine checks here. The SHA-256 is read
//     off the artifact, the container type is asserted by
//     `verify-native-artifact.mjs`, the installer is really installed, the
//     application is really launched, and macOS/Windows signing state is really
//     queried from the OS.
//   - Everything else — the three checks that need a human driving a window —
//     is recorded only when a named tester attests to it, and is marked as
//     attested rather than measured.
//
// What it will not do is write `true` for a check it did not perform. A gate
// that can be satisfied by an optimistic JSON file is worse than no gate,
// because it converts missing evidence into a green result — the exact failure
// `RELEASE-CONTRACT.md` §10 forbids. Unperformed checks stay `false` and the
// trust gate fails closed on them, by design.
//
// Usage:
//   node scripts/collect-platform-smoke.mjs \
//     --target macos --artifact SimpleMark-0.1.0-macos-arm64.dmg \
//     --commit <40-char-sha> --out platform-smoke-macos.json \
//     [--attest openApprovedMarkdown,editSaveReopen,externalChangeHandled] \
//     [--tester "Name <email>"] [--launch-seconds 8] [--skip-launch]

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const TARGETS = new Set(['macos', 'windows', 'linux']);

// The five checks `verify-release-trust.mjs` requires, split by what can
// honestly produce them.
const MACHINE_CHECKS = ['install', 'open'];
const ATTESTABLE_CHECKS = ['openApprovedMarkdown', 'editSaveReopen', 'externalChangeHandled'];

// Trust entries per target, and whether this host can measure them.
const TRUST_CHECKS = {
  macos: ['codeSigned', 'notarized', 'stapled'],
  windows: ['codeSigned', 'signatureVerified'],
  linux: [],
};

function fail(message) {
  process.stderr.write(`platform-smoke: ${message}\n`);
  process.exitCode = 1;
}

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function flag(name) {
  return process.argv.includes(name);
}

function list(value) {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

function sha256(path) {
  const hash = createHash('sha256');
  const fd = readFileSync(path);
  hash.update(fd);
  return hash.digest('hex');
}

/**
 * The container-type assertion is not reimplemented here. `verify-native-artifact.mjs`
 * already reads the bytes and names what they really are, and a second
 * implementation is a second thing to drift.
 */
function verifyContainer(target, artifact) {
  const result = run(process.execPath, [
    join(import.meta.dirname, 'verify-native-artifact.mjs'),
    '--target', target, '--artifact', artifact,
  ]);
  return { ok: result.ok, detail: result.ok ? result.stdout : (result.stderr || 'container check failed') };
}

/** Launch a binary, hold it briefly, and require that it is still alive. */
function launchAndHold(command, args, seconds, env = {}) {
  // A GUI process that exits immediately has not "opened" in any sense a user
  // would recognise, so staying alive for the hold window is the check.
  const script = `"$1" "${'$'}{@:2}" & pid=$!; sleep ${seconds}; `
    + 'if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; exit 0; else exit 1; fi';
  const result = run('bash', ['-c', script, 'bash', command, ...args], {
    env: { ...process.env, ...env },
    timeout: (Number(seconds) + 30) * 1000,
  });
  return result.ok
    ? { ok: true, detail: `process stayed alive for ${seconds}s and terminated cleanly` }
    : { ok: false, detail: `process did not stay alive for ${seconds}s: ${result.stderr || 'exited early'}` };
}

// --- macOS -----------------------------------------------------------------

function macosInstall(artifact, staging) {
  const mount = join(staging, 'mnt');
  const attach = run('hdiutil', ['attach', artifact, '-nobrowse', '-readonly', '-mountpoint', mount]);
  if (!attach.ok) return { ok: false, detail: `hdiutil attach failed: ${attach.stderr}` };

  try {
    const app = readdirSync(mount).find((entry) => entry.endsWith('.app'));
    if (!app) return { ok: false, detail: `no .app bundle inside ${basename(artifact)}` };

    const installed = join(staging, app);
    const copy = run('cp', ['-R', join(mount, app), installed]);
    if (!copy.ok) return { ok: false, detail: `copying ${app} out of the image failed: ${copy.stderr}` };

    const macos = join(installed, 'Contents', 'MacOS');
    const binary = existsSync(macos) ? readdirSync(macos)[0] : undefined;
    if (!binary) return { ok: false, detail: `${app} has no Contents/MacOS executable` };

    return { ok: true, detail: `mounted, copied ${app}, found Contents/MacOS/${binary}`, app: installed, binary: join(macos, binary) };
  } finally {
    run('hdiutil', ['detach', mount, '-quiet']);
  }
}

function macosTrust(appPath) {
  // Real queries against the OS, not claims. `codesign` proves a signature,
  // `spctl` proves Gatekeeper would accept it, `stapler` proves the
  // notarization ticket is attached to the artifact itself.
  const signed = run('codesign', ['--verify', '--deep', '--strict', appPath]);
  const assess = run('spctl', ['--assess', '--type', 'execute', appPath]);
  const staple = run('xcrun', ['stapler', 'validate', appPath]);
  return {
    codeSigned: { ok: signed.ok, detail: signed.ok ? 'codesign --verify --deep --strict passed' : (signed.stderr || 'codesign failed') },
    notarized: { ok: assess.ok, detail: assess.ok ? 'spctl --assess accepted the bundle' : (assess.stderr || 'spctl rejected the bundle') },
    stapled: { ok: staple.ok, detail: staple.ok ? 'stapler validate found a ticket' : (staple.stderr || 'no stapled ticket') },
  };
}

// --- Linux -----------------------------------------------------------------

function linuxInstall(artifact, staging) {
  const installed = join(staging, basename(artifact));
  copyFileSync(artifact, installed);
  chmodSync(installed, 0o755);
  if (!(statSync(installed).mode & 0o111)) return { ok: false, detail: 'the AppImage is not executable after chmod' };

  // Unpacking proves the payload is a real, readable SquashFS rather than an
  // ELF stub that happens to carry the AppImage magic.
  const extract = run(installed, ['--appimage-extract', 'AppRun'], { cwd: staging });
  if (!extract.ok) return { ok: false, detail: `--appimage-extract failed: ${extract.stderr || extract.stdout}` };

  return { ok: true, detail: 'copied, made executable, and --appimage-extract produced a readable payload', binary: installed };
}

// --- Windows ---------------------------------------------------------------

function windowsInstall(artifact, staging) {
  const name = basename(artifact);
  if (name.endsWith('.msi')) {
    const target = join(staging, 'app');
    const install = run('msiexec', ['/a', artifact, '/qn', `TARGETDIR=${target}`]);
    if (!install.ok) return { ok: false, detail: `msiexec administrative install failed: ${install.stderr || install.stdout}` };
    const exe = findExecutable(target);
    if (!exe) return { ok: false, detail: 'the MSI unpacked but produced no .exe' };
    return { ok: true, detail: `msiexec unpacked the package; found ${basename(exe)}`, binary: exe };
  }

  const target = join(staging, 'app');
  const install = run(artifact, ['/S', `/D=${target}`]);
  if (!install.ok) return { ok: false, detail: `silent NSIS install failed: ${install.stderr || install.stdout}` };
  const exe = findExecutable(target);
  if (!exe) return { ok: false, detail: 'the installer ran but produced no .exe' };
  return { ok: true, detail: `silent install produced ${basename(exe)}`, binary: exe };
}

function findExecutable(root) {
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.name.toLowerCase().endsWith('.exe')) return path;
    }
  }
  return undefined;
}

function windowsTrust(path) {
  const query = run('powershell', ['-NoProfile', '-Command',
    `(Get-AuthenticodeSignature -LiteralPath '${path}').Status`]);
  const valid = query.ok && query.stdout.trim() === 'Valid';
  const detail = query.ok ? `Get-AuthenticodeSignature reported ${query.stdout.trim()}` : (query.stderr || 'signature query failed');
  return { codeSigned: { ok: valid, detail }, signatureVerified: { ok: valid, detail } };
}

// --- collection ------------------------------------------------------------

function collect({ target, artifact, seconds, skipLaunch }) {
  const results = { install: { ok: false, detail: 'not attempted' }, open: { ok: false, detail: 'not attempted' } };
  const staging = mkdtempSync(join(tmpdir(), 'simplemark-smoke-'));

  try {
    const installer = target === 'macos' ? macosInstall : target === 'linux' ? linuxInstall : windowsInstall;
    const installed = installer(artifact, staging);
    results.install = { ok: installed.ok, detail: installed.detail };

    if (!installed.ok) return { results, trust: {}, staging };

    if (skipLaunch) {
      results.open = { ok: false, detail: '--skip-launch was passed, so launching was never attempted' };
    } else if (target === 'linux' && !process.env.DISPLAY) {
      // Honest about the environment rather than quietly passing.
      results.open = { ok: false, detail: 'no DISPLAY: a windowed launch cannot be proven headless; run under xvfb-run' };
    } else {
      results.open = launchAndHold(installed.binary, [], seconds);
    }

    const trust = target === 'macos'
      ? macosTrust(installed.app)
      : target === 'windows'
        ? windowsTrust(installed.binary)
        : {};

    return { results, trust, staging };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function main() {
  const target = option('--target');
  const artifactOption = option('--artifact');
  const commit = option('--commit');
  const out = option('--out');
  const tester = option('--tester');
  const attested = list(option('--attest'));
  const seconds = Number(option('--launch-seconds', '8'));

  if (!TARGETS.has(target)) return fail(`pass --target macos, windows, or linux`);
  if (!artifactOption) return fail('pass --artifact <installer>');
  if (!/^[0-9a-f]{40}$/i.test(commit)) return fail('pass --commit <40-character canonical commit sha>');
  if (!out) return fail('pass --out <platform-smoke-<target>.json>');

  const artifact = resolve(artifactOption);
  if (!existsSync(artifact)) return fail(`${artifact} does not exist`);

  const unknown = attested.filter((check) => !ATTESTABLE_CHECKS.includes(check));
  if (unknown.length) {
    return fail(`--attest only accepts ${ATTESTABLE_CHECKS.join(', ')}; refused: ${unknown.join(', ')}`
      + (unknown.some((check) => MACHINE_CHECKS.includes(check))
        ? ' — install and open are measured here and can never be attested'
        : ''));
  }
  if (attested.length && !tester) return fail('--attest requires --tester "Name <email>": an attestation without an attester is anonymous and unfalsifiable');

  const container = verifyContainer(target, artifact);
  if (!container.ok) return fail(container.detail);

  const { results, trust } = collect({ target, artifact, seconds, skipLaunch: flag('--skip-launch') });

  const checks = {};
  const method = {};
  for (const check of MACHINE_CHECKS) {
    checks[check] = results[check].ok;
    method[check] = { by: 'machine', detail: results[check].detail };
  }
  for (const check of ATTESTABLE_CHECKS) {
    const claimed = attested.includes(check);
    checks[check] = claimed;
    method[check] = claimed
      ? { by: 'attested', detail: `attested by ${tester}` }
      : { by: 'unperformed', detail: 'not attested; the trust gate fails closed on this' };
  }

  const trustBlock = {};
  const trustMethod = {};
  for (const check of TRUST_CHECKS[target]) {
    trustBlock[check] = trust[check]?.ok === true;
    trustMethod[check] = { by: 'machine', detail: trust[check]?.detail ?? 'not measured' };
  }

  const evidence = {
    schema: 'simplemark.platform-smoke.v1',
    target,
    commit: commit.toLowerCase(),
    artifact: { name: basename(artifact), sha256: sha256(artifact) },
    checks,
    ...(TRUST_CHECKS[target].length ? { trust: trustBlock } : {}),
    // Not read by verify-release-trust.mjs. It is here so a human reviewing the
    // draft can see how each `true` was arrived at, and so a `false` says why.
    collection: {
      schema: 'simplemark.platform-smoke-collection.v1',
      collectedOn: process.platform,
      tester: tester || null,
      checkMethod: method,
      ...(TRUST_CHECKS[target].length ? { trustMethod } : {}),
    },
  };

  writeFileSync(resolve(out), `${JSON.stringify(evidence, null, 2)}\n`);

  const failed = Object.entries(checks).filter(([, value]) => !value).map(([name]) => name);
  const failedTrust = Object.entries(trustBlock).filter(([, value]) => !value).map(([name]) => name);
  process.stdout.write(`platform-smoke: wrote ${out} for ${target}\n`);
  for (const [name, value] of Object.entries(checks)) {
    process.stdout.write(`  ${value ? 'pass' : 'FAIL'} ${name.padEnd(22)} ${method[name].detail}\n`);
  }
  for (const [name, value] of Object.entries(trustBlock)) {
    process.stdout.write(`  ${value ? 'pass' : 'FAIL'} trust.${name.padEnd(16)} ${trustMethod[name].detail}\n`);
  }

  if (failed.length || failedTrust.length) {
    process.stderr.write(
      `platform-smoke: this evidence will NOT pass the release trust gate — ${[...failed, ...failedTrust.map((n) => `trust.${n}`)].join(', ')}\n`,
    );
    process.exitCode = 1;
  }
}

main();
