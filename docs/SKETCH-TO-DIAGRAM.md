# SimpleMark — Sketch to diagram

**A photographed whiteboard becomes a Mermaid block, and the Markdown stays the artifact.**

- **Status:** Scoping. Not scheduled, and blocked on an ADR — see §7.
- **Date:** 2026-08-04
- **Companion to:** [`RENDERERS.md`](RENDERERS.md) (the renderer contract),
  [`TECH-SPEC.md`](TECH-SPEC.md) (paste recognition), [`ADR-0005`](decisions/0005-rendered-document-before-agent-participation.md)

---

## 1. The idea, and why it is not a bolt-on

Paste a photo of a whiteboard. It becomes a Mermaid flowchart in the document.

The reason this belongs in SimpleMark rather than in some diagramming app is that it is the
product's existing thesis applied to a new input. [`PRODUCT.md`](PRODUCT.md) says Markdown is the
durable result. Here the sketch is scaffolding and the **Mermaid source is the artifact** — it lands
in the `.md`, it diffs line by line, an agent can read and revise it, and it opens in any other
editor as text.

That is the same shape as the paste pipeline already in the repository: foreign input arrives,
portable Markdown comes out, the original is discarded. [`RENDERERS.md`](RENDERERS.md) §1 draws the
line this sits on — truth lives in the note as text, not in a sidecar blob, which is exactly what
separates a renderer from an embedded editor. A sketch-to-diagram feature that stored the drawing
as the source of truth would be an embedded editor and would be the wrong product.

## 2. What already exists

| Piece | State |
|---|---|
| Mermaid rendering | **Done.** `MermaidRenderer` behind the `DiagramRenderer` port |
| Mermaid source → live block | **Done.** `convertBlockToDiagram()`, `src/adapters/editor/milkdown-editor.ts` |
| Paste recognition by priority | **Done.** `src/domain/paste/recognition.ts` |
| Portable asset links | **Done.** `AssetReferencePort`, `insertAsset` |
| Image paste → asset | **Done** |
| Any AI provider wiring | **Absent.** No client, no key handling, no request anywhere in `application/` or `adapters/` |
| Drawing surface | **Absent, and deliberately out of scope** — see §3 |
| Review gate for generated content | **Absent.** Nothing in the product yet proposes content for acceptance |

The last mile — turning Mermaid text into a rendered, editable block in the document — is the part
that is finished. What is missing is everything upstream of it.

## 3. Photograph, not canvas

The obvious reading of "hand sketch a graph in the app" is a freehand drawing surface. **This scope
deliberately does not build one.**

- People sketch on whiteboards, napkins, and paper. They do not sketch with a trackpad. A canvas
  would be the hardest piece of work in this document and would produce worse input than a phone
  camera already produces.
- A drawing surface is the least differentiated thing here. Every diagramming tool has one, and
  none of them is the reason to open SimpleMark.
- The paste pipeline already accepts images. Photograph → paste is zero new acquisition code.

A canvas can arrive later if it earns its place against real use. It is not a prerequisite, and
building it first would delay the only interesting part.

## 4. The shape

```text
paste (image)
  → existing image path, asset stored
  → [new] "Convert to diagram" offered on an image block
  → [new] vision request: image → Mermaid source
  → [new] review gate: rendered result beside the source photograph
  → accept → existing convertBlockToDiagram() → Mermaid block in the document
```

Only three of those are new, and one of them is the whole feature.

### 4.1 The provider port

The architectural piece. A vision request is an application port with an adapter behind it, exactly
as `FilePort` is:

```ts
// application/ports.ts — sketch, not final
export interface DiagramTranscriber {
  /** Proposes diagram source for an image. Never writes to the document. */
  transcribe(image: ImageReference): Promise<TranscribedDiagram>
}
```

Per [ADR-0001](decisions/0001-single-product-modular-architecture.md), `application` defines the
port and imports nothing else; the adapter holds the HTTP client and the key. The composition root
wires them. Nothing about the provider may reach `domain`, and the transcriber must never apply a
transaction itself — it returns a proposal, and the human accepts it.

