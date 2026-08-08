# SimpleMark

**The beautiful living document for AI work.**

Your agent writes the Markdown. SimpleMark turns it into a document: open the local `.md` file,
see it rendered exceptionally, keep reading while the agent updates it, and click in only for a
small correction.

**Always rendered. Always your file.** No IDE, vault, account, provider setup, workspace, or
permanent Markdown source view.

![Current SimpleMark renderer prototype showing Markdown, Mermaid and SVG rendered in one document canvas](docs/assets/simplemark-demo.gif)

*Current pre-alpha renderer and correction proof, recorded from the running app in one unbroken
session. The canonical watched-file product demo is specified in [`docs/PRODUCT.md`](docs/PRODUCT.md).*

In practice: Codex, Claude, or another tool writes `plan.md`; SimpleMark shows that exact file as a
beautiful technical document and refreshes it cleanly as the file changes. Mermaid, SVG, math,
charts, tables, code, and technical material render inline. The source stays portable and yours.

SimpleMark is not an AI workspace or a cockpit for operating agents. Editing is a contextual escape
hatch. Agent participation and collaboration are optional later capabilities, hidden until invoked.

## The commitments

1. **Files are the truth.** Every feature round-trips to Markdown. Untouched blocks re-emit their original bytes — only blocks you actually edit are re-serialized.
2. **Rendered is the default.** Markdown punctuation is storage syntax, not the interface. Source appears only for the content you deliberately correct.
3. **External updates are ordinary.** An agent can change the same file while SimpleMark remains a calm, current reading surface.
4. **Typography is product behavior.** The page must feel like a document worth keeping open, not an IDE preview.

## What works today

**The canvas.** One continuous rendered page — no source/preview split. An untouched save is
byte-identical, and editing one block never renormalizes another: no renumbered lists, no repadded
tables, no restyled fences. A source map and a byte-diff suite hold that line against hostile
real-world fixtures.

**Renderers.** Mermaid diagrams · raw `<svg>` · KaTeX math with a proven malformed-math fallback ·
Graphviz/DOT · Vega-Lite charts from inline data or note-relative data files · ANSI terminal
captures · syntax-highlighted code · text cards · a composite renderer combining them. Large tables
render under a budget with deferral, so a huge table stays responsive rather than freezing the page.

**Paste.** A recognition ladder classifies pasted content — formal Markdown, callouts, and bounded
sniffers for terminal and tool exhaust — and renders it correctly without the user choosing a mode.

**Files.** Open any `.md` directly; no import, no vault, no workspace choice. Folder and note
browsing with collections and pins, native draft save and rename, Show in Finder, note-relative
asset and link resolution, and external-change watching with a superseding operation queue so a
burst of agent writes collapses into one calm re-render.

**Reader.** Whole-page pinch zoom, expanded reader zoom, remembered view and app state, window
geometry, a find bar, and reader navigation.

**Portable document commands.** Clipboard exports in portable formats and structural corrections
that survive the round trip, both reachable from a right-click. Native macOS menus, menu services,
and context menu are preserved rather than replaced.

**Desktop.** A Tauri native shell with its own file, catalog, chart-data, and document-link ports
behind the same application interfaces the browser shell uses — two adapter sets over one core, not
two apps. Cross-platform test builds, build provenance, an executable release-trust gate, and
update notification.

## Status

Pre-alpha, and now a real desktop app. The native macOS shell opens files and folders from disk,
watches them, and re-renders calmly when another process rewrites the file. Byte-fidelity
round-tripping, the renderer set, portable document commands, and reader controls all work.
Cross-platform test builds and the release-trust gate are in review.

Not done: the renderer-first product proof end to end, the one-real-day dogfood that picks the
default workflow, and the multi-client authority decision.

## Roadmap

The sequence is *see it → use it → refine it → ship it → then decide expansion*.

| # | Milestone | State |
|---|---|---|
| 1 | **See SimpleMark** — wireframe-backed editor and Markdown trust | Done |
| 2 | **Use SimpleMark** — one local note and Mermaid | Done |
| 3 | **Refine SimpleMark** — portable document commands | In review |
| 4 | **Ship SimpleMark** — cross-platform test builds and releases | In review |

Next, in order: turn AI work into living local documents (the renderer-first product proof); use
SimpleMark for one real day and let that choose the default workflow; then choose multi-client
authority — ProseMirror steps vs Yjs — from evidence rather than argument.

Collaboration, in-app agent participation, comments, and history stay behind that gate. The product
must be worth installing with all of them removed.

## Run it

```bash
npm install
npm run dev          # browser shell
npm run dev:native   # Tauri desktop shell
```

Then open the printed URL. The browser shell opens an in-memory fixture note, so nothing on disk
can be damaged from the web development path.

```bash
npm test            # unit and round-trip suites
npm run test:ui     # Playwright, against the real composition
npm run typecheck
npm run demo        # re-record the demo GIF (needs a running dev server)
```

## Architecture

Dependencies point one way only:

```
app → adapters → application → domain
```

`domain` imports nothing inward and knows nothing about ProseMirror, Mermaid, or the DOM.
`application` defines ports; `adapters` implement them. The rule is enforced mechanically by
dependency-cruiser:

```bash
npm run check:boundaries
```

## Documents

- [`docs/PRODUCT.md`](docs/PRODUCT.md) — the product contract, category difference, and sequencing
- [`docs/DESIGN.md`](docs/DESIGN.md) — the product design, including the paste-recognition chain
- [`docs/TECH-SPEC.md`](docs/TECH-SPEC.md) — the technical specification
- [`docs/RENDERERS.md`](docs/RENDERERS.md) — the renderer taxonomy and how new ones are added
- [`docs/COLLABORATION.md`](docs/COLLABORATION.md) — the live-session model
- [`docs/MCP-SERVER.md`](docs/MCP-SERVER.md) — the agent participant surface
- [`docs/RELEASE-CONTRACT.md`](docs/RELEASE-CONTRACT.md) — what any build-and-release workflow must do
- [`docs/RELEASE-TRUST.md`](docs/RELEASE-TRUST.md) — the executable release-trust gate
- [`docs/decisions/`](docs/decisions/) — architecture decision records
- [`docs/wireframe.html`](docs/wireframe.html) — the UI reference

## Licence

Copyright © 6th Element Labs. All rights reserved.

This source is published for reading and evaluation. It is not licensed for redistribution or derivative works. See [`LICENSE`](LICENSE).
