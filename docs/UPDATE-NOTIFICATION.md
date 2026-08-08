# SimpleMark — Update notification

**The library footer says when the installed app is behind `main`, and nothing at all when it is not.**

- **Status:** Phase 1 building. Phase 2 blocked on signing — see §6.
- **Date:** 2026-08-04
- **Builds on:** APP-22 (build provenance), `scripts/install-main.sh`
- **Companion to:** [`NATIVE-WORKSPACE.md`](NATIVE-WORKSPACE.md) (chrome rules),
  [`RELEASE-CONTRACT.md`](RELEASE-CONTRACT.md)

---

## 1. The problem

Several agents merge into `main` continuously. The bundle version has been `0.1.0` for every build
this project has ever made, so the installed app cannot be identified by version, and there is no
updater: `tauri.conf.json` has no `plugins`, no `createUpdaterArtifacts`, and no `signingIdentity`.

APP-22 fixed *identification* — About shows `Version 0.1.0 (61bc157)`. It did not fix *notification*.
Knowing which commit you are on still requires opening About and comparing it against `git log` by
hand, which nobody does, so people run stale apps and report bugs that were fixed hours earlier.

## 2. Placement

A full-width strip inside the library footer, above the sync and settings icons.

```text
┌──────────────────────┐
│ Open Notes         3 │
│ Untagged           — │
│ …                    │
│                      │
│ FOLDERS              │
│   SimpleMark       3 │
│                      │
│ ┌──────────────────┐ │  ← the bar, only when there is something to say
│ │ ↓ Update ready   │ │
│ └──────────────────┘ │
│ ↻   ⚙                │
└──────────────────────┘
```

The footer is the only region of the window that is not competing with the document, and it already
holds the two app-level controls. An update is app-level, so it belongs with them rather than in
the titlebar — [`NATIVE-WORKSPACE.md`](NATIVE-WORKSPACE.md) reserves the titlebar for window and
document state, and this is neither.

**It is absent when the app is current.** Not dimmed, not a neutral "up to date" strip — absent.
Chrome that is permanently present to say nothing is chrome that gets ignored, and the sidebar's
job is to be a stable anchor that does not compete with the page.

## 3. States

| Status | Bar | Why |
|---|---|---|
| `current` | **Absent** | There is nothing to say. Saying it anyway trains people to ignore the strip |
| `behind` | **Shown**, actionable | The one state that needs a decision |
| `unknown` | **Shown**, muted, not actionable | The check failed. See below |

`unknown` is the state that decides whether this feature is honest.

A failed check must never render as `current`. Absence of the bar is a claim — it says *"you are on
the latest"* — and a network error is not evidence for that claim. the contributor guide: *"failures are visible
and local. No silent fallbacks, no blank rectangles, no turning missing evidence into a green
result."* So a check that could not complete says so, in muted styling that cannot be mistaken for
an available update.

This does not violate §2. The bar disappears when there are no updates *and the app knows it*.

## 4. Who computes "behind"

Not the app. [`build-provenance.ts`](../src/app/build-provenance.ts) already states the limit:

> It can only compare identity, never ancestry — the bundle carries one SHA and no history — so
> this answers "is this exactly that commit?" and nothing more. Deciding whether a build is
> *behind* `main` needs git, and belongs to the installer rather than to a running app pretending
> to know.

That constraint holds, and the design respects it by **asking the remote that does have the
history** rather than inferring locally. GitHub's compare endpoint returns `behind_by` and
`status`; the app reports what it was told and never computes ancestry itself.

Consequences worth stating:

- Comparing a build whose SHA is `unknown` — compiled from a tree with no git metadata — yields
  `unknown`, not `behind`. An unidentifiable build cannot be measured against anything.
- A build *ahead* of `main` (a local branch build) is not `behind`, and must not nag. This is the
  normal state on a development machine and getting it wrong would make the bar worthless.
- The remote's answer is untrusted input, normalised the same way `readProvenance` normalises the
  native command's payload.

## 5. Phase 1 — what is being built now

1. **Pure status logic**, `src/app/update-status.ts`: current SHA plus a comparison payload in,
   one of the three states out. No network, no DOM, fully testable.
