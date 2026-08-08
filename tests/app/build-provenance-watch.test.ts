import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * What `build.rs` watches, tested against real git rather than a description of
 * git.
 *
 * The bug this pins down shipped a bundle that named a commit it did not
 * contain. `build.rs` registered `rerun-if-changed` on the literal
 * `../.git/HEAD`; in a linked worktree `.git` is a *file*, so that path never
 * existed, no watch was registered, and cargo reused the cached build script
 * output indefinitely — every later build carried the first build's commit.
 * This project runs a worktree per task, so that was the common path.
 *
 * The assertions below are deliberately about git's own behaviour: the point is
 * that the old approach is structurally unable to work in a worktree, and that
 * `--git-path` is what fixes it, not that some string appears in a file.
 */

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' },
  }).trim()

let root: string
let checkout: string
let worktree: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'sm-provenance-'))
  checkout = join(root, 'checkout')
  worktree = join(root, 'linked')

  execFileSync('git', ['init', '-b', 'main', checkout], { stdio: 'ignore' })
  writeFileSync(join(checkout, 'a.txt'), 'one')
  git(checkout, 'add', '.')
  git(checkout, 'commit', '-m', 'first')
  git(checkout, 'worktree', 'add', '-b', 'task', worktree)
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('build.rs rebuild watches', () => {
  it('confirms the old path works in a plain checkout — which is why it looked fine', () => {
    expect(existsSync(join(checkout, '.git', 'HEAD'))).toBe(true)
  })

  it('confirms the old path is structurally absent in a worktree', () => {
    // `.git` here is a file naming the real gitdir, so `.git/HEAD` is not a path.
    expect(statSync(join(worktree, '.git')).isFile()).toBe(true)
    expect(existsSync(join(worktree, '.git', 'HEAD'))).toBe(false)
  })

  it('resolves HEAD in both layouts via --git-path, which is the fix', () => {
    for (const tree of [checkout, worktree]) {
      const head = git(tree, 'rev-parse', '--git-path', 'HEAD')
      // `resolve`, not `join`: git answers relative to the caller's directory in
      // a plain checkout and absolutely in a worktree, and both are correct.
      // cargo reads a relative `rerun-if-changed` against the package root,
      // which is exactly the directory build.rs runs in, so both land right.
      expect(existsSync(resolve(tree, head))).toBe(true)
    }
  })

  it('returns a relative path in a checkout and an absolute one in a worktree', () => {
    // The asymmetry is the reason a hand-written path cannot cover both cases.
    expect(isAbsolute(git(checkout, 'rev-parse', '--git-path', 'HEAD'))).toBe(false)
    expect(isAbsolute(git(worktree, 'rev-parse', '--git-path', 'HEAD'))).toBe(true)
  })

  it('resolves the branch tip, so a commit on the current branch is noticed', () => {
    // HEAD is a symref; committing moves the ref while HEAD's bytes stay put.
    for (const tree of [checkout, worktree]) {
      const reference = git(tree, 'symbolic-ref', '--quiet', 'HEAD')
      const tip = git(tree, 'rev-parse', '--git-path', reference)
      expect(existsSync(resolve(tree, tip))).toBe(true)
    }
  })

  it('gives each worktree its own HEAD but one shared refs store', () => {
    const headOf = (tree: string) => git(tree, 'rev-parse', '--git-path', 'HEAD')
    expect(headOf(checkout)).not.toBe(headOf(worktree))

    const common = (tree: string) => git(tree, 'rev-parse', '--git-common-dir')
    expect(git(checkout, 'rev-parse', '--absolute-git-dir')).not.toBe(
      git(worktree, 'rev-parse', '--absolute-git-dir'),
    )
    expect(common(checkout)).toBeTruthy()
  })

  it('no longer hardcodes a path that only exists in a plain checkout', () => {
    const source = readFileSync(join(process.cwd(), 'src-tauri', 'build.rs'), 'utf8')
    expect(source).not.toContain('"../.git/HEAD"')
    expect(source).toContain('--git-path')
  })
})
