import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

/**
 * The gate that stops a mac-only capability vanishing silently.
 *
 * `build.rs` degrades to a warning when the Swift toolchain cannot build the
 * Foundation Models bridge, so a leg without the macOS 26 SDK produces a green
 * build and a DMG with no note summaries in it. This script is what turns that
 * into a red build, which makes its own failure modes worth pinning down.
 */
const SCRIPT = 'scripts/verify-native-capabilities.mjs'

/**
 * The floor check reads Mach-O load commands with `otool`, which exists only
 * on macOS. The gate runs on Linux, so those two assertions are skipped there
 * rather than being weakened to something that passes everywhere — the script
 * is only ever invoked on the macOS legs, where the tooling is present.
 *
 * Everything else here is platform-independent on purpose: argument handling,
 * the leg-to-capability mapping, and failing closed on a missing file are the
 * parts most likely to rot, and they run on every runner.
 */
const onMacos = process.platform === 'darwin'

function run(args: readonly string[]): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' })
    return { status: 0, output }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    }
  }
}

describe('verify-native-capabilities', () => {
  it.runIf(onMacos)('fails when a leg that owes a capability does not have it', () => {
    // /bin/ls is a real Mach-O binary with no bridge in it, which is exactly
    // what a silently degraded SimpleMark build looks like.
    const { status, output } = run(['--binary', '/bin/ls', '--leg', 'macos-arm64'])

    expect(status).toBe(1)
    expect(output).toContain('note-summaries is MISSING')
    expect(output).toContain('_simplemark_intelligence_available')
  })

  // Apple Intelligence requires Apple silicon, so its absence on these legs is
  // the truth rather than a regression. Asserting it there would be a lie that
  // could only ever be silenced by weakening the gate.
  it.each(['macos-x64', 'windows-x64', 'linux-x64'])('owes nothing on %s', (leg) => {
    const { status, output } = run(['--binary', '/bin/ls', '--leg', leg])

    expect(status).toBe(0)
    expect(output).toContain('owes no native capabilities')
  })

  it('fails closed when the binary does not exist', () => {
    const { status, output } = run(['--binary', '/nonexistent', '--leg', 'macos-arm64'])

    expect(status).toBe(1)
    expect(output).toContain('does not exist')
  })

  it.runIf(onMacos)('fails when a mac-only capability has raised the runtime floor', () => {
    // The failure this catches: linking a framework built against a newer SDK
    // pushes the binary's minimum macOS up, and every older Mac stops
    // launching the app at all.
    const { status, output } = run([
      '--binary',
      '/bin/ls',
      '--leg',
      'macos-x64',
      '--max-minos',
      '1.0',
    ])

    expect(status).toBe(1)
    expect(output).toContain('above the contracted floor')
  })

  it.runIf(onMacos)('accepts a binary that sits at or below the floor', () => {
    const { status, output } = run([
      '--binary',
      '/bin/ls',
      '--leg',
      'macos-x64',
      '--max-minos',
      '99.0',
    ])

    expect(status).toBe(0)
    expect(output).toContain('minimum macOS')
  })
})
