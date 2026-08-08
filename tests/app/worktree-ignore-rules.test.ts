import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// A task worktree links these paths at the shared checkout's copy rather than
// paying for a second `npm ci` or a second full Rust build. A trailing slash in
// .gitignore matches directories only, so the links were not ignored and
// `git add -A` committed them as mode-120000 blobs. CI recreated the link at
// checkout, the install step replaced it with a real directory, and the dirty
// tree failed the gate several steps later inside the mirror machinery.
const linkedPaths = ['node_modules', 'src-tauri/target', '.worktrees'];

let repository: string;

function git(...args: string[]) {
  return spawnSync('git', ['-C', repository, ...args], { encoding: 'utf8' });
}

beforeAll(() => {
  repository = mkdtempSync(join(tmpdir(), 'simplemark-ignore-rules-'));
  git('init', '--quiet');
  const ignoreFile = join(repository, '.gitignore');
  copyFileSync(join(process.cwd(), '.gitignore'), ignoreFile);
  for (const path of linkedPaths) {
    const link = join(repository, path);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(ignoreFile, link);
  }
});

describe('worktree ignore rules', () => {
  it.each(linkedPaths)('ignores %s when a worktree links it instead of holding a directory', (path) => {
    expect(git('check-ignore', path).status).toBe(0);
  });

  it('stages none of those links on git add -A', () => {
    git('add', '-A');
    const staged = git('ls-files').stdout.split('\n').filter(Boolean);
    expect(staged).toEqual(['.gitignore']);
  });
});