2. **The bar**, in the library footer, appearing per §3.
3. **The check**, wired in the composition root, against `origin/main`.
4. **The action**: reveals the exact command, `bash scripts/install-main.sh`, and copies it. That
   script already builds the resolved commit and replaces the bundle only after the new one
   verifies.

Phase 1 deliberately stops short of one-click. It solves the whole of the reported problem —
*knowing* — without the infrastructure §6 requires.

## 6. Phase 2 — one click, and what it costs

The wanted behaviour is Claude Desktop's: click, the app closes, updates, and reopens.
`tauri-plugin-updater` does exactly this. Three things must exist first, none of them code:

1. **A signing keypair.** Tauri verifies update signatures; private key in CI secrets, public key
   in `tauri.conf.json`. Without it the updater refuses the download, correctly.
2. **A published feed.** `release.yml` publishes tagged draft releases (APP-7) — a release channel,
   not an update feed. An updater needs a signed bundle plus a manifest per build.
3. **macOS notarization.** Otherwise Gatekeeper blocks the installed update. This needs an Apple
   Developer account, and it is the piece with a real-world dependency rather than an engineering
   one.

### 6.1 The tension to decide first

Updating on every merge means a signed macOS build on every push to `main` — roughly five minutes
of macOS runner time each. `CI-SANDBOX.md` exists specifically to keep Actions
minutes free, so *"update on every merge"* fights a constraint this project set deliberately.

Updating on tags only fits the existing release machinery, but then the bar stays dark when a PR
merges — which is the exact moment it was wanted for.

Phase 1 sidesteps this entirely: checking a SHA costs one API call and no build minutes. The
decision can be deferred until the notification proves useful.

### 6.2 The developer shortcut, and why it is not the answer

The app could spawn `install-main.sh` and relaunch. On this machine that would work, and it is
tempting.

It is rejected for the shipped product: an application that shells out to a build script, requiring
a toolchain, a source checkout, and two minutes of compilation with no window on screen, is a
developer convenience wearing a product's clothing. If it is ever built it belongs behind an
explicit development-build check, never in a release bundle.

## 7. Not in scope

- Automatic background installation. The update is offered; it is never applied unasked.
- Release notes or a changelog in the bar. The commit range is the honest summary at this stage.
- Update checking in the browser shell. It has no bundle and nothing to update.
- Any check that runs while the document is dirty and could interrupt a save.

## 8. Open questions

- **Cadence.** Once at launch, or periodically? Once is honest and cheap; periodic risks nagging.
  Phase 1 checks at launch and on demand.
- **Rate limiting.** Unauthenticated GitHub API allows 60 requests per hour per IP. One check per
  launch is far inside that, but a periodic check on several open windows is not.
- **Private repository.** The canonical repository is private, so an unauthenticated compare call
  will 404. This resolves to `unknown` rather than failing loudly, which is correct behaviour but
  means Phase 1 needs a token, or a public endpoint, to be useful. **This is the first thing to
  settle in implementation** — see §9.

## 9. The unresolved dependency

A private repository cannot be queried anonymously. The options, none free:

| Option | Cost |
|---|---|
| Personal access token in the app | A secret in a distributed bundle. **Rejected** |
| Token in the user's keychain, entered once | Honest, but asks a person to make a token |
| A tiny public endpoint publishing `main`'s SHA | One more thing to host and keep truthful |
| Publish the SHA to the existing public mirror | Reuses machinery that already exists |

The last is the most promising: [`publish-public-mirror.sh`](../scripts/mirror) already pushes a
sanitised export publicly, and a file containing nothing but the current `main` SHA leaks nothing
the mirror does not already expose. Until this is settled the bar will resolve to `unknown` on any
machine without credentials — visibly and with the reason, per §3.

### 9.1 Why no source file names the repository

The mirror refuses to publish source carrying the private canonical identity, which is checked by
`scripts/mirror/test-public-mirror-hygiene.sh`. A constant naming the update target would therefore
either leak that identity into the public mirror or be wrong there.

So `build.rs` reads `git remote get-url origin` and stamps `owner/name` into the binary, alongside
the commit it already records. The source names nothing. This is also the behaviour a fork wants —
it checks itself, with no configuration — and the public mirror checks the public mirror. A build
with no git, no remote, or an unrecognised URL records `unknown`, and the check reports that it has
nothing to ask rather than guessing a target.
