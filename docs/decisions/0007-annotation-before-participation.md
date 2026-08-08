# ADR-0007: Annotation is decomposed, and its human half ships first

- **Status:** Accepted
- **Date:** 2026-08-07
- **Decision owners:** SimpleMark maintainers
- **Supersedes:** the single-step "optional local agent participation" shape in
  [`ADR-0002`](0002-local-document-session-before-crdt.md) and
  [`ADR-0005`](0005-rendered-document-before-agent-participation.md), and the Phase 3 row of
  [`COLLABORATION.md`](../COLLABORATION.md) §8. It does not supersede their `DocumentSession`
  authority, source-preservation, fence, or later multi-client decisions.

## Context

`ADR-0005` established the order — prove the rendered document, then consider agent participation —
but left the second half as one undifferentiated step. `COLLABORATION.md` §8 called it *"optional
local agent participation"*, and the plan of record treated it as a single deliverable containing a
`DocumentSession`, a scoped agent transaction, a conversation surface, control fences, and separate
undo.

Two things made that shape wrong.

**The first is that it bundles an unresolved design problem with solved ones.** Anything where an
agent answers a question needs a provider, a model, and a key. `PRODUCT.md` does not want a provider
setup and model picker becoming visible product surface, and no design resolves that tension. Under
the bundled shape, the parts that need no AI at all — anchoring a note to a passage, listing it,
resolving it — could not ship until that problem was solved.

**The second is that a real workflow needs only the human half.** Reading a document with a customer
on a call, a question arrives and there are about two seconds to capture it. That is annotation, not
collaboration: no participant, no permission, no agent, no room. It is
[`COLLABORATION.md`](../COLLABORATION.md) §4's Conversation layer with every participant removed,
and it is useful on its own — which is also the honest test of whether the Conversation layer is a
capability or a dependency.

Separately, `COLLABORATION.md` §4 and §4.1 specified where threads live and how they anchor. Both
were written for a live `DocumentSession` that does not exist yet, and neither survives contact with
a note opened from an arbitrary folder.

## Decision

### Annotation decomposes into five sub-projects

| | Sub-project | Depends on | AI involved |
|---|---|---|---|
| **A** | **Anchored notes** — highlight a passage, capture a note, it stays attached | — | No |
| **B** | **Resolve** — close a thread; it writes nothing to the document | A | No |
| **C0** | **AI connection** — provider, model, key | — | Setup only |
| **C** | **Ask** — an agent answers in a thread and **cannot edit the document** | A + C0 | Yes |
| **D** | **Agent edits from a thread** | A + C + `COLLABORATION.md` | Yes |

A and B are ordinary product work. **C0 is an unresolved design problem, not plumbing**, and it
gates C. D is larger than A, B and C combined, and it is the step that requires everything
`COLLABORATION.md` specifies: the authority, the scope, the fence, and separate undo.

The decomposition is a sequencing decision, not a redesign. Every constraint `COLLABORATION.md` §5.7
places on an agent in a document still applies unchanged at D.

### A and B are not gated on the agent-participation trial

`ADR-0005`'s gate governs putting an **agent** inside the document. Anchoring a human's own note to
a passage adds no participant, no authority, no MCP requirement, and no control channel, so it is
not behind that gate. C and D remain behind it in full.

This is the same distinction `MCP-SERVER.md` §10.2 draws for opening a note: the rule protects a
human's attention, and it governs what may act inside that attention rather than what may exist.

### Threads live in application data, never beside the document

Superseding [`COLLABORATION.md`](../COLLABORATION.md) §4's `.simplemark/threads/<noteId>.json`:

| Document | Thread file |
|---|---|
| has a front-matter `id` | `<app data>/SimpleMark/threads/<id>.json` |
| would not take an id (read-only, or unwritable) | `<app data>/SimpleMark/threads/path-<sha256 of absolute path>.json` |

A note opened from `~/Downloads` must not cause a hidden directory to appear in `~/Downloads`. **The
app is a guest in folders it does not own** — the same instinct as `MCP-SERVER.md` §11's vault jail,
applied to the app's own writes rather than an agent's.

The cost is accepted and stated: copying the `.md` elsewhere does not carry its notes. Exporting an
annotated copy is out of scope. The layer asymmetry `COLLABORATION.md` §4 depends on is unchanged —
losing the sidecar loses discussion, never content — and it is strengthened, because the sidecar is
now somewhere a document copy cannot silently half-carry it.

