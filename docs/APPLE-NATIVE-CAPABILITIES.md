# Apple native capabilities — beyond the model

**What the Swift bridge actually unlocks, what each remaining Apple capability is worth,
and what it costs to build now that the bridge exists.**

* **Status:** Draft 1 — scoping only, no accepted decision

* **Date:** 2026-08-07

* **Companion to:** [`APPLE-NATIVE-AI.md`](APPLE-NATIVE-AI.md) (the AI surface),
  [`NATIVE-WORKSPACE.md`](NATIVE-WORKSPACE.md) (shell and menus),
  [`PRODUCT.md`](PRODUCT.md) (product authority)

* **Scope:** macOS capabilities that are **not** Foundation Models. The four AI candidates are
  scoped in `APPLE-NATIVE-AI.md` §5 and are not repeated here.

***

## 0. How to read this

This is a scoping document, not a plan and not an ADR. It answers "what is it worth, what does
it cost, and what would stop us."

Effort figures are engineering days for one person who already knows this codebase. They are
ranges because two of the seven have a genuine unknown at their centre, named in each case.

**One correction runs through everything below, and it inverts the obvious ranking:** the Swift
bridge built for note summaries does not help the capability with the strongest commercial case.
§1 explains why, and it is the single most useful thing in this document.

Where an API name or shape is stated, it comes from Apple's published framework documentation and
is **accurate in shape, provisional in detail** — the same caution `APPLE-NATIVE-AI.md` §0 applies.
Signatures must be confirmed against the SDK before any of this is built.

***

## 1. What the bridge does and does not unlock

`src-tauri/swift/SimpleMarkIntelligence.swift` exposes three `@_cdecl` functions, compiled to a
static library by `build.rs` and linked into the Rust binary. It is gated on
`aarch64-apple-darwin` and proven working — CI asserts the symbol is present in every macOS arm64
build (`scripts/verify-native-capabilities.mjs`).

**What that buys.** Any Swift-only framework can now be called from Rust by adding a function to
that file. There is no second bridge to build, no IPC, no sidecar process, and no new
dependency. For an in-process framework the marginal cost of the *bridge* is close to zero, and
the real cost is the feature itself.

**What it does not buy.** The bridge is a linked library inside one process. It does nothing for
capabilities that macOS implements as **app extensions** — separate bundles, separate processes,
separate sandboxes and signatures, discovered by the system rather than called by us. Two items
below are extensions (§2.1 Quick Look, and the querying half of §2.6 Spotlight), and for those
the bridge is simply not the relevant lever. §3 covers what they need instead.

The practical test: *does this run inside SimpleMark's process?* If yes, the bridge applies and
the estimate is small. If the system launches it separately, the estimate is dominated by
packaging.

***

## 2. The capabilities

### 2.1 Quick Look preview — *best commercial case, highest cost*

**What it is.** Every `.md` file on the Mac renders as a real document — in Finder's preview
pane, on spacebar, in Mail attachments, in AirDrop and Messages — with diagrams, using
SimpleMark's own renderer, whether or not SimpleMark is running.

**What it is worth.** It is the only item on this list that reaches people who have not installed
the product. A Markdown file sent to a colleague becomes a demo on their machine. Everything else
here improves the experience of someone who already chose us.

**What it takes.** A `QLPreviewingController` extension in its own `.appex` bundle. Three
problems, in descending order of nastiness:

1. **Tauri does not bundle app extensions.** Its macOS bundler produces one binary plus
   resources. Assembling and signing an `.appex` inside the `.app` is our own post-processing
   step, and one we would have to keep working across Tauri upgrades. This is the unknown at the
   centre of the estimate.
2. **The extension cannot reuse the Rust binary.** Our renderer is TypeScript in a WebView, so
   the extension needs its own `WKWebView` loading the same bundle — effectively a second
   composition root. ADR-0001 names `app` as *the* composition root; a second one is either a
   deliberate exception or a reason to restructure.
3. **Signing and sandbox differ.** An extension carries its own entitlements and its own
   sandbox. `simplemark-csp-only-in-packaged-builds` records that we have already shipped a
   defect that only appeared in packaged builds; an extension is that hazard one layer deeper,
   and dev, vitest and Playwright will all miss it exactly as they did then.

**Effort:** 1–2 weeks, most of it packaging rather than product, and the least certain figure here.

**Risk if it goes wrong:** a bundle that fails notarization, or an extension that works locally
and not on a customer's Mac. Both are release-blocking rather than cosmetic.

### 2.2 Sentence segmentation — *do this regardless*

