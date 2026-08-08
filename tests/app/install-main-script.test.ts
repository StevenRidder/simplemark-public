import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `scripts/install-main.sh` cannot be executed in the gate — it compiles a Rust
 * binary and writes to /Applications, neither of which belongs in CI, and CI
 * runs on Linux where the bundle does not exist. What the gate can hold is the
 * script's contract, which is the part that would hurt if it quietly changed:
 * it must build the resolved commit rather than the working checkout, and it
 * must not destroy a working app for a build that did not happen.
 */

const script = readFileSync(join(process.cwd(), 'scripts', 'install-main.sh'), 'utf8')

/** The script with comments removed — it explains its refusals in prose. */
const code = script
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')

describe('scripts/install-main.sh', () => {
  it('is executable, or nobody can run it', () => {
    const mode = statSync(join(process.cwd(), 'scripts', 'install-main.sh')).mode
    expect(mode & 0o111).toBeGreaterThan(0)
  })

  it('fails loudly rather than continuing past an error', () => {
    expect(code).toMatch(/set -euo pipefail/)
  })

  it('builds the commit it resolved, not whichever worktree it was run from', () => {
    // This machine carries a worktree per task; "build here" would produce a
    // bundle that cannot honestly be called main.
    expect(code).toMatch(/rev-parse "\$REF"/)
    expect(code).toMatch(/worktree add --detach "\$BUILD_DIR" "\$SHA"/)
    // And it re-checks, because creating a worktree is not proof of its head.
    expect(code).toMatch(/\[ "\$built_sha" = "\$SHA" \]/)
    expect(code).toMatch(/status --porcelain/)
  })

  it('stamps that commit into the bundle so the app can report it', () => {
    expect(code).toMatch(/SIMPLEMARK_BUILD_SHA="\$SHA" npm run build:native/)
  })

  it('never removes the installed app before a verified new bundle exists', () => {
    const stage = code.indexOf('ditto "$BUNDLE" "$STAGED"')
    const remove = code.indexOf('rm -rf "$TARGET"')
    expect(stage).toBeGreaterThan(-1)
    expect(remove).toBeGreaterThan(-1)
    // Staging must come first: a copy that dies midway must not already have
    // deleted the app you were using.
    expect(stage).toBeLessThan(remove)
    // And the bundle is checked for real before anything is replaced.
    expect(code.indexOf('[ -x "$BUNDLE/Contents/MacOS/simplemark" ]')).toBeLessThan(remove)
  })

  it('refuses to replace a bundle that is currently running', () => {
    // Scoped to the bundle being replaced, not to any SimpleMark on the
    // machine — a build running from a worktree threatens nothing here, and a
    // refusal that fires when nothing is at risk is one people route around.
    expect(code).toMatch(/pgrep -f "\^\$\{TARGET\}\/Contents\/MacOS\/simplemark"/)
    // Checked again immediately before the swap, not only at startup.
    const checks = code.match(/refuse_if_running/g) ?? []
    expect(checks.length).toBeGreaterThanOrEqual(3)
  })

  it('names the real fix when the toolchain is missing', () => {
    // The rustup shims are absent on the build machine, so "cargo: command not
    // found" is the most likely failure and the least useful message.
    expect(code).toMatch(/rustup default stable/)
    expect(code).toMatch(/\.rustup\/toolchains\/\*\/bin/)
  })

  it('does not download or install anything on its own', () => {
    // Auto-update is out of scope; this builds from a repo you already have.
    expect(code).not.toMatch(/curl|wget|softwareupdate/)
  })
})
