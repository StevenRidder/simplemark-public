# ADR-0005: Rendered document before agent participation

- **Status:** Accepted
- **Date:** 2026-08-02
- **Decision owners:** SimpleMark maintainers
- **Supersedes:** agent participation as part of the first product proof in `POC.md`, `ADR-0002`,
  and the Phase 0–1 plan; it does not supersede their `DocumentSession`, source-preservation, or
  later collaboration architecture

## Context

The original POC combined two questions:

1. Can SimpleMark preserve and beautifully render a local Markdown file?
2. Can one human and one local agent edit that document through the same `DocumentSession`?

Competitor and community research clarified that these questions do not have equal product weight.
MerMark, NeverWrite, CollabMD, and Mindle primarily help users operate AI work or collaboration.
Their interfaces expose sessions, models, tools, diffs, comments, files, history, participants, and
recovery. They solve real needs, but the accumulated controls turn the document into one panel of a
larger cockpit.

SimpleMark's primary user already has an agent that writes Markdown. The unmet job is to read,
judge, and occasionally correct that output outside a coding environment as a beautiful, living
technical document. Agent orchestration inside SimpleMark is not required to prove that job.

## Decision

The first product proof is the rendered-document experience specified in [`PRODUCT.md`](../PRODUCT.md)
and `POC.md`:

- open an arbitrary local `.md` file directly;
- show a beautiful rendered document immediately;
- render representative technical content inline;
- preserve untouched source byte for byte and save edits atomically;
- update calmly when an external agent or tool changes the file; and
- reveal editing only for a small, intentional correction.

The first proof contains no SimpleMark-hosted agent participant, MCP requirement, collaboration
room, provider setup, agent inventory, chat, activity feed, or multi-client authority.

The `DocumentSession` remains the single application authority for the open document. Both the
human editor and external-file import path use application commands rather than writing around it.
This preserves the seam required for a later MCP participant without placing that participant in
the first user experience.

## Later gates

Agent participation becomes eligible only after the renderer-first POC is useful on its own. Its
separate test asks whether scoped, attributed, interruptible transactions are better than the
simpler workflow in which the agent edits the file and SimpleMark watches it.

Multi-client collaboration remains gated after that. `ADR-0002` still governs the technical rule:
start from centralized ProseMirror step authority and compare a structured CRDT only if real use
demonstrates a masterless requirement.

## Consequences

### Positive

- The first demo proves the install reason rather than infrastructure.
- SimpleMark can serve every Markdown-writing AI without integrating each provider.
- The filesystem supplies the first agent integration and keeps the product local and cheap.
- Typography, rendering quality, source fidelity, file watching, and reading continuity become
  core acceptance criteria rather than polish after collaboration work.
- The product remains valuable if agent participation or multiplayer is never built.

### Costs

- The original live-agent POC and its board order must be resequenced.
- The external-change path must become a first-class product behavior earlier than planned.
- Direct in-app agent steering is postponed, even though its architecture is substantially
  specified.
- Marketing cannot rely on a model picker or chat panel as obvious AI feature theater; the product
  must prove its value through document quality and trust.

## Rejected alternatives

### Keep the live agent in the first POC

Rejected because it tests a more complex workflow before proving that the rendered document is
worth opening. It also risks designing permanent UI for run state, activity, scope, and control
before the user has asked SimpleMark to operate the agent.

### Remove the agent and collaboration architecture

Rejected. Scoped transactions, fences, attribution, revert, and multi-client tests remain useful
expansion designs. The sequencing changed; the underlying safety work did not become wrong.

### Become a read-only viewer

Rejected. A living document needs a small correction path, and the source-preserving structured
canvas is a meaningful advantage. Editing stays contextual and subordinate to reading.

## References

- [`PRODUCT.md`](../PRODUCT.md) — current product contract and language
- [`LESSONS-LEARNED-MARKDOWN-EDITOR-AUDIT.md`](../LESSONS-LEARNED-MARKDOWN-EDITOR-AUDIT.md) —
  competitor code and community evidence
- [`ADR-0002`](0002-local-document-session-before-crdt.md) — retained local authority and later
  multi-client decision
