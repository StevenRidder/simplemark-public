#!/usr/bin/env node

// Native capabilities are asserted, not assumed.
//
// `verify-native-artifact.mjs` makes the same argument about container format:
// a name ending in `.dmg` is a different question from whether the bytes are a
// disk image, so it reads the signature instead of trusting the suffix. This
// asks the equivalent question one level in — the build was green, but does
// this binary actually contain the capability the leg promised?
//
// It matters because the failure is silent by design. `build.rs` degrades to a
// warning when the Swift toolchain cannot produce the Foundation Models
// bridge, which is correct for a contributor on an older Mac and catastrophic
// for a release: the DMG builds, CI is green, and note summaries are simply
// gone. That is the shape of the Graphviz CSP defect, where a rule that only
// applied in packaged builds was missed by dev, vitest and Playwright alike.
//
// Usage:
//   node scripts/verify-native-capabilities.mjs --binary <path> --expect note-summaries
//   node scripts/verify-native-capabilities.mjs --binary <path> --leg macos-arm64

import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * What each capability looks like once linked, and which build legs owe it.
 *
 * A leg that is not listed owes nothing: Apple Intelligence requires Apple
 * silicon, so its absence on `macos-x64`, Windows and Linux is the truth
 * rather than a regression to catch.
 */
const CAPABILITIES = {
  'note-summaries': {
    symbol: '_simplemark_intelligence_available',
    requiredOn: ['macos-arm64'],
    why: 'Foundation Models bridge (src-tauri/swift/SimpleMarkIntelligence.swift)',
  },
};

function fail(message) {
  process.stderr.write(`native-capabilities: ${message}\n`);
  process.exitCode = 1;
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : (process.argv[index + 1] ?? '');
}

/**
 * Symbols the linker actually kept, or null if they cannot be read.
 *
 * `maxBuffer` is set explicitly and generously. Node's default is 1 MiB and a
 * debug build of this crate is ~38 MB, so `nm` overflows it and `execFileSync`
 * throws — which the first version of this script reported as "could not read
 * symbols" on a binary that was in fact perfectly good. A verifier that fails
 * open is worse than no verifier, so the two failure modes are now distinct:
 * this returns null only when `nm` genuinely could not run.
 */
function definedSymbols(binary) {
  try {
    // `-U` suppresses undefined symbols: a capability that is merely
    // referenced is not a capability that is present.
    return execFileSync('nm', ['-gU', binary], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    // A non-zero exit that still produced output is usable — `nm` warns about
    // sections it cannot parse while listing everything else fine.
    const partial = typeof error?.stdout === 'string' ? error.stdout : '';
    return partial === '' ? null : partial;
  }
}

/**
 * The lowest macOS this binary will launch on, or null if unreadable.
 *
 * A mac-only capability must not raise the floor for everyone. The Swift
 * bridge is compiled against `arm64-apple-macosx26.0`, and if that propagated
 * to the final link every Mac below macOS 26 would refuse to start the app —
 * the same class of failure the `ubuntu-22.04` pin in RELEASE-CONTRACT.md §3
 * exists to prevent, where a newer build environment silently strands older
 * targets. It currently does not propagate. This asserts that rather than
 * trusting it to stay true.
 */
function minimumMacos(binary) {
  try {
    const load = execFileSync('otool', ['-l', binary], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // Two spellings, and Intel builds use the older one. `LC_BUILD_VERSION`
    // carries `minos`; `LC_VERSION_MIN_MACOSX` carries `version`. Matching only
    // the first reported "could not read the minimum macOS version" on a
    // perfectly good x86_64 binary.
    const match =
      load.match(/LC_BUILD_VERSION[\s\S]{0,200}?minos\s+([0-9]+(?:\.[0-9]+)*)/) ??
      load.match(/LC_VERSION_MIN_MACOSX[\s\S]{0,200}?version\s+([0-9]+(?:\.[0-9]+)*)/);
    return match === null ? null : match[1];
  } catch {
    return null;
  }
}

function main() {
  const binary = option('--binary');
  const leg = option('--leg');
  const maxMinos = option('--max-minos');
  const expected = process.argv
    .flatMap((argument, index) => (argument === '--expect' ? [process.argv[index + 1]] : []))
    .filter((name) => name !== undefined);

  if (binary === '') {
    fail('pass --binary <path>');
    return;
  }

  const path = resolve(binary);
  try {
    if (!statSync(path).isFile()) {
      fail(`${binary} is not a file`);
      return;
    }
  } catch {
    fail(`${binary} does not exist`);
    return;
  }

  // Explicit --expect wins; otherwise the leg decides what it owes.
  const required =
    expected.length > 0
      ? expected
      : Object.entries(CAPABILITIES)
          .filter(([, capability]) => capability.requiredOn.includes(leg))
          .map(([name]) => name);

  if (maxMinos !== '') {
    const minos = minimumMacos(path);
    if (minos === null) {
      fail(`could not read the minimum macOS version from ${binary}`);
    } else if (Number.parseFloat(minos) > Number.parseFloat(maxMinos)) {
      fail(
        `${binary} requires macOS ${minos}, above the contracted floor of ${maxMinos}. ` +
          'A mac-only capability has raised the minimum for every user. Check that the Swift ' +
          "bridge's deployment target has not propagated to the final link.",
      );
    } else {
      process.stdout.write(`native-capabilities: minimum macOS ${minos} (floor ${maxMinos})\n`);
    }
  }

  if (required.length === 0) {
    process.stdout.write(
      `native-capabilities: ${leg || 'this leg'} owes no native capabilities — nothing to assert\n`,
    );
    return;
  }

  const symbols = definedSymbols(path);
  if (symbols === null) {
    fail(`could not read symbols from ${binary}; nm is required to assert capabilities`);
    return;
  }

  for (const name of required) {
    const capability = CAPABILITIES[name];
    if (capability === undefined) {
      fail(`unknown capability "${name}"`);
      continue;
    }
    if (symbols.includes(capability.symbol)) {
      process.stdout.write(`native-capabilities: ${name} present (${capability.symbol})\n`);
      continue;
    }
    fail(
      `${name} is MISSING from ${binary}. Expected symbol ${capability.symbol} — ${capability.why}. ` +
        'The build succeeded without it, which means it degraded silently. ' +
        'Set SIMPLEMARK_REQUIRE_INTELLIGENCE=1 on this leg to turn that into a build failure, ' +
        'and check the runner image provides the macOS 26 SDK.',
    );
  }
}

main();
