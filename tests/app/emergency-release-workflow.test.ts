import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The emergency lane is a sanctioned bypass, so what has to be pinned is not
// that it is strict — it is deliberately not — but that using it is impossible
// to hide. `release.yml` has always allowed a `v*` tag on any branch, because
// only `main` is protected and the tag trigger has no branch filter. This lane
// replaces that accident with something that states, in the release itself,
// what was skipped and who chose to skip it.
//
// GitHub cannot express a weaker path *into* `main` — protection and rulesets
// key on the target ref, never the source — so this is the only shape a second
// path can honestly take.

const workflow = readFileSync(
  join(process.cwd(), '.github', 'workflows', 'emergency-release.yml'),
  'utf8',
);
const release = readFileSync(
  join(process.cwd(), '.github', 'workflows', 'release.yml'),
  'utf8',
);

/** The workflow with comment lines removed, for "must not contain" checks. */
function code(source: string): string {
  return source.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
}

describe('the bypass is available', () => {
  it('is manual only, and cannot be triggered by a push or a tag', () => {
    const block = workflow.split(/^on:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';
    const triggers = block
      .split('\n')
      .filter((line) => /^ {2}\S/.test(line))
      .map((line) => line.trim().replace(/:.*$/, ''));
    expect(triggers).toEqual(['workflow_dispatch']);
  });

  it('builds from an arbitrary ref, which is the entire point', () => {
    expect(workflow).toContain('ref: ${{ inputs.ref }}');
  });

  it('lets the gate be skipped', () => {
    expect(workflow).toContain('run_gate');
    expect(workflow).toContain('if: ${{ inputs.run_gate }}');
  });

  it('still builds all four contracted platforms', () => {
    for (const leg of ['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64']) {
      expect(workflow).toContain(`leg: ${leg}`);
    }
    expect(code(workflow)).not.toMatch(/-latest/);
  });
});

describe('the bypass cannot be hidden', () => {
  it('requires a reason and refuses an empty one', () => {
    expect(workflow).toContain('reason:');
    expect(workflow).toMatch(/required: true/);
    expect(workflow).toContain('must actually say why');
  });

  it('puts the skipped gate in the release title, not only the body', () => {
    expect(workflow).toContain('EMERGENCY, GATE SKIPPED');
  });

  it('records ref, gate state, dispatcher and reason in the release body', () => {
    expect(workflow).toContain('Built through the emergency lane');
    expect(workflow).toContain('github.actor');
    expect(workflow).toContain('inputs.reason');
    expect(workflow).toContain('SKIPPED — this build is unverified');
  });

  it('tests whether the commit reached main rather than asserting it', () => {
    expect(workflow).toContain('git merge-base --is-ancestor');
    expect(workflow).toContain('this commit is not on');
  });
});

describe('what it still refuses to do', () => {
  it('never publishes — promotion remains gated', () => {
    expect(workflow).toContain('--draft');
    expect(code(workflow)).not.toMatch(/--draft[= ]false|gh release edit/);
  });

  it('never skips the version check, which is correctness rather than CI', () => {
    expect(workflow).toContain('scripts/assert-release-version.mjs');
    const version = workflow.split(/^ {2}version:$/m)[1]?.split(/^ {2}\w/m)[0] ?? '';
    expect(version).not.toContain('inputs.run_gate');
  });

  it('still asserts artifact type by reading the bytes', () => {
    expect(workflow).toContain('scripts/verify-native-artifact.mjs');
  });

  it('stops on a gate that actually failed, and only continues past a skipped one', () => {
    expect(workflow).toContain("needs.gate.result != 'failure'");
    expect(workflow).toContain("needs.gate.result != 'cancelled'");
  });

  it('elevates once, inside the protected environment', () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(code(workflow).match(/contents: write/g)).toHaveLength(1);
    expect(workflow).toContain('environment: release-signing');
    expect(code(workflow)).not.toMatch(/id-token|packages:|pull-requests:|actions: write/);
  });

  it('leaves the normal lane untouched — it still has no bypass input', () => {
    expect(release).not.toContain('run_gate');
    expect(release).not.toContain('workflow_dispatch');
  });
});
