# SimpleMark — Renderers

**The technical content that turns AI-written Markdown into a document worth reading.**

- **Status:** Draft 1
- **Date:** 2026-08-02
- **Companion to:** [`TECH-SPEC.md`](TECH-SPEC.md) (recognition + acquisition), `AGENT-WORKSPACE.md`

---

## 1. The distinction that decides everything

Under [`PRODUCT.md`](PRODUCT.md), rendering quality is the product rather than supporting polish.
The human should see the diagram, equation, table, code, or chart—not the syntax the agent used to
describe it. Source is one click beneath the exact block only when correction is necessary.

| | **Renderer** | **Embedded editor** |
|---|---|---|
| Truth lives in | The note, as text | A sidecar file, as structured JSON |
| You edit by | Editing source; the view follows | Manipulating a canvas directly |
| An agent can author it | **Yes, natively** — it is just text | Only by writing JSON it cannot see |
| Merge behavior | Line-based, diffs cleanly | Opaque blob, conflicts are total |
| Cost to add | ~100 lines | A whole application |
| Portability | Renders or degrades to readable source | Broken embed elsewhere |

**The rule: default to renderers. An embedded editor must earn its place by being something you genuinely cannot describe in text.**

You can describe a flowchart. You cannot describe a sketch.

This is not asceticism. Every renderer is a format an external agent can write fluently while the
human consumes the output visually. Every embedded editor is a hole in that property and a risk of
turning the document into another authoring environment.

---

## 2. The v1 set

Six renderers. Together they cover most technical AI output without turning the app into a dozen
mini-applications or exposing a renderer cockpit.

