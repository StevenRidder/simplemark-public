# SimpleMark release trust gates

**Status:** Current implementation contract for APP-6. It does not prove that a
public release has been signed, notarized, or tested yet.

SimpleMark's GitHub Release must start as a **draft**. A person can publish it
only after the exact installer files pass the gate in
[`../scripts/verify-release-trust.mjs`](../scripts/verify-release-trust.mjs).
The gate is intentionally hostile to missing data: absent credentials, an
unverified signing result, or a partial smoke test is a failure, not a warning.

## What APP-6 owns

APP-6 defines the public-release trust boundary. APP-4 owns the GitHub Actions
workflow structure and APP-7 owns creating the draft release. APP-7 must invoke
this gate for every platform before it changes a draft release to published.

- Pull requests may create **private test artifacts**. They are not public
  release candidates.
- An unsigned or unnotarized installer may exist only as a test artifact or
  draft-release asset. It must never be labelled ready to download.
- A GitHub source ZIP/tarball is not an installer and cannot satisfy this gate.
- This contract does not add an updater, an account, or any cloud document
  service. iOS distribution remains a separate App Store/TestFlight task.

## GitHub environment and secrets

Create a protected GitHub Environment named `release-signing`. Its environment
secrets are available only to the version-tag draft-release job, never to pull
request jobs. Do not echo any secret, decode it into a committed file, or upload
it as an artifact.

### macOS public release

The macOS job must build both Apple Silicon and Intel packages. It needs these
secrets:

| Secret | Purpose |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application `.p12` certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password for that exported certificate |
| `APPLE_SIGNING_IDENTITY` | The Developer ID Application signing identity |
| `APPLE_ID` | Apple account email used for notarization |
| `APPLE_PASSWORD` | Apple app-specific password |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `KEYCHAIN_PASSWORD` | Ephemeral CI keychain password |

The job imports the certificate into a temporary keychain, signs the `.app` and
DMG, notarizes, staples the notarization ticket, and records the result against
the exact DMG SHA-256. Ad-hoc signing is useful for test builds but does **not**
clear the public-release gate.

### Windows public release

The Windows job uses the project-owned names below so the certificate provider
can change without leaking provider details into document code:

| Secret/variable | Purpose |
| --- | --- |
| `SIMPLEMARK_WINDOWS_CERTIFICATE` | Authenticode certificate material or provider credential |
| `SIMPLEMARK_WINDOWS_CERTIFICATE_PASSWORD` | Certificate password, when that provider uses one |
| `SIMPLEMARK_WINDOWS_TIMESTAMP_URL` | RFC 3161 timestamp service URL |

The workflow must sign the final `.msi` or installer `.exe`, then verify the
signature with the platform verifier and record that result against the exact
asset SHA-256. An OV certificate can still show SmartScreen warnings while it
builds reputation; an EV certificate has different provider requirements. The
gate therefore proves a valid signature, not a promise that SmartScreen will
never warn.

### Linux public release

The first Linux asset is an `.AppImage`; `.deb` is later work. No signing
secret is required for this first lane, but its target-OS smoke proof is still
required. The evidence must cover downloading the exact asset, making it
executable when necessary, launching it, opening an approved local Markdown
file, editing/saving/reopening, and receiving an external-file update.

## Executable platform smoke proof

For every target, a tester creates one JSON file with this shape and retains it
with the release evidence:

```json
{
  "schema": "simplemark.platform-smoke.v1",
  "target": "macos",
  "commit": "40-character-canonical-commit-sha",
  "artifact": {
    "name": "SimpleMark_0.1.0_aarch64.dmg",
    "sha256": "64-character-lowercase-or-uppercase-sha256"
  },
  "checks": {
    "install": true,
    "open": true,
    "openApprovedMarkdown": true,
    "editSaveReopen": true,
    "externalChangeHandled": true
  },
  "trust": {
    "codeSigned": true,
    "notarized": true,
    "stapled": true
  }
}
```

### Collecting it

Write that file with [`../scripts/collect-platform-smoke.mjs`](../scripts/collect-platform-smoke.mjs)
rather than by hand. A hand-written evidence file is the one thing that can
drift from the bytes it describes, and this gate is only worth having if it
cannot be satisfied by an optimistic JSON file.

```sh
node scripts/collect-platform-smoke.mjs \
  --target macos \
  --artifact SimpleMark-0.1.0-macos-arm64.dmg \
  --commit "$(git rev-parse HEAD)" \
  --out platform-smoke-macos.json \
  --tester "Name <email>" \
  --attest openApprovedMarkdown,editSaveReopen,externalChangeHandled
```

It splits the evidence by what can honestly produce it:

| Field | How it is established |
| --- | --- |
| `artifact.sha256` | read off the bytes |
| artifact type | asserted by `verify-native-artifact.mjs`; a renamed archive is refused |
| `checks.install` | the installer is really installed — DMG mounted and the `.app` copied out, AppImage made executable and unpacked, MSI/NSIS silently installed |
| `checks.open` | the installed binary is really launched and must stay alive |
| `trust.*` | queried from the OS — `codesign`, `spctl`, `stapler` on macOS; `Get-AuthenticodeSignature` on Windows |
| the other three `checks` | recorded only from `--attest`, and only with a named `--tester` |

`--attest` refuses `install` and `open`: those are measured here and can never
be asserted. Any check that was not performed stays `false`, the command exits
non-zero, and it names what will fail — so incomplete evidence is visible when
it is collected rather than at the promotion gate.

Run it on the target OS, against the exact artifact from the draft, then attach
the result to that draft so `release-promote.yml` can find it:

```sh
gh release upload v0.1.0 platform-smoke-macos.json
```

### Verifying it

The check command is deliberately simple and fails closed:

```sh
node scripts/verify-release-trust.mjs \
  --target macos \
  --mode public-release \
  --evidence path/to/macos-smoke.json
```

Run it in the tag-release job after packaging and target-OS smoke collection.
For macOS and Windows, set the listed secrets only in the protected release
environment. For Linux, the same command verifies the smoke evidence without
requiring signing secrets.

For Windows, replace the macOS `trust` entries in the example with
`codeSigned: true` and `signatureVerified: true`. Linux needs no `trust` block.
The artifact name must end in `.dmg` (macOS), `.msi` or `.exe` (Windows), or
`.AppImage` (Linux), so an archive or web build cannot accidentally pass.

The reusable GitHub Actions wrapper is
[`../.github/actions/release-trust-gate/action.yml`](../.github/actions/release-trust-gate/action.yml).
APP-7 must call it from the protected `release-signing` environment before any
draft release is published.

## Promotion checklist

Before publishing a GitHub Release draft, a human verifies:

1. The release tag, commit SHA, artifact names, and SHA-256 values agree.
2. Both macOS architectures have valid signed, notarized, stapled DMGs and
   their smoke evidence.
3. The Windows installer has a valid Authenticode verification result and its
   smoke evidence.
4. The Linux AppImage has smoke evidence.
5. The release remains a draft until all of the above are attached or linked.

## Sources

- [Tauri: macOS code signing and notarization](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri: Windows code signing](https://v2.tauri.app/distribute/sign/windows/)
- [GitHub Actions: encrypted secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
