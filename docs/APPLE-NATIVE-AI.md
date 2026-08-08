# Apple native AI — macOS and iOS scope

**What Apple's 2026 intelligence frameworks make possible for SimpleMark, what they cost, and what
we would have to decide first.**

- **Status:** Draft 1 — scoping only, no accepted decision
- **Date:** 2026-08-04
- **Companion to:** [`PRODUCT.md`](PRODUCT.md) (product authority), [`TECH-SPEC.md`](TECH-SPEC.md)
  (recognition and rendering), [`NATIVE-WORKSPACE.md`](NATIVE-WORKSPACE.md) (shell and menus)
- **Scope of this document:** the Apple Intelligence surface available to a Tauri app on macOS 27
  and iOS 27, the eligibility and context limits that constrain it, four candidate features, and
  the sequencing that would deliver them.

---

## 0. How to read this

This is a scoping document, not a plan and not an ADR. It answers "what is actually available, what
would it cost, and what conflicts does it create." Nothing here is accepted architecture.

Every API name, version, and limit below comes from Apple's own WWDC26 session material and
developer guides, listed in §9. Apple's reference documentation pages render client-side and could
not be read directly, so **exact signatures must be confirmed against the SDK before any of this is
built.** Treat names as accurate in shape and provisional in detail.

One correction to earlier informal discussion, because it changes scope materially: the Spotlight
tool does **not** search the user's whole Mac. It searches *your app's* Core Spotlight index. That
turns two of the four candidate features into one feature with a shared prerequisite. See §5.3.

---

## 1. The capability surface

### 1.1 Two models, not one

The Foundation Models framework exposes two models behind one session type. They are not
interchangeable, and the difference decides which features are viable.

| | On-device (`SystemLanguageModel`) | Private Cloud Compute (`PrivateCloudComputeLanguageModel`) |
| --- | --- | --- |
| Context window | 4,096 (26.0) → **8,192** (27.0+) | **32,768** |
| Reasoning | none | `.light`, `.moderate`, `.deep` |
| Works offline | yes | no |
| Request limits | none | **daily, per user, keyed to iCloud account** |
| Cost to us | none | none, if we qualify and apply |

Both are reached through `LanguageModelSession`. Reasoning level is set per request via
`ContextOptions(reasoningLevel:)`, and reasoning tokens count against the context window.

**The 8,192-token on-device window is the single most important number in this document.** A long
AI-written plan or research document will not fit. Any feature that must run automatically and
frequently has to run on-device, which means it has to operate on a *fragment* — never a whole
document. This is a real constraint, and §5.1 shows it happens to fit our best candidate feature
exactly.

### 1.2 Images and tools

The on-device model accepts images directly in a prompt (`Attachment(NSImage(...))`, also
`CGImage`, Core Image, `CVPixelBuffer`, and file URLs, at any size or aspect ratio). Apple ships
tools the model can call: `OCRTool` and `BarcodeReaderTool` (Vision-backed, on-device) and
`SpotlightSearchTool`, which performs retrieval over a Core Spotlight index — including
`sources: [.files]` for files in the app sandbox.

### 1.3 Everything else in the 2026 surface

- **Language Model protocol** — any model can back a `LanguageModelSession`, including Core AI and
  MLX local models and first-party Swift packages from Anthropic and Google. Relevant to us only as
  a hedge: it means adopting this framework is not a bet on Apple's model quality.
- **Dynamic Profiles** — declarative model/tool/instruction switching inside one session. Aimed at
  agentic apps. Out of scope; SimpleMark is deliberately not one.
- **Core AI** — successor to Core ML for running custom models (Qwen, Mistral, SAM3) on Apple
  silicon. No identified use. Explicitly out of scope.
- **Evaluations framework** — measures whether an intelligence feature is actually correct as
  prompts change. In scope, and treated as a gate rather than a nicety in §7.
- **`AppIntentsTesting`** — validates App Intents through real system pathways without UI
  automation. In scope if §5.3 proceeds.
- **`fm` CLI (macOS 27) and a Python SDK** — useful for prompt development and fixtures outside
  the app. Zero integration cost, worth using from day one.
- **Image Playground, Visual Intelligence** — no fit with the product contract. Out of scope.

### 1.4 Writing Tools — already working, possibly degraded

