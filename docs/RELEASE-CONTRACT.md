# The SimpleMark release contract

What any SimpleMark build-and-release workflow must do. This is a contract, not a
workflow: it fixes the target matrix, triggers, artifact names, checksums, retention,
permissions, release-note inputs, failure behavior, and required secrets, so that the
workflows implementing it can be reviewed against something specific.

This document added no workflow file of its own. When it was written `src-tauri/` did not
exist on `main` — APP-2 owns the real Tauri configuration and native bundle — and a release
workflow written against a configuration that is not merged could only be a placeholder that
succeeds without building anything. That is exactly what this contract forbids. The board
tasks that add the executable wiring are listed in §12; APP-5 has since landed the
pull-request lane as
[`.github/workflows/native-testbuild.yml`](../.github/workflows/native-testbuild.yml).

### Relationship to `RELEASE-TRUST.md`

[`docs/RELEASE-TRUST.md`](RELEASE-TRUST.md) is APP-6's contract, and unlike this one it is
already executable: `scripts/verify-release-trust.mjs` and
[`.github/actions/release-trust-gate/action.yml`](../.github/actions/release-trust-gate/action.yml)
enforce it, with `tests/app/release-trust-gates.test.ts` covering it. The division, in its
words, is that APP-6 owns the public-release **trust boundary** while APP-4 owns the
**workflow structure**.

| Question | Answered by |
|---|---|
| Which platforms, triggers, artifact names, retention, permissions, failure rules | this file |
| Whether a built artifact may reach the public | `RELEASE-TRUST.md` |
| Which signing and notarization secrets exist and what they are named | `RELEASE-TRUST.md` |
| What smoke evidence each platform must produce | `RELEASE-TRUST.md` |

Where the two touch, this file defers. §11 points at that document rather than copying its
secret table, because a second copy of a secret name is a copy that will go stale.

## 1. Scope

In scope — four desktop installer targets for the one shared application:

| Platform | Architecture |
|---|---|
| macOS | arm64 (Apple Silicon) |
| macOS | x86_64 (Intel) |
| Windows | x86_64 |
| Linux | x86_64 |

Out of scope, with what would have to be true first:

- **iOS.** APP-2's configuration has no iOS target, and iOS needs provisioning profiles,
  a distribution certificate, and an App Store or TestFlight path that shares nothing
  with the desktop bundle pipeline. It needs its own contract, not a row in this table.
- **Auto-update.** `tauri-plugin-updater` requires an update endpoint, a signing keypair
  whose private half must be held for the life of the product, and a public commitment to
  a version sequence. That commitment is premature before the one-day dogfood verdict in
  `docs/POC.md` decides whether SimpleMark continues. Deferring it is why
  `TAURI_SIGNING_PRIVATE_KEY` is explicitly *not* in §11.
- **Windows arm64 and Linux arm64.** Runner labels exist, but no one has asked for these
  builds and each one added is a matrix leg that must stay green forever. Add on demand.
- **App stores and package managers.** The Mac App Store, winget, Homebrew, and Flathub
  are distribution channels layered on top of these artifacts, not replacements for them.

This contract never redefines `src-tauri/tauri.conf.json`. Where it needs a bundle format
that APP-2's configuration does not list, the workflow passes `--bundles` explicitly for
that matrix leg (§3) rather than editing APP-2's file.

## 2. Three triggers, and no fourth

| Trigger | Produces | Visibility |
|---|---|---|
| `pull_request`, and `workflow_dispatch` on a branch | Private Actions artifacts (§7) | Repository collaborators only |
| `push` of a tag matching `v*` | A **draft** GitHub Release | Nobody until a human publishes it |
| `workflow_dispatch` on the emergency lane | A **draft** GitHub Release, labelled as such | Nobody until a human publishes it |

This section said "two triggers, and no third" until the emergency lane was added, and
the honest reason for the change is that the third trigger already existed by accident.
`release.yml`'s tag trigger has no branch filter and only `main` is protected, so tagging
any branch has always produced a full draft release from a commit that never ran the
canonical gate and never entered the merge queue. GitHub cannot express a weaker path
*into* `main` — branch protection and rulesets key on the target ref, never the source —
so that capability could not be removed by configuration, only made deliberate.