### 4.2 The review gate

**Not optional, and not a nicety.** Models misread messy arrows confidently: a photograph with an
ambiguous line produces plausible, wrong Mermaid with no signal that anything went wrong. That is
precisely the failure mode the contributor guide forbids — *"failures are visible and local; no silent
fallbacks, no turning missing evidence into a green result."*

So the generated diagram is **proposed**, never inserted:

- the rendered Mermaid and the source photograph shown together;
- accept, retry, or edit the source before accepting;
- nothing enters the document, and no transaction is applied, until accept.

A refusal or a failed request says so on the block. It does not fall back to inserting the image
silently and calling it done.

## 5. The decision this scope does not make

**Is the photograph kept after transcription?**

Both answers are defensible and they lead to different products:

| | Discard | Keep as sibling asset |
|---|---|---|
| Re-run later | Impossible — re-photograph | Cheap, and the obvious affordance |
| Document | Mermaid only, nothing else | Mermaid plus an `![](./sketch.jpg)` link |
| Portability | Perfect | Preserved — the app already writes relative asset links |
| Cost | None | A stray image file per diagram, forever |

The relevant constraint from [D7](DESIGN.md): the photograph can never be embedded in the `.md`.
If it is kept it is a sibling file behind an ordinary relative link, which the asset work already
supports. If it is discarded, the Mermaid is genuinely the only artifact.

Recommendation is **keep**, because the second run is where this feature gets good — the first
transcription is rarely right, and a retry that needs a new photograph is a retry nobody does. But
this is a product call, not an engineering one, and it should be made explicitly.

## 6. What would need building

| | Work | Size |
|---|---|---|
| 1 | `DiagramTranscriber` port + adapter, key handling, honest failure surfacing | Medium |
| 2 | Review gate UI: proposal, rendered preview beside source, accept/retry/edit | **Largest** |
| 3 | "Convert to diagram" offered on an image block | Small |
| 4 | Prompt and its evaluation against real sketches | Small to write, ongoing to trust |
| 5 | Insertion | **Zero.** `convertBlockToDiagram()` |

The instinct is that the model call is the hard part. It is not — it is a request with an image and
a prompt. The review gate is the work, because it is the thing that keeps a wrong answer from
becoming a document.

## 7. What blocks this today

[`ADR-0005`](decisions/0005-rendered-document-before-agent-participation.md) removed agent
participation from the first proof and made the rendered-document result precede it. Transcribing a
photograph with a model **is** agent participation, so this cannot land as written.

That is a sequencing block, not a rejection. Clearing it needs an explicit supersession record —
the contributor guide is unambiguous that accepted ADR history is not renumbered or rewritten as drive-by
cleanup. The honest argument for superseding is narrow and worth stating plainly:

> This is a one-shot transcription that produces a proposal a human accepts. It has no run
> generation, no interruption semantics, no session, and no ability to touch the document on its
> own. It is nearer to the paste pipeline than to the live agent ADR-0005 deferred.

Whether that argument holds is the first thing to settle. If it does not, the feature waits, and
waiting is fine.

## 8. Smallest honest first slice

If this is ever scheduled, the slice that proves the idea without building the product:

1. Paste a photograph of a whiteboard.
2. Right-click → **Convert to diagram**.
3. A panel shows the proposed Mermaid, rendered, beside the photograph.
4. Accept inserts it. Retry asks again. Cancel leaves the document untouched.
5. The photograph stays as a sibling asset link.

No canvas, no chat, no session, no streaming. If step 3 is not convincing on real whiteboards, the
feature is wrong and nothing further should be built.

## 9. Adjacent, and cheaper

A domain-specific paste format — a wellbore survey, an instrument export — wants the *same*
renderer and fallback machinery with **no model call and no ADR to supersede**. If the goal is to
prove the "foreign input becomes portable Markdown with a rendered view" pattern once more before
committing to agent participation, that is the cheaper experiment and it is available today.