Writing Tools works in our editor today because it is an OS behavior over text in a web view, not
something we call. But `WKWebViewConfiguration.writingToolsBehavior` **defaults to `.limited`**,
which is the panel experience rather than the full inline one. The values are `NSWritingToolsBehavior`
`.none`, `.limited`, `.complete` (macOS 15.0+), and there is an `isWritingToolsActive` property
worth observing so we can suppress our own refresh while a rewrite session is open.

**Action independent of everything else in this document:** find out what Tauri's WKWebView sets,
and whether we can reach the configuration. If we are on the default, we are shipping the degraded
experience and did not choose to. This is the cheapest item in the document and does not depend on
§4's bridge.

---

## 2. Eligibility — who actually gets any of this

Three gates, all of which must pass, none of which we control.

**Hardware.** Apple Intelligence requires Apple silicon: M1 or later Mac, iPhone 15 Pro / Pro Max or
iPhone 16 and later, iPad with M1 or later or A17 Pro. Intel Macs are excluded permanently. Roughly
7 GB of on-device storage, and a supported device and Siri language.

**OS version.** The rebuilt on-device model, image input, Dynamic Profiles, and the Evaluations
framework are iOS/iPadOS 27 and macOS 27 minimums. `fm` is macOS 27.

**PCC entitlement.** Free cloud access is not automatic. It is tied to the Small Business Program
for developers under 2M first-time downloads, and **it must be applied for on the Apple Developer
website.** We qualify on volume. We have not applied. If PCC is on the roadmap, the application is
lead time we should start early, and its outcome is a dependency, not an assumption.

Every feature therefore needs an unavailable path, and `SystemLanguageModel.availability` /
`model.isAvailable` must be checked at runtime rather than inferred from OS version. Xcode's
scheme debug options can simulate unavailability and quota states, which makes the unavailable path
testable rather than theoretical.

---

## 3. Two conflicts with the product contract

These are the parts worth arguing about before anyone writes code.

### 3.1 Apple wants quota UI. PRODUCT.md forbids it.

Apple's guidance for PCC is explicit: show persistent, actionable UI when a user nears or hits
their daily limit, disable the affected control, and offer `limitIncreaseSuggestion.show()` as an
upgrade path. The API is built for it — `quotaUsage.status`, `isApproachingLimit`,
`isLimitReached`.

[`PRODUCT.md`](PRODUCT.md) says the reader is taxed by every visible noun, and that AI machinery
must stay invisible until explicitly invoked. A persistent "you have used your daily AI allowance,
upgrade to iCloud+" strip is exactly the cockpit the product exists to avoid.

**Proposed resolution, for decision:** nothing on the automatic reading path may use PCC. On-device
only, where there is no quota and no UI obligation. PCC is permitted solely behind an explicit,
user-initiated action, where a quota message is a legitimate response to something the user just
asked for. This keeps the contract intact and costs us the 32K window and reasoning for anything
ambient — which §5 shows we can live with.

### 3.2 Spotlight indexing means keeping a store

`SpotlightSearchTool` retrieves from an index we populate. To get semantic search over the user's
documents, we must index them via `IndexedEntity` and `@Property(indexingKey:)` as they are opened.

PRODUCT.md's first experience rule is: open a file directly, do not import it into a library,
create a vault, or choose a workspace. An index of every document the user has opened is not a
vault and has no UI — but it is a persistent store of their content, and we should be honest that
we are building one rather than discovering it later.

**Proposed resolution, for decision:** index only documents the user has actually opened, never a
folder scan; expose no library UI of our own; make the index disposable and rebuildable; and treat
"forget everything" as a first-class command, not a preference. If we cannot accept that, §5.3 and
§5.4 both die, and the scope of this document shrinks to two features.

---

## 4. Platform scope: the bridge

All of this is Swift. Our app is Rust plus a web canvas. Nothing is reachable until Rust can call
Swift, and the answer differs by platform in a way that inverts the usual expectation.

**iOS: officially supported.** A Tauri iOS plugin *is* a Swift class extending `Plugin` from the
Tauri package, with `@objc` methods taking `(_ invoke: Invoke)`, callable from Rust and JavaScript.
Rust-to-Swift goes over C FFI (`@_silgen_name` on the Swift side, `extern "C"` on the Rust side).
This is a documented, first-party path.

