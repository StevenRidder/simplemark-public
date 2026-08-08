# SimpleMark — WellView as a pastable format

**Paste a wellbore survey; get a readable Markdown table with a schematic drawn on top.**

- **Status:** Scoping. Unscheduled, and blocked on one fact nobody has checked yet — see §6.
- **Date:** 2026-08-04
- **Assumes:** Peloton WellView. If "WellView" means something else here, §2 and §6 change and the
  rest holds.
- **Companion to:** [`DESIGN.md`](DESIGN.md) §4 (paste recognition), [`RENDERERS.md`](RENDERERS.md)
  (the renderer contract), [`SKETCH-TO-DIAGRAM.md`](SKETCH-TO-DIAGRAM.md) (the expensive cousin)

---

## 1. Why this is the good one

A domain format is the cheapest possible proof of SimpleMark's thesis, because the fallback *is*
the product.

Paste a survey and the `.md` gains an ordinary Markdown table — depth, inclination, azimuth, rows a
person can read. On top of it, a rendered wellbore schematic or survey path. Open the same file in
Obsidian, on GitHub, in `less`, in five years: still a readable table. Not a broken proprietary
blob, not an "install our plugin" placeholder.

That is [`PRODUCT.md`](PRODUCT.md)'s claim — Markdown is the durable result — stated in a domain
where the alternative is genuinely lock-in. The rendered view is a convenience over the file. The
file is the asset.

Compared with [`SKETCH-TO-DIAGRAM.md`](SKETCH-TO-DIAGRAM.md): **no model call, no key handling, no
[ADR-0005](decisions/0005-rendered-document-before-agent-participation.md) to supersede, no review
gate**, because deterministic parsing either recognises the payload or declines. It is the same
architectural pattern with none of the gates.

## 2. The one unknown that decides the cost

**What does WellView actually put on the clipboard?**

Nothing else in this document is uncertain. This is:

| If the clipboard carries | Sniffer difficulty | Notes |
|---|---|---|
| `text/plain` TSV or CSV with a stable header row | **Trivial** | A header signature and a column count. Done in an afternoon |
| `text/html` table | **Easy** | Same shape as the existing `svgInHtml` extraction |
| A proprietary or opaque flavour | **Hard, possibly not worth it** | May need an export file path instead of paste |
| Nothing structured — a bitmap | **Not viable as a paste format** | Would fall to the sketch route, with all its gates |

Everything below assumes one of the first two. **Paste something out of WellView into a plain text
editor and look at it** — that is the whole discovery step, and it should happen before any code.

## 3. Where the work lands

The pipeline is already split, and a new format touches both halves. From
[`recognition.ts`](../src/domain/paste/recognition.ts):

> Conditions 1 and 2 live here because they are pure rules over text and belong to `domain`.
> Conditions 3 and 4 need a parser, a sanitiser, and a DOM, so they live in the adapters.

So:

| Layer | What goes there | Existing example to copy |
|---|---|---|
| `domain/paste/recognition.ts` | The **signature** — a pure predicate over text | `looksLikeMermaid`, `MERMAID_SIGNATURE` |
| `domain` | The **parse** — text → survey rows, and rows → Markdown table | `paste/exhaust.ts` |
| `adapters/renderers/` | The **renderer** — rows → SVG schematic | `mermaid-renderer.ts`, `graphviz-renderer.ts` |
| `application/ports.ts` | Nothing new. `DiagramRenderer` already fits | — |

The renderer contract is already the right shape ([`ports.ts:137`](../src/application/ports.ts:137)):
`languages` plus `render(language, source) → { ok: true, markup } | { ok: false, message }`. A
wellbore renderer claims a language like `wellbore-survey` and returns inert SVG. It must sanitise
and must never throw — a malformed survey renders an error card, not a broken document.

### 3.1 Priority

[`DESIGN.md`](DESIGN.md) §4.2 fixes the order: `svg-in-html (30) → svg (20) → mermaid (10) →
image (5)`. A tabular WellView sniffer does not compete with any of these — nothing that looks like
a survey table also looks like SVG or Mermaid — so it slots in without disturbing the ruling table.
Give it a number and add it to the table; do not leave it implicit.

### 3.2 The rule that governs all of it

DESIGN.md §4.4: **never guess silently wrong.** For this format specifically:

- A signature match is a cheap filter, not a decision. Parsing is the real gate, exactly as
  `mermaid.parse()` is for Mermaid.
- A payload that *looks* like a survey but fails to parse is **not claimed** — it pastes as plain
  text. It never half-converts, and it never invents a column it could not read.
- Units are data, not a guess. If depth units are not present in the payload, they are not
  inferred. A schematic that silently assumes feet when the source was metres is the worst outcome
  this feature can produce, and it is worse than not shipping it.

## 4. What lands in the document

The table is the artifact. Sketch of the intended output:

````markdown
```wellbore-survey
MD,INC,AZI
0,0.00,0.00
500,1.20,171.40
1000,2.80,168.90
```
````

A fenced block with a declared language keeps it a **normal Markdown code fence** — portable,
diffable, agent-authorable, and rendered by SimpleMark into a schematic. That is the same
arrangement Mermaid already uses, so it needs no new document concept and no new fidelity rule.

The alternative — a plain Markdown table plus a separate rendered block — reads better in foreign
editors but gives the renderer nothing to anchor to. **Recommendation: the fenced block**, matching
Mermaid, with the header row inside it so the fence is still legible as text to a human who has
never heard of SimpleMark.

This is a real choice and should be made explicitly, not defaulted into.

## 5. Scope boundaries

Deliberately **not** in this scope:

- **Editing the survey through the schematic.** That is an embedded editor, and
  [`RENDERERS.md`](RENDERERS.md) §1 rules it out: truth lives in the note as text.
- **Round-tripping back into WellView.** SimpleMark reads; it is not a wellbore data system.
- **Computing anything.** No dog-leg severity, no TVD derivation, no interpolation. Rendering what
  was pasted is the feature; deriving new engineering values makes SimpleMark answerable for their
  correctness.
- **Live connection to a WellView instance.** Paste is the whole acquisition story.

## 6. First slice

1. Paste from WellView into a text editor. Record exactly what the clipboard holds. **Stop here if
   it is opaque** — the rest of this document does not apply.
2. Pure sniffer + parser in `domain`, with fixtures from step 1. No UI, no renderer.
   `tests/domain/paste-recognition.test.ts` is the pattern to follow.
3. Fallback only: pasting produces the fenced block and nothing renders yet. **Ship-worthy on its
   own** — a portable, readable table is already most of the value.
4. The renderer, last. It is the demo, but it is the least important half.

If step 3 is not useful by itself, the format is wrong and step 4 will not rescue it.

## 7. Open questions

- Which WellView payload — survey, daily report, wellbore schematic, tubulars? They are different
  formats and should not be assumed to share a sniffer.
- Is the header row stable across WellView versions and per-site configuration? A signature that
  depends on a customisable column order is a signature that breaks quietly at another site.
- Units: present in the payload, or out of band? §3.2 makes this load-bearing.
- Does anyone paste *out* of WellView today, or is export-to-file the real workflow? If it is the
  file, this becomes an open-a-file feature rather than a paste feature, and the acquisition half
  changes completely.