`.github/workflows/emergency-release.yml` is that capability, named. It takes an explicit
ref, a version tag, and a **required reason**, and it may skip the canonical gate. What it
may not do is hide that it did: the release title carries `EMERGENCY, GATE SKIPPED`, and
the body records the ref, whether that commit ever reached `main` (tested with
`git merge-base --is-ancestor`, not asserted), whether the gate ran, who dispatched it,
and why. The §5 version check is never skippable there, because shipping the wrong version
number is a correctness failure rather than a testing one.

Rules:

- A pull request build **never** creates, updates, or touches a GitHub Release.
- A tag build **never** publishes. It creates the release with `draft: true`. Publishing
  is a deliberate human action, which is what makes the draft a review point rather than
  a formality.
- The emergency lane **never** publishes either, and promotion still runs every platform's
  trust gate (§10). A bypass may skip verification; it may not skip signing.
- `push` to `main` does **not** build installers. The `verify` gate on `main` stays fast;
  a four-platform native build on every merge buys nothing that the PR build did not
  already prove about the same tree.
- No `schedule` trigger. Nightly builds nobody downloads are a way to burn Actions
  minutes and accumulate green checkmarks that mean nothing.

## 3. Build matrix

Four legs. Each builds natively for its own architecture; nothing is cross-compiled.