**macOS: not supported.** Tauri has no official Swift plugin support on the desktop side —
[tauri-apps/tauri#12137](https://github.com/tauri-apps/tauri/issues/12137) is open, and the stated
reason is precisely that there are no production-ready Rust bindings for the macOS SDK. Options:

1. **Swift static library linked into the Rust binary** via `build.rs`, exposing `@_cdecl` C
   functions, `cfg`-gated to macOS. No IPC, no process lifecycle, one binary. Recommended.
2. **Swift sidecar process** with JSON over stdio. Easier to start, and we would own process
   supervision, crash recovery, and startup latency forever. Not recommended.
3. **`tauri-swift-runtime`** (community crate) — worth reading before writing option 1 by hand, not
   worth depending on unexamined.

The bridge is the gate on every feature in §5 and delivers nothing a user can see. Budget it
honestly and do not let it be discovered mid-feature.

### 4.1 iOS is a product question before it is an engineering one

**We do not have an iOS app.** Scoping AI for iOS presumes a decision nobody has made, and the
decision is not small.

SimpleMark's core loop is: an agent writes a local `.md` file, we watch the directory, and the
rendered document updates calmly. On iOS that loop does not exist. There is no arbitrary
filesystem, no directory watching, and no agent writing to a path we can observe. File access is
document-picker and security-scoped bookmarks, and change notification for synced files goes
through file coordination, not the `notify` crate we use in
[`lib.rs:610`](../src-tauri/src/lib.rs:610).

So an iOS SimpleMark is a **reader for documents that arrived some other way** — iCloud Drive,
share sheet, a URL — not the agent-watching product. That may be a good product. It is a different
one, and the AI features below inherit its shape:

- §5.1 (what changed) depends on observing external writes. **Weakest on iOS**; only meaningful for
  iCloud-synced files, via file coordination we have not built.
- §5.2 (screenshot paste) works, and is arguably *better* on iOS where screenshots are the native
  currency. **Strongest iOS candidate.**
- §5.3 / §5.4 (index, ask) work, and App Intents integration is more valuable on iOS where Siri and
  Spotlight are the primary launch surfaces.

**Recommendation:** iOS is out of scope for this work until the iOS file story is decided
independently. The bridge is cheaper there, which is an argument for iOS *later*, not sooner.
Building an iOS AI feature before an iOS product exists is building on nothing.

The remainder of this document scopes **macOS 27**.

---

## 5. Candidate features

Each is scored against [`PRODUCT.md`](PRODUCT.md): does it strengthen the rendered-document
promise, and does it add a visible noun?

### 5.1 Tell me what changed — *recommended first*

**What it is.** An outside process rewrites the open file. Today the page silently reloads. Instead,
one quiet sentence: *"Rewrote the rollback section; timeline unchanged."*

**Why it fits.** This is not an AI feature bolted on. PRODUCT.md's first experience, item 4, promises
we update cleanly and preserve reading position when an agent changes the file. Telling the reader
what moved is the missing half of a promise we already make. It adds no control, no panel, no
setting.

**What exists already.** `watch_note` at [`lib.rs:610`](../src-tauri/src/lib.rs:610) watches the
parent directory, and we already hash what this process last wrote so our own saves are ignored. We
hold the previous text in memory. The diff is ours; only the sentence is the model's.

**It summarizes a transaction, not a text diff.** Per [`PRODUCT.md`](PRODUCT.md) rule 4a, an
external file change is imported as a named block-level transaction like any other change. The model
is given *that* — which blocks moved and how — never two versions of a document to compare. This is
both more accurate and dramatically cheaper against an 8K window, and it means the same feature
works unchanged when the change came from a human, an agent, or another client instead of from disk.

**Model choice.** On-device, mandatory. File changes fire constantly while an agent works — PCC's
daily quota would be gone in an afternoon, and §3.1 forbids quota UI on the reading path. The 8K
window is sufficient *because we send the changed region, never the document*. If a change is too
large to summarize, we say nothing and reload silently, exactly as today.

**Risks.** A wrong summary is worse than no summary — it is the same class of defect as a silently
normalized paragraph, and our byte-fidelity culture should treat it that way. This is the feature
that most needs the Evaluations framework. The hard design work is *where the sentence appears*
without moving the page or stealing focus; the model call is the easy part.

**Estimate:** ~3–5 days after the bridge. Mostly placement and evaluation, not integration.

### 5.2 Paste a screenshot, get a document — *recommended second*

**What it is.** The last rung of the [`TECH-SPEC.md`](TECH-SPEC.md) recognition ladder. Paste an
image of a table, a whiteboard diagram, or a terminal window; get a real GFM table, real Mermaid, a
real ANSI card.

**What exists already.** Ten deterministic sniffers in
[`paste-sniffers.ts`](../src/adapters/editor/paste-sniffers.ts), priority-sorted. Critically, the
handler at [line 182](../src/adapters/editor/paste-sniffers.ts:182) reads `text/plain` and
`text/html` and returns `false` when both are empty — which is exactly what an image paste looks
like. **Image pastes never reach the ladder at all today.** Two pieces of work, then: an image
branch before that bail-out, and the model as the final rung after every sniffer declines.

**Why it fits.** Deterministic recognition stays first, always. TECH-SPEC §4.4's "never guess
silently wrong" rule already governs the fallback, and the async placeholder pattern already exists
at [line 223](../src/adapters/editor/paste-sniffers.ts:223) where renderer validation resolves
before insertion. The model rung reuses that shape verbatim: if it does not validate, fall back to
the image, do not guess.

**Model choice.** On-device with image attachment, plus `OCRTool` for text-heavy captures.

**Risks.** Photo-of-a-diagram to correct Mermaid is the quality question, and it is not obviously
solved. Ship the easy classes first (tables, terminal captures, code) and treat diagram extraction
as a separate bet.

**Estimate:** ~1 week after the bridge, plus open-ended quality work on diagrams.

### 5.3 Index and find — *conditional on §3.2*

**What it is.** Documents the user has opened become findable by meaning from system Spotlight —
"the runbook Claude wrote last week" — with no search UI of ours.

**What it needs.** `@AppEntity` conforming to `IndexedEntity`, with `@Property(indexingKey:)` on
title and body, donated as documents are opened. Apple's published App Schema domains are Messages,
Photos, Mail, Contacts — **there is no document or note domain**, so this is a custom entity, which
means more of our own modeling and less system-supplied behavior than the marketing implies. It
also needs App Intents compiled into a proper app bundle, which Tauri's bundler does not make easy,
and `AppIntentsTesting` to verify through real system pathways.

**Why it is conditional.** It requires accepting §3.2 — that we keep an index of the user's content.
And it is the item most likely to force a native shell around the web canvas, which makes it a
strategic decision, not a feature.

**Estimate:** unclear, and deliberately so. Do not size this until the bridge is proven and §3.2 is
settled.

### 5.4 Ask the folder — *depends entirely on 5.3*

**What it is.** Ask a question, get an answer rendered as a document block. No chat panel, no
session, no history.

**What it needs.** `SpotlightSearchTool` retrieves from the index that §5.3 builds. Without §5.3
there is nothing to retrieve from — this is the correction noted in §0. The two are one feature in
two stages, and pretending otherwise understates §5.3's cost.

**Model choice.** This is the one legitimate PCC case: explicitly user-initiated, benefits from the
32K window and reasoning, and a quota message here is an honest answer to something just asked.
Requires the §2 entitlement application to have succeeded.

**Estimate:** small *after* 5.3. Meaningless before it.

---

## 6. Architecture placement

The dependency direction in [ADR-0001](decisions/0001-single-product-modular-architecture.md) is
not negotiated by this work, and does not need to be.

Add one port to [`ports.ts`](../src/application/ports.ts) alongside `FilePort` and
`DiagramRenderer` — `IntelligencePort`, with roughly: `availability()`, `summarizeChange()`,
`recognizeImage()`, `answer()`. Then two adapters under `src/adapters/intelligence/`: the
Foundation Models one for macOS, and an unavailable one that answers no to everything. Compose in
[`tauri.ts`](../src/app/tauri.ts) and [`browser.ts`](../src/app/browser.ts).

`domain` never learns any of this exists. `npm run check:boundaries` keeps passing unchanged.

The unavailable adapter is the load-bearing piece, not a stub. It is the path taken by the browser
build, every Intel Mac, every Mac on macOS 26 or earlier, and any user who has not enabled Apple
Intelligence. **That is a large fraction of users, and for all of them SimpleMark must be exactly
the product it is today** — not a degraded one with disabled affordances. Every feature above is
specified to vanish, not to grey out.

---

## 7. Sequencing

Each phase gates the next. Nothing after phase 0 is worth starting until phase 0 is boring.

| Phase | Work | Visible to users | Gate to proceed |
| --- | --- | --- | --- |
| **0a** | Audit `writingToolsBehavior`; set `.complete` if reachable | Better Writing Tools | none — do this now, it is independent |
| **0b** | Apply for PCC entitlement | nothing | none — lead time, start early |
| **1** | Swift static library + Rust FFI, macOS-gated; `IntelligencePort` and both adapters | nothing | availability check works; unavailable path proven on a non-eligible machine |
| **2** | §5.1 what changed, on-device | first real feature | Evaluations show summaries are accurate on our own corpus |
| **3** | §5.2 screenshot paste, on-device | second real feature | fallback-not-guess behavior holds under TECH-SPEC §4.4 |
| **4** | Decide §3.2; if yes, §5.3 then §5.4 | search and ask | explicit product decision, not a technical one |

Phase 1 is roughly a week and produces nothing demonstrable, which is uncomfortable and unavoidable.
Phases 2 and 3 are where the product gets better, and they are the two that add no visible control
to the reading surface.

Board work under this scope goes on the `simplemark` Switchboard project per
the contributor guide, and carries `code_strict` like any other code task.

---

## 8. Open questions

1. **Does PCC belong on the reading path at all?** §3.1 proposes no. Needs a decision before phase 2,
   because it determines whether the 8K window is a constraint we design around or a temporary one.
2. **Do we accept keeping a Spotlight index of opened documents?** §3.2. Determines whether phases
   4 exists.
3. **Is there an iOS SimpleMark?** §4.1. Independent of AI, but AI scope cannot be settled until it
   is.
4. **Does §5.3 force a native shell?** If App Intents in a Tauri bundle proves unworkable, this
   stops being a feature question and becomes an architecture one.
5. **What does the reader see when the model is unavailable?** §6 asserts "nothing." Confirm that
   is the product's answer and not just the easy engineering answer.
6. **Exact API signatures.** Everything in §1 needs confirming against the macOS 27 SDK, per §0.

---

## 9. Sources

Apple, primary:

- [What's new in the Foundation Models framework — WWDC26 session 241](https://developer.apple.com/videos/play/wwdc2026/241/)
- [Build with the Apple Foundation Model on Private Cloud Compute — WWDC26 session 319](https://developer.apple.com/videos/play/wwdc2026/319/)
- [Build intelligent Siri experiences with App Schemas — WWDC26 session 240](https://developer.apple.com/videos/play/wwdc2026/240/)
- [LLM search using Core Spotlight — WWDC26 session 246](https://developer.apple.com/videos/play/wwdc2026/246/)
- [Discover new capabilities in the App Intents framework — WWDC26 session 345](https://developer.apple.com/videos/play/wwdc2026/345/)
- [Meet Core AI — WWDC26 session 324](https://developer.apple.com/videos/play/wwdc2026/324/)
- [Dive deeper into Writing Tools — WWDC25 session 265](https://developer.apple.com/videos/play/wwdc2025/265/)
- [WWDC26 Apple Intelligence guide](https://developer.apple.com/wwdc26/guides/apple-intelligence/)
- [WWDC26 macOS guide](https://developer.apple.com/wwdc26/guides/macos/)
- [How to get Apple Intelligence — Apple Support](https://support.apple.com/en-us/121115)

Non-Apple, used only where Apple has published nothing:

- [Tauri — Mobile plugin development](https://v2.tauri.app/develop/plugins/develop-mobile/) (iOS Swift plugin mechanism)
- [tauri-apps/tauri#12137](https://github.com/tauri-apps/tauri/issues/12137) (no macOS Swift plugin support)
- [tauri-swift-runtime](https://github.com/Choochmeque/tauri-swift-runtime) (community Rust↔Swift bridge)
- [WebKit — `WKWebViewConfiguration.h`](https://github.com/WebKit/webkit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKWebViewConfiguration.h) (`writingToolsBehavior` declaration)
