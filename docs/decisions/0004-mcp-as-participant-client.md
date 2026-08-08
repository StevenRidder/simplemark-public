# ADR-0004: MCP is a participant client of the document authority

- **Status:** Accepted
- **Date:** 2026-08-02
- **Decision owners:** SimpleMark maintainers
- **Supersedes:** the two-surface cold/live MCP split in `AGENT-WORKSPACE.md` §3–§4 and
  `COLLABORATION.md` §7, including its revision-hash compare-and-swap concurrency model

> **Sequencing amendment:** [`ADR-0005`](0005-rendered-document-before-agent-participation.md)
> makes MCP an optional later capability. This protocol remains accepted if direct agent
> participation is built, but it contributes no requirement or UI to the renderer-first POC.

## Context

Two accepted documents each specified half of the agent surface. `AGENT-WORKSPACE.md` specified
cold-file tools over a folder, with `sha256`-prefix revision hashes and compare-and-swap writes.
`COLLABORATION.md` §7 specified a parallel live-session surface and a routing rule: if a session
exists for a note, live tools apply and cold writes are refused with `note_is_live`.

That split assumed the Phase 1 shape, where *live* means *some window holds the note in memory*. It
does not survive the product SimpleMark is aiming at. `COLLABORATION.md` §5 states that there is no
second class of participant, and §3 describes multiple humans, multiple devices, and multiple agents
in one document. Under that model a note being worked on always has an authority; whether humans are
attached to it is a fact about presence, not about which API an agent should call.

The split had three concrete costs. Agents would carry two code paths and a routing error. Anchors
existed in two incompatible forms — content hashes and session-local positions — with no defined
behavior when a note crossed between them. And compare-and-swap is the wrong concurrency model for a
live document: on a note a human is typing in, every transaction an agent composes is stale by the
time it arrives, so CAS livelocks precisely where live co-editing is meant to be the feature.

Separately, hosting the agent surface required a decision. A separate local daemon owning the vault
was the obvious shape, and `ADR-0001` already rejects local daemons for internal functions.

## Decision

**The MCP server is a participant client of a document authority, exactly as a human's editor is.**
It holds an identity, a capability, presence, and a scope; it submits transactions; it is subject to
the fence. It never writes files, never operates the editor, and never holds a parallel document
model.

One tool surface serves every note, open or not. `docs/MCP-SERVER.md` is the contract.

### One surface

An agent calls the same tools whether a note has two humans in it or has not been opened in a month.
The difference is observable only as presence, control messages, and the attention rules that follow
from `COLLABORATION.md` §5.7. `note_is_live`, `not_live`, and the routing rule are retired.

### Rebase, not compare-and-swap

Transactions carry `baseVersion` — the last-seen authority version — and the authority rebases them,
following the ProseMirror collaborative-editing model adopted by `ADR-0002`. `baseVersion` is a
rebase input, not a guard. Refusal is reserved for what rebasing cannot fix: a superseded generation,
a capability or scope violation, active human focus, an invalid schema, an exhausted budget, or steps
that no longer apply.

`rebase_failed` is bounded by an explicit retry contract, because `COLLABORATION.md` §2.0 records
that Pitter Patter Collab's contention-retry path is unfinished and `ADR-0002` gate 5 requires
proving it. No collaboration library is named as a dependency by this decision.

### Opaque anchors and authority-issued scopes

Agents receive, return, and never parse anchors or scope tokens. This keeps `ADR-0002`'s deferred
authority decision genuinely open — the same contract is satisfiable by session-local anchors today
and by Yjs `RelativePosition` if a CRDT is ever selected — and it makes `COLLABORATION.md` §5.7's
one-scope-at-a-time rule structural rather than advisory, since an agent cannot mint a scope.

### Structural steps; Markdown parsed at the boundary

Peritext establishes that Markdown delimiter characters are the wrong unit for rich-text
collaboration. Agent-supplied Markdown is parsed into structural steps at the tool boundary and
committed as steps; it is never stored as source awaiting a merge. `patch_note`, which patched
Markdown source by anchor, does not survive.

### Hosted in the application process