**What it is.** `NLTokenizer` from the `NaturalLanguage` framework, replacing the hand-rolled
sentence splitter in `note_preview.rs`.

**What it is worth.** Correctness in something already shipped. `first_sentence` is a byte scan
for `.`, `!` or `?` followed by a space. It already produced two defects found on real notes: a
sentence cut at a semicolon inside a parenthetical, and — still present — it will break
`e.g.`, `Dr.`, `No. 4` and every decimal number. Apple's tokenizer does this properly, in every
language, on device.

**What it takes.** One more `@_cdecl` function in the existing Swift file, and a call from
`note_preview.rs`. The bridge does all the work. The existing regression tests in
`note_preview.rs` become the acceptance criteria unchanged.

**Effort:** half a day.

**Risk:** near zero. It is a pure function swap behind existing tests, and it degrades to the
current behaviour if the framework is unavailable.

### 2.3 Speech — *a new occasion of use*

**What it is.** `AVSpeechSynthesizer` reading the rendered document aloud.

**What it is worth.** SimpleMark currently competes for desk time only. Read-aloud makes a long
agent-written plan reviewable on a walk, which is usage we have none of today. It also answers
the accessibility question enterprise buyers ask, with a first-party implementation rather than a
claim.

**What it takes.** The synthesizer itself is in-process and simple to call. **The cost is UI, not
native.** Play, pause, stop and a menu item; what happens when you switch notes mid-sentence;
whether it reads the rendered text or the source, and how it handles code blocks, tables and
diagram captions — which is a product question rather than a technical one.

**Effort:** 1–2 days, of which the bridge is perhaps an hour.

**Settled (2026-08-07):** diagrams are **skipped silently** when reading aloud. No spoken
placeholder, no "image" announcement, no gap the listener has to interpret — the same rule the
rest of the product follows, where an absent capability is absent rather than narrated.
### 2.4 File coordination — *trust, not features*

**What it is.** `NSFileCoordinator` and `NSFilePresenter` replacing, or fronting, the `notify`
crate in `watch_note`.

**What it is worth.** Removing a class of "it lost my edit" complaints rather than adding a
feature. The `notify` crate watches raw filesystem events; iCloud and Dropbox write through file
coordination, and an uncoordinated writer can race a sync client. This repository itself lives in
Dropbox, so the failure mode is not hypothetical.

**What it takes.** In-process, so the bridge applies. The risk is not novelty but surgery: this is
the load-bearing path that carries the `WriteLedger` check distinguishing our own saves from
someone else's edit, and the superseding queue that collapses a burst of agent writes into one
calm re-render. Both must survive.

**Effort:** 3–5 days, dominated by not regressing what is already correct.

### 2.5 Continuity Camera — *owns the capture moment*

**What it is.** Photograph a whiteboard or document with an iPhone and have it land in the open
note, via the standard Import from iPhone menu.

**What it is worth.** Notes often start at a whiteboard. This owns that moment, and it pairs
directly with `APPLE-NATIVE-AI.md` §5.2 (paste an image, get a document) — Continuity Camera is
the capture half of a feature whose recognition half is already scoped.

**What it takes.** The menu items are supplied by AppKit through the responder chain, and they
appear only if a responder implements the import action and menu validation agrees. `WKWebView`
owns that chain; today `macos_context_menu.rs` *inserts into* WebKit's finished menu rather than
participating in validation, so this needs a genuine responder rather than another insertion.

**Effort:** \~1 week. Fiddly rather than deep, and the fiddliness is AppKit's, not ours.

### 2.6 Spotlight indexing — *split it in half*

**What it is.** Notes the user has opened become findable from system Spotlight.

**Two halves, with very different costs.** `CSSearchableIndex` — donating title and body as the
user opens notes — is an ordinary in-process API and the bridge covers it. The *querying* side
that `APPLE-NATIVE-AI.md` §5.3 describes needs `@AppEntity` and App Intents compiled into a real
app bundle, which is the same packaging fight as §2.1.

**Effort:** \~1 week for the index-only half. The querying half inherits §3's unknown and should
not be sized until §3 is settled.

**Precondition, unchanged from §5.3:** it requires accepting that we keep an index of the user's
content. That is a positioning decision, not an engineering one, and it belongs in `PRODUCT.md`
before any code.

### 2.7 Translation — *narrow*

**What it is.** On-device translation of a note's rendered text.

**What it is worth.** Little, absent a specific customer asking. Included for completeness.