| Leg | Runner label | Rust target | Bundles |
|---|---|---|---|
| macOS arm64 | `macos-26` | `aarch64-apple-darwin` | `dmg` |
| macOS x64 | `macos-15-intel` | `x86_64-apple-darwin` | `dmg` |
| Windows x64 | `windows-2025` | `x86_64-pc-windows-msvc` | `msi`, `nsis` |
| Linux x64 | `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `appimage`, `deb` (see below) |

**The Linux `.deb` is built but is not a first-lane release asset.** `RELEASE-TRUST.md`
says the first public Linux asset is the `.AppImage` and that `.deb` is later work. Both
formats come out of the same `tauri build`, so the `.deb` is built and retained as a
pull-request test artifact where it is useful for testing on Debian-family systems, and it
becomes a release asset when `RELEASE-TRUST.md` admits it — which needs a smoke-evidence
lane of its own, not a line changed here. §4's six-file release listing is therefore five
files for the first release lane.

Runner labels are **pinned to explicit versions, never `-latest`**. A `-latest` label
silently rolls to a new image, which means the compiler, SDK, and system libraries that
shipped an installer can change without a single line of the repository changing. When a
pinned label is deprecated, moving it is a reviewed change with a recorded reason, not a
surprise.

Why these labels:

- **`ubuntu-22.04`, deliberately not the newest Ubuntu.** An AppImage or `.deb` linked
  against a newer glibc will not start on an older distribution, and the failure is an
  unreadable loader error on the user's machine rather than a red build. The oldest
  supported runner sets the compatibility floor. Raise it only as a decision, never as a
  side effect of taking the latest label.
- **`macos-15-intel` for the x64 leg.** GitHub retires macOS runner images down to the
  most recent two versions, and Intel labels are the ones that disappear first —
  `macos-13` is already gone and `macos-14` is deprecated. If no standard Intel runner
  remains, the fallback is to cross-compile `x86_64-apple-darwin` from an arm64 runner,
  which Apple's toolchain supports. That fallback is a **recorded decision, not a silent
  substitution**, because a cross-compiled leg cannot run its own smoke test (APP-6) —
  the runner cannot execute the binary it just produced.
- **`macos-26` for the arm64 leg, raised from `macos-15`.** This is the recorded reason the
  paragraph above requires. `macos-15` carries the macOS 15 SDK, which has no
  `FoundationModels` framework, so the Swift bridge behind note summaries cannot compile there.
  `build.rs` degrades to a warning in that case — deliberately, so a contributor on an older Mac
  still gets a working app — which means the leg would have gone **green while silently shipping a
  DMG without the capability**. That is the shape of the Graphviz CSP defect, so the move is paired
  with two assertions rather than trusted: `SIMPLEMARK_REQUIRE_INTELLIGENCE=1` turns the degrade
  into a build failure on this leg, and `scripts/verify-native-capabilities.mjs` reads the linked
  binary and fails if the symbol is absent. `macos-26` became generally available on 2026-02-26.
- **Raising the build SDK must not raise the runtime floor.** The Swift bridge is compiled against
  `arm64-apple-macosx26.0`, and if that propagated to the final link every Mac below macOS 26 would
  refuse to launch the app — the same failure mode the `ubuntu-22.04` pin above exists to prevent.
  It does not propagate today (`minos` stays at 11.0), and both macOS legs now assert it with
  `--max-minos 11.0` rather than relying on it staying true.

Linux system dependencies, installed before the build:

```text
libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev
libayatana-appindicator3-dev librsvg2-dev patchelf libfuse2
```

Two notes that cost a build each if they are learned the hard way:

- **`libayatana-appindicator3-dev`, never `libappindicator3-dev`.** The second is the
  pre-Ayatana package. Tauri v2 wants the Ayatana fork, and asking apt for both in one
  command is not a belt-and-braces choice — it is a package conflict that fails the
  install step.
- **`libfuse2` is for AppImage, not for the compile.** Omitting it fails at bundling,
  after the slow part, on a leg that had already compiled successfully.

Each leg asserts its bundle exists at the path Tauri writes it to — under
`src-tauri/target/<rust-target>/release/bundle/<format>/` when `--target` is passed — and
then renames it to the §4 scheme. Asserting the source path before the rename is what
catches a Tauri version that changes its output layout, instead of uploading nothing.

## 4. Artifact names

Published installers:

```text
SimpleMark-<version>-<os>-<arch>.<ext>
```

`<os>` is `macos`, `windows`, or `linux`. `<arch>` is `arm64` or `x64`. `<version>` is the
tag version without the leading `v`.

The NSIS installer is the one exception, and it takes a `-setup` discriminator before the
extension. Both Windows bundles are installers, but only one of them has an extension that
says so; `SimpleMark-0.3.1-windows-x64.exe` would be indistinguishable at a glance from the
application executable that a user might expect to run directly.

So a 0.3.1 release is exactly these files:

```text
SimpleMark-0.3.1-macos-arm64.dmg
SimpleMark-0.3.1-macos-x64.dmg
SimpleMark-0.3.1-windows-x64.msi
SimpleMark-0.3.1-windows-x64-setup.exe
SimpleMark-0.3.1-linux-x64.AppImage
SimpleMark-0.3.1-linux-x64.deb        # PR test artifact only in the first lane (§3)
```

Every one of these ends in `.dmg`, `.msi`, `.exe`, or `.AppImage`, which is not decoration:
`scripts/verify-release-trust.mjs` rejects an artifact whose name does not end in the
extension its platform expects, so an archive or a web build cannot pass as an installer.
This scheme is built to satisfy that check rather than to be renamed at the gate.

Pull-request test artifacts are named for the commit, not the version, because the version
of an unreleased tree is not meaningful:

```text
simplemark-testbuild-<os>-<arch>-<short-sha>
```

A tester who reports a bug quotes the artifact name, and the name identifies the exact
tree. That is the whole reason the SHA is in it.

## 5. One version number

The tag is the source of truth. Before any build step runs, the workflow asserts that all
three of these equal the tag version:

- `package.json` → `version`
- `src-tauri/tauri.conf.json` → `version`
- `src-tauri/Cargo.toml` → `package.version`

Any mismatch fails the workflow immediately, naming each file and the value it holds.

This check is cheap and it is the one that matters most. Both versioned files currently
read `0.0.0`. Without this gate the first real release ships as
`SimpleMark-0.0.0-macos-arm64.dmg`, a build that reports the wrong version to every user
who ever opens the About window, and the mistake is unfixable after publication.

The check runs **before** the matrix, not inside it. Four platforms should not spend
twenty minutes compiling to discover a typo in a version string.

## 6. Checksums

Every published artifact carries a SHA-256.

- A single `SHA256SUMS` file is generated in one job after all four legs finish, covering
  every artifact in the release, in `sha256sum -c` format. Generating it centrally is what
  makes it a manifest of a complete release rather than four unrelated files.
- `SHA256SUMS` is attached to the draft release alongside the installers.
- Pull-request test artifacts each carry a `.sha256` sidecar, so a tester can prove which
  binary they actually installed when they report what it did.

Checksums are integrity, not authenticity — they prove an artifact was not corrupted in
transit, not that it came from this project. Authenticity is signing, and signing is APP-6.
The contract states both so the difference is never blurred in a release note.

## 7. Retention

| Artifact | Retention | Why |
|---|---|---|
| PR test builds | 7 days | Long enough to test a PR, short enough that unsigned private binaries do not accumulate. The 90-day Actions default is wrong for installers. |
| Tag build job artifacts | 30 days | A handoff between the build jobs and the release job, and a short window to diagnose a bad release. |
| Draft/published release assets | Indefinite | The release is the durable home. Nothing else needs to be. |

## 8. Permissions

The workflow declares `permissions: contents: read` at the top level. Exactly one job —
the one that creates the draft release — elevates to `contents: write`, and it declares
that at the job level.

That same job, and only that job, declares `environment: release-signing`, the protected
GitHub Environment `RELEASE-TRUST.md` requires. Environment secrets are scoped to the jobs
that name the environment, which is the mechanism — not a convention — that keeps signing
material out of every pull-request job, including one opened from a fork.

- No `id-token`, no `packages`, no `pull-requests`, no `actions: write`. None of them are
  needed, and a build job that can write to the repository is a build job that can be
  turned into a supply-chain problem by a dependency.
- `actions/checkout` runs with `persist-credentials: false`, matching
  `.github/workflows/verify.yml`. A build does not need a usable token sitting in
  `.git/config` for every subsequent step and every script those steps invoke.
- Third-party actions are pinned by **full commit SHA**, not by tag. A tag can be moved to
  point at new code; a commit SHA cannot. First-party `actions/*` may be pinned by major
  version, consistent with `verify.yml`.
- Secrets are passed to the specific step that needs them, never declared at workflow level
  where every step in every job inherits them.

## 9. Release notes

The draft release body is assembled from inputs, not generated prose:

1. The `CHANGELOG.md` section for this version, if the file has one.
2. Otherwise, commit subjects since the previous tag.
3. Always appended, regardless of 1 or 2:
   - the build matrix table with each artifact's SHA-256,
   - the canonical source SHA the release was built from,
   - the Switchboard task ids referenced by the pull requests merged since the last tag.

A missing changelog section produces a **visible note in the body** saying so. It does not
produce an empty release body, and it does not fail the build — the artifacts are still
good. Whoever reviews the draft before publishing decides whether the note is acceptable.

Nothing here writes marketing copy. A release note that describes what a human did not
write is a release note nobody can trust.

## 10. Failure is loud

- No `continue-on-error`, no `|| true`, and no `if: always()` on any step whose output
  becomes a shipped artifact. `if: always()` on a diagnostic upload is fine; on a build
  step it manufactures a green release from a failed compile.
- Every leg asserts its expected bundle exists at the expected path and is non-empty.
  A missing or zero-byte bundle fails the job, naming the path that was expected.
- **Artifact type is asserted, not assumed.** A `.dmg` must be an Apple Disk Image, an
  `.msi` an MSI, an `.AppImage` an ELF executable. This is the specific rule that stops the
  worst available failure: shipping a zipped `dist/` or a source archive under an installer
  name, so a user downloads something that cannot possibly install.
- `fail-fast: false` on the matrix, so one platform's failure still lets the other three
  report. Diagnosing "Linux is broken" is faster than diagnosing "something is broken."
- The release job requires **all four legs green**. `fail-fast: false` exists to improve
  diagnosis, never to publish a partial release. A release missing a platform is worse
  than no release, because it looks complete.
- A required secret that is absent fails the job naming the secret. It never falls back to
  an unsigned or ad-hoc-signed build. An unsigned installer that looks like a signed one is
  a broken promise the user discovers at Gatekeeper, not at download.
- The draft release is never published automatically, and the workflow has no code path
  that publishes one.
- Before a draft becomes published, every platform's artifact passes
  [`.github/actions/release-trust-gate`](../.github/actions/release-trust-gate/action.yml),
  invoked from the `release-signing` environment. That gate is `RELEASE-TRUST.md`'s, not
  this contract's, and it fails closed on absent credentials, an unverified signing result,
  or a partial smoke test.

These restate the repository rule in the contributor guide: failures are visible and local, and
missing evidence never becomes a green result.

## 11. Required secrets, by name

Every secret is listed by name and purpose. No value appears in this repository, and none
is echoed, printed, decoded into a committed file, or uploaded as an artifact by any step.

**The signing secrets are defined in
[`RELEASE-TRUST.md` §"GitHub environment and secrets"](RELEASE-TRUST.md), which is their
single source of truth.** They are named here so this contract is complete, but if the two
lists ever disagree, `RELEASE-TRUST.md` wins and this table is the bug.

macOS signing and notarization — both macOS legs, tag builds only:
`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
`APPLE_PASSWORD` (app-specific, never the account password), `APPLE_TEAM_ID`, and
`KEYCHAIN_PASSWORD` for the ephemeral CI keychain the certificate is imported into.

Windows signing — the Windows leg, tag builds only. `RELEASE-TRUST.md` deliberately uses
**project-owned names** so the certificate provider can change without leaking provider
details into repository documents:

| Secret | Purpose |
|---|---|
| `SIMPLEMARK_WINDOWS_CERTIFICATE` | Authenticode certificate material or provider credential |
| `SIMPLEMARK_WINDOWS_CERTIFICATE_PASSWORD` | Certificate password, where the provider uses one |
| `SIMPLEMARK_WINDOWS_TIMESTAMP_URL` | RFC 3161 timestamp service URL |

An earlier draft of this section named `WINDOWS_CERTIFICATE` and a set of `AZURE_*`
variables. Those names are wrong for this repository and are recorded here only so nobody
reintroduces them from Tauri's generic examples.

All of the above live in the protected GitHub Environment named `release-signing` (§8).
None are available to pull-request jobs, which is what keeps a fork PR from reaching them.

Built in, never created:

| Secret | Purpose |
|---|---|
| `GITHUB_TOKEN` | Creating the draft release and uploading assets. Scoped per §8. |

No personal access token is used anywhere in the release path.

Explicitly **not** required, and not to be added without retiring the §1 deferral:

| Secret | Why absent |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Updater artifact signing. Auto-update is deferred. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Same. |

Linux artifacts are unsigned, which `RELEASE-TRUST.md` also states: the AppImage lane needs
no signing secret, only its smoke proof. AppImage and `.deb` have no equivalent of
Gatekeeper or SmartScreen, and `SHA256SUMS` (§6) is the integrity story there. It is
recorded in both places so that "Linux is not signed" stays a decision rather than
something noticed at release time.

## 12. Which board task implements which section

| Task | Implements |
|---|---|
| APP-5 — private native test artifacts on every pull request | §2 PR trigger, §3, §4 test-build names, §6's pull-request `.sha256` sidecar, §7 PR retention, §8, §10. Landed as [`.github/workflows/native-testbuild.yml`](../.github/workflows/native-testbuild.yml), with §10's byte-level artifact-type assertion in [`scripts/verify-native-artifact.mjs`](../scripts/verify-native-artifact.mjs). |
| APP-6 — signing, notarization, and platform smoke-test gates | Already largely landed as `RELEASE-TRUST.md` and `scripts/verify-release-trust.mjs`. From this contract: §11's absent-secret behavior and the §3 cross-compile caveat, which costs the affected leg its native smoke test. |
| APP-7 — publish tagged installer builds as a gated draft release | §2 tag trigger, §5, §6's `SHA256SUMS` manifest, §9, §7 release retention, §8 elevated job and `release-signing` environment, and invoking the release-trust gate per §10 |

A workflow that satisfies its rows here satisfies its task. A workflow that needs to break
a rule here changes this document first, in its own reviewed pull request — and if the rule
it needs to break belongs to `RELEASE-TRUST.md`, it changes that one instead.