The MCP endpoint is hosted inside the SimpleMark application — the process that already is an
authority and already owns document rules. Agent clients connect through a stateless per-connection
stdio shim over a loopback token. If the application is not running, the shim launches it in the
background and waits; it reports `app_unavailable` only on failure.

Launching the product is not standing up a daemon. The shim holds no state, owns no document rules,
has no independent lifecycle, and exits with its connection. `ADR-0001`'s rejection of local daemons
is preserved rather than worked around.

### The seam that makes staging honest

MCP calls `DocumentAuthorityPort` in `application`. A later local agent-participation phase
implements that port with the in-process `DocumentSession`; the multi-client milestone implements it with whatever the `ADR-0002` authority
spike selects. **No tool signature changes across that boundary.** Tools that exist in the contract
but are not yet built return `unsupported_in_phase`, and `vault_info` reports the live tool list.

## Consequences

### Positive

- Agents write one code path. "Edit this doc", "create one", and "export this thread" are the same
  calls whether or not a window has the note open.
- The tool surface survives the `ADR-0002` authority decision either way, because it never names an
  authority implementation.
- Live co-editing does not livelock, because staleness is rebased rather than refused.
- Scope, capability, and fence become structurally enforceable rather than conventions each tool
  must remember — the failure mode `SWITCHBOARD-KERNEL.md` §4 exists to prevent.
- Multi-participant injection is closed by contract: no message from any participant carries control
  authority.

### Costs

- Local agents require SimpleMark to be installed and launchable. There is no headless
  file-only mode, and there is no agent access from a machine without the app.
- Rebase is materially harder to implement than compare-and-swap, and its contention path is the
  known-unfinished part of the leading candidate library.
- `AGENT-WORKSPACE.md` §3–§4 and `COLLABORATION.md` §7 are now historical and must be read as
  superseded, not as current contract.
- The capability lattice, participant registry, and save-leader lease are real subsystems that a
  single-user notebook would not have needed.

## Rejected alternatives

### A local daemon owning the vault, relaying live calls to the app

Rejected. `ADR-0001` already rejects local daemons for internal functions, and this one would have
been worse than most: it would own cold-file writes while the app owned live ones, producing two
writers per vault and reintroducing the save-leader problem `COLLABORATION.md` §3.4 exists to
prevent. Its apparent benefit — agent access with the app closed — is delivered instead by launching
the app on demand.

### Keeping two surfaces with a routing rule

Rejected. It forces every agent to implement both, invents a class of transition errors when a note
goes live mid-run, and requires two anchor systems with undefined behavior at the boundary. The
split had no product justification once notes may have multiple participants.

### Compare-and-swap concurrency for all writes

Rejected. Correct for a lone file, livelocking on a live document. Retained only in spirit: the
idempotency key still makes retries safe.

### A standalone cold-file server, with live access as a separate connection

Rejected. It is the two-surface split with worse ergonomics — two servers, two connections, and an
agent that must know which to use before it knows anything about the note.

### Hosting the surface centrally now

Deferred, not rejected. Multi-user editing across the internet needs an always-on authority, and a
hosted MCP endpoint belongs beside it. It requires accounts, authentication, storage, and a
data-custody position, and it inverts the trust statement from *local code you chose to run* to
*custodian of other people's notes*. `docs/MCP-SERVER.md` §13 specifies exactly what changes so this
stays a transport swap; the decision itself needs its own ADR.

## References

- [`docs/MCP-SERVER.md`](../MCP-SERVER.md) — the contract this decision governs
- [`ADR-0001`](0001-single-product-modular-architecture.md) — module boundaries and the daemon rejection
- [`ADR-0002`](0002-local-document-session-before-crdt.md) — the deferred authority decision and its nine proof obligations
- `SWITCHBOARD-KERNEL.md` — the fence, exactly-once, thin adapters, communication ≠ control
- [`COLLABORATION.md`](../COLLABORATION.md) — participants, capabilities, save leadership, attention rules
- [Peritext: A CRDT for Rich-Text Collaboration](https://www.inkandswitch.com/peritext/)
- [ProseMirror collaborative editing](https://marijnhaverbeke.nl/blog/collaborative-editing.html)