**What it takes.** The macOS translation API is SwiftUI-shaped — a view modifier driving a
session — and driving it headless from a `@_cdecl` works against the grain of the framework.

**Effort:** \~1 week, and the shape of the API is the reason rather than the work.

**Recommendation:** do not schedule this without a named customer.

***

## 3. The app-extension problem

§2.1 and half of §2.6 share one blocker, and it is worth naming separately because solving it
once unlocks both, and because it is the least interesting work on this list.

Tauri's macOS bundler produces an application bundle. macOS app extensions are nested bundles
inside it, each with its own `Info.plist`, its own entitlements, its own code signature, and a
`NSExtension` declaration the system reads to discover them. Nothing in the Tauri toolchain
models that.

The realistic options, in order of preference:

1. **Post-process the bundle.** Build the extension separately with `xcodebuild`, insert it into
   `SimpleMark.app/Contents/PlugIns/`, and re-sign. Everything lands in our own release scripts,
   which already assert artifact shape (`verify-native-artifact.mjs`) and can assert this too.
   Brittle across Tauri upgrades; ours to keep working.
2. **Wrap in a native shell.** Build a thin Xcode project that embeds the Tauri output. Solves
   extensions properly and permanently; a large change to how the product is built, and one
   `RELEASE-CONTRACT.md` would need to be rewritten around.
3. **Do not ship extensions.** Accept that Quick Look and Spotlight querying are out of reach,
   and spend the fortnight on §2.3 through §2.5 instead.

**This is a business decision about distribution, not an engineering preference.** Option 1 is
right if Quick Look's reach matters commercially; option 3 is right if it does not.

**Chosen: option 1 — post-process the bundle** (2026-08-07, on review of this draft). Quick Look's
reach is judged worth the packaging cost, and option 2's rewrite of how the product is built is
not. Two consequences follow and should not be discovered later:

- **The brittleness is now ours to own.** Every Tauri upgrade can break the insert-and-re-sign
  step. It belongs in the release scripts beside `verify-native-artifact.mjs`, and the same
  discipline applies: assert the extension is present and signed in the built bundle rather than
  assuming it. A missing `.appex` must fail the build, exactly as a missing Foundation Models
  symbol does today.
- **This unblocks the querying half of §2.6.** Spotlight querying shares the blocker, so it moves
  from "blocked on a decision" to "blocked on the `PRODUCT.md` question about holding an index of
  customer content" — a smaller and different gate.

This decision constrains everything after it and should be promoted to an ADR before the first
line of extension code is written.

***

## 4. Sequencing

**Now, independent of any decision.** §2.2 sentence segmentation. Half a day, fixes something
already shipped, no new surface, no decision required.

**Next, and now genuinely parallel to Quick Look.** §2.3 speech, then §2.4 file coordination. Both
are in-process, both are bounded, and between them they add an occasion of use and remove a bug
class. Roughly a week together. Worth doing alongside §2.1 rather than after it, because they
share nothing: one is packaging, the other two are product.

**Unblocked by §3's decision, and now the largest piece of work here.** §2.1 Quick Look. With
option 1 chosen it is no longer waiting on anything — it is a fortnight of packaging work whose
first step should be the §5 question below, since answering it may halve the estimate.

**Still blocked, on a different gate.** §2.6 Spotlight. §3 removed its packaging blocker, but both
halves still wait on the `PRODUCT.md` question about whether SimpleMark holds an index of the
user's content. That is a positioning decision, not an engineering one.

**Not scheduled.** §2.7.

**Deliberately excluded from this document.** Handoff and PencilKit both presume an iOS app, and
`APPLE-NATIVE-AI.md` §4.1 is explicit that iOS is a product decision nobody has made — the
file-watching loop that defines SimpleMark does not exist there. Writing Tools remains
unreachable for the reason recorded in `APPLE-NATIVE-AI.md`: it is a user-invoked text service
acting on a focused field, not a callable API.

***

## 5. What would make this document wrong

Stated so it can be checked rather than trusted:

* **If Tauri gains app-extension support**, §3 collapses and §2.1 becomes a normal feature. Worth
  re-checking before committing to option 2.

* **If the Quick Look extension can be given the renderer without a second composition root** —
  for instance by rendering to static HTML ahead of time rather than running the editor — §2.1's
  second problem disappears and the estimate roughly halves. This has not been investigated and
  is the first thing to try.

* **If `NLTokenizer` proves unavailable or unsuitable** for Markdown's mixed prose and code, §2.2
  falls back to the current splitter with better abbreviation handling, which is a day rather
  than half of one.