The one exception, agreed explicitly: a note's **identity** goes in front matter. One `id:` line, a
normal Markdown convention, preserved verbatim like all front matter. Nothing else this feature does
ever writes to the `.md` — resolving a thread does not write back.

### Anchors are text, and there are two mechanisms for two different jobs

`COLLABORATION.md` §4.1 specified session-local block/range anchors owned by `DocumentSession`.
That is right for a participant submitting a transaction and wrong for a note that must survive the
app being closed, the file being edited by another tool, and the document being reopened a week
later.

| Job | Mechanism | Owner |
|---|---|---|
| A human's note, across sessions and external edits | Quote + 30 characters of context either side | `domain/notes/anchor.ts`, pure |
| A participant's scope and edit target, within a session | Opaque, authority-issued token | The document authority ([`ADR-0004`](0004-mcp-as-participant-client.md) §6) |

These are not competing sources of truth; they answer different questions. A note anchor must be
re-derivable from text alone because the text is all that survives. A participant anchor must be
opaque precisely so an agent cannot mint one.

**No fuzzy matching, in either.** Ambiguity resolves to a visible orphan, never to a guess: a note
on the wrong sentence is worse than a note that admits it is lost. While a document is open,
decoration positions map forward through every transaction, and the anchor is re-derived on close —
so editing in SimpleMark teaches the anchor its new wording instead of staling it.

### The rail is conditional, and that is what keeps the no-rail rule intact

`DESIGN.md` §6 and §10.1 forbid a permanent activity, chat, agent or inspector rail.
`PRODUCT.md` lists comments among the surfaces that demonstrate machinery instead of value.

A rail that exists only while something is unresolved is not a permanent surface. **No open threads,
no rail** — the element is absent from the DOM, not empty. A document with nothing outstanding looks
exactly as it does today.

## Consequences

### Positive

- The useful half of the Conversation layer ships without waiting on a provider decision nobody has
  made, and without adding a participant to the document.
- `C0` is named as a design problem in its own right rather than being discovered inside a larger
  deliverable and quietly answered with a model picker.
- Whether the Conversation layer is a capability or a dependency becomes observable: A and B are
  usable alone, or they are not.
- Two anchor mechanisms with two stated jobs is honest, where one mechanism stretched across both
  jobs would have failed at whichever it was not designed for.
- Threads survive a note being renamed or moved anywhere, which the beside-the-document location
  could not offer.

### Costs

- A degraded thread file, keyed by path, is found again only at the same path.
- Copying a `.md` elsewhere does not carry its notes, and no export produces an annotated copy.
- Two anchor mechanisms exist in one product, and a future reader must be told which is which —
  which is why the table above is in an ADR rather than in one feature's spec.
- `D` still owes everything `COLLABORATION.md` specifies. This decision reduces what must be built
  before something ships; it does not reduce what live agent editing eventually costs.

## Rejected alternatives

### Ship the whole Conversation layer at once

Rejected because it makes an unresolved provider-surface problem block work that needs no provider,
and because it would put an agent in the document before anything proved the anchoring beneath it
works.

### Store threads beside the document in `.simplemark/`

Rejected because opening one file from a folder the app does not own would create a directory there.
The portability this buys — a copied `.md` carrying its notes — is available later as an explicit
export, and is not worth writing into every folder a person browses.

### One anchor mechanism for notes and participants

Rejected in both directions. Text anchors cannot be authority-issued, so an agent could mint its own
scope. Opaque session tokens cannot be re-derived after the app closes, so a note would not survive
reopening.

### Fuzzy matching to reduce orphans

Rejected for now. Approximate matching is what silently reattaches a note to a sentence that merely
resembles the original. If real use produces too many orphans, it is a later change justified by
evidence rather than by intuition.

## References

- The anchored-notes design and implementation plan, 2026-08-06. Both are internal working
  documents; **this ADR is the durable record of their load-bearing decisions**, which is why the
  decomposition, the storage location and the anchor mechanism are restated here in full rather
  than referenced.
- [`PRODUCT.md`](../PRODUCT.md) — product contract and the machinery-versus-value rule
- [`COLLABORATION.md`](../COLLABORATION.md) — the Conversation layer, §4 and §4.1 amended here
- [`ADR-0002`](0002-local-document-session-before-crdt.md) — `DocumentSession` authority
- [`ADR-0004`](0004-mcp-as-participant-client.md) — opaque authority-issued anchors and scopes
- [`ADR-0005`](0005-rendered-document-before-agent-participation.md) — the sequencing gate this refines
