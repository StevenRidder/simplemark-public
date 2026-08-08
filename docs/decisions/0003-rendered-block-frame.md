# ADR-0003: Rendered blocks keep a frame; their controls fade in

- **Status:** Accepted
- **Date:** 2026-08-02
- **Decision owners:** SimpleMark maintainers
- **Resolves:** the open question in [`DESIGN.md` §10.2](../DESIGN.md) and item 2 of §12
  "Other open questions"

## Context

`DESIGN.md` §10.2 defines one shared frame for every extension-rendered block, so a
future third-party block is indistinguishable from a built-in:

```
┌─────────────────────────────────────────────────────┐
│ ⟨type⟩ · ⟨provenance⟩              [Edit source] [⧉] │  ← block bar, on hover
├─────────────────────────────────────────────────────┤
│              rendered output (NodeView)             │  ← extension owns this rect
└─────────────────────────────────────────────────────┘
```

It then left a question open deliberately:

> **Open question for build time:** the frame is legible but heavier than Bear would
> use. The alternative is bare blocks in the prose with controls fading in on hover.
> Decide during the first UI pass with real content on screen.

EDITOR-1 is that first pass. The decision is now made against a running editor
holding real prose and a real rendered Mermaid diagram, in both colour schemes,
rather than against a static mock.

## Decision

**Keep the frame. Fade the controls.**

The rendered block keeps its own surface — `--soft` background, 13px radius, no
border — so a diagram is visibly a distinct object rather than a picture dropped
between paragraphs. The block bar's contents (the type label and **Edit source**)
render at `opacity: 0` and become visible on `:hover` or `:focus-within`.

This is the hybrid of the two options in §10.2, and it is what the wireframe's own
prose already implied with "block bar, on hover" even though the wireframe mock
shows the controls permanently visible.

## Why

Judged with real content:

- **The frame earns its weight.** A Mermaid diagram is not prose. Without a surface
  it floats ambiguously between paragraphs, and the eye has to work out where the
  block starts and stops. The soft panel answers that instantly and costs one
  background colour — no border, no shadow, no header rule.
- **Permanent controls were the actual noise, not the frame.** In the wireframe the
  `mermaid` label and **Edit source** button sit in the corner at all times. On one
  diagram that reads as informative; scrolling a note with several, it reads as
  chrome competing with the writing. Hiding them until the pointer or keyboard
  arrives removes that without losing the affordance.
- **A bare block loses the extension seam.** The frame is the contract that makes a
  third-party block look native. Dropping it in v1 would mean re-introducing it when
  the plugin API opens, and every existing note would shift.

## Consequences

### Positive

- The calm state is genuinely calm: at rest a note shows prose and pictures, no
  buttons.
- One frame still serves every future renderer — DOT, KaTeX, Vega-Lite, Markmap.
- Keyboard users are not penalised: `:focus-within` reveals the same controls, and
  the toggle takes a visible focus ring.

### Costs

- Hover-revealed controls are undiscoverable on touch, where there is no hover. A
  touch build needs an explicit affordance — tap-to-reveal or a persistent handle —
  and that decision is deferred to the iOS/iPad shell.
- Anything relying on the label being visible for a screenshot must hover first; the
  UI suite does exactly that.

## Rejected alternatives

### Bare blocks in the prose

Rejected. It reads well for a single diagram in a short note and badly everywhere
else: block boundaries become ambiguous, and the shared frame that makes a
third-party block indistinguishable from a built-in disappears.

### The wireframe's permanently visible block bar

Rejected as the default, though it remains what the mock shows. It is the right
behaviour while hovering and the wrong one at rest.