| Content | Library | Stored as | Bundle | Tier | Agent-authorable |
|---|---|---|---|---|---|
| **Document** | remark / ProseMirror | the `.md` itself | — | core | ✓ |
| **Diagrams** | [Mermaid 11](https://mermaid.js.org/) | ` ```mermaid ` source | ~1.2 MB | core | ✓✓ |
| **Graphs** ✅ | [`@hpcc-js/wasm-graphviz`](https://github.com/hpcc-systems/hpcc-js-wasm) | ` ```dot ` source | 801 KB lazy chunk | verified | ✓✓ |
| **Math** ✅ | [KaTeX](https://katex.org/) | `$$…$$` (display) | ~255 KB + fonts | core | ✓✓ |
| **Code** | [Shiki](https://shiki.style/) | fenced code + lang | ~400 KB lazy | core | ✓ |
| **Charts** ✅ | [Vega-Lite](https://vega.github.io/vega-lite/) | ` ```vega-lite ` JSON spec | 797 KB lazy chunk | verified | ✓✓ |
| **Mind maps** | [Markmap](https://markmap.js.org/) | the note's own headings | ~180 KB | verified | ✓ (implicit) |

Everything in this table stores **human- and agent-editable source in the note**, renders live, and degrades to legible text in any other Markdown reader.

### 2.1 Why Vega-Lite is the standout

An agent writes forty lines of declarative JSON with the data inline. You get an interactive chart. The spec stays diffable, reviewable, and version-controlled — and the agent can amend it surgically with `patch_note` rather than regenerating an image.

````markdown
```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "description": "Warm pool hit rate by slot, week of Jul 28",
  "data": {"values": [
    {"slot": 1, "hit": 0.94}, {"slot": 2, "hit": 0.91},
    {"slot": 3, "hit": 0.88}, {"slot": 4, "hit": 0.72}
  ]},
  "mark": {"type": "bar", "cornerRadiusEnd": 3},
  "encoding": {
    "x": {"field": "slot", "type": "ordinal", "title": "Pool slot"},
    "y": {"field": "hit", "type": "quantitative", "title": "Cache hit rate"}
  }
}
```
````

Compare that with an agent producing a PNG: you cannot diff it, cannot amend it, cannot see what data it claims. The spec is the artifact.

**Constraint:** the note never fetches from the network (`TECH-SPEC.md` §5). Inline `data.values` is the primary path. A `"data": {"url": …}` naming a *local* file resolves against the note exactly as a Markdown link does and is loaded by the host; a remote one is refused with a message rather than stripped, because silently removing the data would leave a chart that renders empty and looks correct. See §4.65 for what shipped.

### 2.2 Why Markmap is unusual and worth it

Markmap doesn't render *new* content — it renders **the note you are already in**. Headings and lists become a mind map. There is no new syntax and nothing for an agent to learn; structure you already wrote becomes a second view of itself.

Two modes:

- **Command:** "Mind map this note" opens the current document's outline as a map in a side panel. Nothing is stored.
- **Block:** a ` ```markmap ` fence renders its own nested list as an embedded map, for a map that is part of the document rather than a view of it.

### 2.3 Why Graphviz alongside Mermaid

They fail differently. Mermaid is better at sequence, state, and journey diagrams and has friendlier syntax. Graphviz's layout engine is dramatically better on dense directed graphs — dependency trees, call graphs, the 39-asset topology in a real plant. Both are one text fence and neither is large. Having both means you never fight a layout engine.

---

## 3. The renderer contract

Every renderer in the table above implements exactly this and nothing more:

```ts
export interface Renderer {
  id: string                      // catalog id, e.g. 'vega-lite@5'
  kinds: string[]                 // recognition kinds it handles
  /** Parse-validate without rendering. Used by the L1 sniffer. */
  validate(source: string): boolean
  /** Render to a self-contained result. Runs in-process (core) or sandboxed. */
  render(source: string, opts: RenderOpts): Promise<RenderResult>
  /** Markdown written to disk for this block. Must be portable. */
  serialize(source: string): string
}

export interface RenderOpts { theme: 'light' | 'dark'; maxWidth: number }
export type RenderResult =
  | { kind: 'svg';    svg: string; height: number }
  | { kind: 'dom';    html: string; height: number }
  | { kind: 'raster'; blob: Blob; width: number; height: number }
```

Four rules, applying to all of them:

1. **`validate` is the sniffer.** L1 recognition (`TECH-SPEC.md` §3) calls it. If it returns true and `render` then fails, that is a bug, not a user-facing ambiguity.
2. **`serialize` round-trips.** `serialize(source)` parses back to the same source. Enforced by test.
3. **Theme-aware.** Every renderer takes `theme` and produces output legible on both grounds. A diagram that is black-on-black in dark mode is a defect.
4. **Click reveals source.** Universal interaction, no exceptions. The rendered thing is a view; the source is one click beneath it.

---

## 4. Storage rules per class

**Renderers** — source in the note, portable everywhere:

````markdown
```mermaid
flowchart TB
  A --> B
```
````

**Embedded editors** — sidecar plus a raster fallback plus an invisible pointer, per `DESIGN.md` §5:

```markdown
![Sketch: warm pool invalidation](attachments/9f3a2b.png)
<!-- simplemark:embed kind=excalidraw src=attachments/9f3a2b.excalidraw.json -->
```

In Bear, Obsidian, or GitHub that is a picture with a caption. In SimpleMark it is a live editor. The sidecar is JSON, so an agent can read and even modify it — awkwardly, but not opaquely.

---

## 4.5 The paste-exhaust tier (shipped)

The output formats of AI and terminal work. Not diagram languages — the daily
exhaust of working with agents: spreadsheet grids, diffs, terminal captures,
JSON dumps, file trees, stack traces. Every one has an unambiguous §4.2
signature, so all are magic-paste, and all render through `TextCardRenderer`
(sanitised HTML through the same `DiagramRenderer` contract — validate, then
inert markup or a message).

| Paste | Signature | Stored as | Renders as |
|---|---|---|---|
| **Excel/Sheets cells** | rectangular TSV in `text/plain` | a real GFM table | table — content, not a card |
| **Unified diff** | `diff --git` or `@@ -n,n +n,n @@` | ` ```diff ` fence | red/green review view |
| **ANSI capture** | SGR escape codes | ` ```ansi ` fence | coloured terminal card |
| **JSON** | parses to object/array | ` ```json ` fence | collapsible tree |
| **File tree** | ≥2 lines of `├──`/`└──` | ` ```tree ` fence | monospace card |
| **Stack trace** | `at fn (file:n:n)` / `Traceback` | ` ```stacktrace ` fence | folded behind line 1 |

Priorities slot into the §4.2 chain: svg-in-html 30 > svg 20 > **ansi 19 >
diff 18** (coloured git output carries both signatures; the escape codes are
the more specific claim) > **tree 14 > stacktrace 12** > mermaid 10 > **json
8** (anything both JSON and something more specific should never fall through
to the generic tree). TSV is not a sniffer — it converts through the Markdown
path into real document content.

The rule that keeps this honest is unchanged (§4.4): a signature hit converts
only when validation passes, one ⌘Z restores the raw pasted text, and prose is
never claimed.

**A document that quotes an artifact is not that artifact (BUG-5).** Every
signature above was originally tested for *presence*, so two box-drawing lines
anywhere claimed the whole payload — a long Markdown note whose ASCII
architecture diagram held four of them became one `tree` card, headings and
tables included. The tier now declines anything carrying Markdown block
structure: an ATX heading, a table row, or a fence. The file-tree signature
additionally requires the branches to be a quarter of the non-empty lines, so a
couple of stragglers cannot claim a wall of prose.

Prose deliberately does *not* mark a document. Terminal output is regularly
pasted with a sentence above it, and that still converts.

## 4.6 Graphviz and KaTeX (shipped)

Both magic-paste, both through the existing `DiagramRenderer` port and the
same NodeView as Mermaid — rendered block, editable source, visible failure.

**Graphviz.** Signature is the keyword *plus a brace*: `graph {` is DOT,
`graph LR` is Mermaid, and requiring the closing brace too keeps a half-pasted
graph from claiming the event. Priority 11, just above Mermaid, because the
brace is the more specific claim. The wasm is embedded in its own **lazy 801 KB
chunk** — never preloaded, no CDN, so a note that contains no graph pays
nothing and a note that does still reaches no external host. A UI test asserts
exactly that.

**The wasm needs the shell's permission.** Compiling a WebAssembly module is a
script operation under CSP, so the desktop policy in `src-tauri/tauri.conf.json`
carries `script-src 'self' 'wasm-unsafe-eval'`. Without that source WebKit
refuses the module outright and every `dot` block in the document reports an
engine failure — the graph is not degraded, it is absent. `'wasm-unsafe-eval'`
is the narrow grant on purpose: `'unsafe-eval'` would also unblock Graphviz and
would hand `eval()` back to the whole document to do it.

Note what "shipped" does and does not buy here. Vitest runs in Node and the
Playwright suite drives the Vite dev server, so **neither applies the shell
CSP** — Graphviz can be green across the entire suite, and correct in the
browser shell, while drawing nothing in the packaged app. That is exactly how
the missing directive reached a release. `tests/app/native-content-policy.test.ts`
locks the policy so it cannot be dropped silently, but a lock is not a
rendering: a change to the policy, the shell, or the wasm loader is only
verified by opening a `dot` block in a real desktop build.

**KaTeX.** Signature is `$$…$$` or a bare `\begin{env}…\end{env}`. Inline
`$x$` is deliberately **not** claimed: a paste is a block-level event and a
single dollar is far more often money than maths (`The licence costs $100` has
a test). `throwOnError: true` is set against KaTeX's default of rendering bad
input as red source text — that would put a broken formula in the document
dressed as a rendered one, which is precisely the silent-wrong-guess §4.4
forbids. `trust: false` strips `\href`, `\url` and `\includegraphics`
destinations entirely.

**Storage: `$$…$$`, the portable interchange form.** This shipped first as a
` ```math ` fence, reusing the code-block mechanism — convenient, but divergent
from what EDITOR-9 and the Bear inventory specify and from what Obsidian and
Notion users expect. It now uses a dedicated `math_block` node with remark-math
handling parse and serialise in both directions, so a file written elsewhere
opens rendered and saves back unchanged.

**`singleDollarTextMath: false` is load-bearing.** With remark-math's default,
`The licence costs $100 and renews for $250` parses the span between the two
dollars as inline math and silently mangles the sentence. Requiring `$$` keeps
prose with prices as prose — there is a test for exactly that line.

**Inline math is explicit, not guessed.** The More menu turns the current
selection into a first-class inline node stored as `$$x$$`. The double-dollar
form is deliberate: ordinary prices remain prose, the same source reopens as
math, and a double-click returns to the formula source. Footnotes use ordinary
`[^n]` references and definitions; underline uses portable inline `<u>` HTML;
wiki links stay readable as `[[Note]]` and resolve to a relative `Note.md`.

## 4.65 Vega-Lite charts (shipped)

Magic-paste, through the same `DiagramRenderer` port and NodeView as everything
else: rendered block, editable source, visible failure.

**There are two codegen paths, and the second one is the trap.**

*Expressions.*
Vega compiles spec expressions with the `Function` constructor. The packaged CSP
is `default-src 'self'` with no `'unsafe-eval'`, so that path fails in the
installed app — *and passes in dev, vitest and Playwright*, none of which
enforce the packaged policy. Vega's answer is to parse to an AST and evaluate
with `vega-interpreter`. Both paths were measured against the packaged policy in
`spike/vega-csp` **before** the renderer was written: codegen refused with
"Evaluating a string as JavaScript violates the following Content Security
Policy directive"; the interpreter drew the chart. Keep the spike — it is the
regression guard for the day someone simplifies the parse call.

*Data ingestion.* `vega-interpreter` covers expressions and **nothing else**.
Vega reads a `data.url` through d3-dsv's `parse()`, which compiles a row
constructor with `new Function` — refused by the same policy. Vega answers a
refused ingestion by *logging* "Data ingestion failed" and rendering axes with
no marks: a chart that looks like a chart with no data in it. This shipped
past every gate, including a packaged-build check of inline data, because
ingestion never runs for inline `values`.

So the renderer reads and parses data files itself (`chart-data.ts`, using
d3-dsv's `parseRows`, which has no codegen) and inlines the values before Vega
sees the spec. Vega never ingests.

**Do not try to prove this in vitest.** Blocking `new Function` there — global
binding and `Function.prototype.constructor` both — does not reproduce the
failure; the suite passes with the fix reverted. The only honest check is a
chart reading a real file in an installed build.

**Data comes from the note, or from a file the note names.** Inline
`data.values` is the primary path and the one an agent writes. A `url` resolves
through the *same* resolver as a Markdown link (`resolve_document_link`), so
relative paths resolve against the note's folder and may traverse upward, while
absolute paths and `file:` URLs are refused as machine-specific. No containment
rule was invented here that links do not already have.

`http`/`https` is refused with a message the reader can act on. A link hands a
remote URL to the system browser; a chart has nowhere to hand it, and this
loader does not follow one itself. The crate does already carry one network
path — `ai_chat_completion`, the diagram-error "Fix it" button's
`/chat/completions` call — but it is explicitly user-initiated: unreachable
until the person has configured an API key in Settings and clicked "Fix it" on
a broken diagram, never automatic. Consent-gated remote chart data — Allow /
Ask / Block, fetched by the Rust side, the way an email client handles remote
images — is a separate task and would be the app's first *implicit*, automatic
network access.

**Vega swallows a failed load** into its own logger and renders an empty chart
rather than rejecting. Left alone, a chart pointing at a missing file would draw
empty axes and look like a chart with no data in it — a silent wrong answer
(§4.4). So the loader captures the first refusal and `render` reports it.

**One house look, applied as Vega-Lite `config`** — the layer a spec overrides
rather than replaces, so a chart that names its own colour keeps it. Eight
categorical hues in fixed order, validated rather than chosen by eye against all
three grounds: worst adjacent colourblind separation ΔE 9.1 light and 8.4 dark
against a target of 8. The dark column is the same hues re-stepped, so a chart
keeps its identity in night rather than becoming a different chart. A
single-series chart needs `config.mark.color` explicitly — Vega only reaches for
the categorical range when something is encoded by colour.

**Paste requires `$schema`.** Chart specs are ordinary JSON objects with keys
like `data` and `mark`; sniffing for shape would claim any config file using
those words. Priority 8, directly above generic `json` (7), so something that is
both renders as a chart rather than an object dump.

## 4.7 Borrowed from livemark

[livemark](https://github.com/datisthq/livemark) (MIT © 2025 Evgeny Karev) is a
static documentation-site generator: build-time MDX, read-only, it never writes
a user's Markdown. Almost none of it transfers — its remark plugins emit MDX JSX
elements, which cannot round-trip to a file. Two things did.

**The ANSI state machine.** SimpleMark's first ANSI card handled only the
16-colour codes and read every other parameter as a standalone SGR code. That
was worse than incomplete: `38;2;R;G;B` consumed the `2` as *dim* and dropped
the colour, so real CI output rendered with actively wrong styling. livemark's
parser consumes the parameters of `38`/`48` properly, and its 6x6x6 colour-cube
and greyscale-ramp maths are lifted directly.

Our colour policy differs deliberately. Indices **0–15** resolve to
`var(--ansi-N)` — they are *names*, and a terminal green must stay legible on
both reader grounds (contract rule 3). Indices **16–255 and truecolor** are
absolute values the tool chose, emitted verbatim: fidelity wins there, and they
cannot be classes anyway.

**The callout transform.** `> [!NOTE]` and the other four GitHub types. The
marker pattern and the awkward part — rebuilding the first paragraph without the
marker while preserving anything else on that line — are livemark's shape.

Two differences. livemark maps `CAUTION` to "danger" and `IMPORTANT` to "info"
for its own component vocabulary; SimpleMark keeps GitHub's five names, because
the name in the file should be the name GitHub renders (D1). And an unknown type
stays an ordinary blockquote rather than being coerced to a nearest match.

Serialising back needed a `mdast-util-to-markdown` handler rather than node
emission, for reasons worth recording: as **text** remark escapes the bracket and
`> \[!NOTE]` is not a callout anywhere; as an **html node** it is treated as flow
html and leaves a bare `>` between marker and body. `containerFlow` also returns
a leading break that must be dropped. The round trip is byte-identical.

**Explicitly not borrowed:** MDX (violates D1 — not portable Markdown), their
build-time architecture, and their file watcher, which is Vite HMR plumbing. Our
external-change refresh has to reconcile a foreign write against a live document
with unsaved edits — a harder problem they never face, being read-only.

## 5. Later: the second tier

Deferred, in rough order of likely value.

| Content | Library | Class | Why it waits |
|---|---|---|---|
| **Drawings** | [Excalidraw](https://docs.excalidraw.com/) | Embedded editor | **The sanctioned exception** — see §6 |
| **Spreadsheets** | AG Grid / Handsontable | Renderer (CSV) → editor | CSV renders as a table in v1; editing is the increment. Easy to bloat: no formulas, no pivot tables, no charts-in-cells. |
| **Maps** | MapLibre GL | Renderer (GeoJSON) | GeoJSON already recognised at L1; interactive map is a verified renderer. Needs offline tiles or it violates no-network. |
| **Freeform canvas** | [tldraw](https://tldraw.dev/) | Embedded editor | Overlaps Excalidraw. Pick one; do not ship both. |
| **Flowchart canvas** | React Flow | Embedded editor | Mermaid already covers the content. This is visual authoring of the same thing — nice, not necessary. |
| **3D** | Three.js | Renderer (glTF ref) | Expensive, narrow, heavy. Only if a real need appears. |
| **Handwriting + OCR** | custom | Embedded editor | Waits on the public plugin API (`DESIGN.md` D5) |

### 5.1 The explicit no-list

- **No generic public plugin system before the renderers are proven.** Each renderer is a small local feature with one storage format and the click-to-edit rule. The API generalizes from four working examples, not from speculation.
- **No renderer that needs the network at render time.** Non-negotiable (`TECH-SPEC.md` §5).
- **No two renderers for the same job.** Excalidraw or tldraw, not both.

---

## 6. Excalidraw: the right kind of exception

If you find yourself drawing rather than describing, add exactly one canvas.

Excalidraw qualifies because it satisfies the conditions an embedded editor must meet:

| Condition | Excalidraw |
|---|---|
| Content genuinely cannot be text | A sketch has no source form |
| Structured, documented file format | `.excalidraw.json` — an agent can read and write it |
| Renders to a portable raster | PNG export, so other apps show the drawing |
| Self-contained, no network | Fully local |
| One clear storage format | One sidecar, one pointer comment |

Note what it does *not* get: it is not a precedent. The next canvas has to make the same case from scratch.

---

## 7. Bundle budget

| | Bundled | On demand |
|---|---|---|
| Core (remark, ProseMirror, Mermaid, KaTeX, Shiki) | ~2.4 MB | — |
| Graphviz wasm | — | 1.5 MB |
| Vega-Lite + Vega ✅ | — | 797 KB |
| Markmap | — | 180 KB |
| Excalidraw (later) | — | ~1.8 MB |

App binary target: **under 40 MB** including the Tauri shell. Everything past core is fetched once, hash-verified, cached, and works offline thereafter (`TECH-SPEC.md` §4.2).

---

## 8. Build order

| Phase | Renderers |
|---|---|
| **1** | Markdown + Mermaid (the vertical slice) |
| **2** | Shiki, KaTeX, images, CSV → table, JSON/YAML tree — all core, all offline |
| **3** | Catalog + sandbox proven with Graphviz as the first verified renderer |
| **4** | Vega-Lite ✅, Markmap |
| **5** | Converters: pptx, docx, pdf → raster |
| **7+** | Excalidraw, then spreadsheets or maps if the need is real |

By end of Phase 4 the v1 set is complete: **Markdown, Mermaid, DOT, KaTeX, Shiki, Vega-Lite, Markmap.** That is the set worth building, and it is small enough to build well.
