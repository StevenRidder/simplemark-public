# ADR-0006: One authoritative accepted-change stream

- **Status:** Accepted
- **Date:** 2026-08-04
- **Decision owners:** SimpleMark maintainers
- **Supersedes:** any wording that treats ProseMirror, a filesystem watcher, an MCP tool, a remote
  client, or a cloud provider as an independent document authority; the iCloud-only mobile policy
  in `DESIGN.md` D2

## Context

SimpleMark accepts changes from sources with materially different information:

- the local editor produces native ProseMirror steps;
- an invited agent or remote client can submit identified, structured operations;
- an external file write supplies only bytes after the fact; and
- browser and native shells expose different file capabilities.

Pretending these sources use one ingestion mechanism hides necessary parsing, rebasing, conflict,
and provenance behavior. Giving each source its own mutation path is worse: ordering, fidelity,
revert, focus preservation, and save leadership can then disagree depending on who edited.

Cloud-drive replication adds a related identity problem. Two different local paths may be replicas
of one logical Markdown projection. The application cannot infer that relationship from a provider
name or path without provider-specific code, and SimpleMark does not operate a cloud sync service.

## Decision

### Different adapters, one acceptance path

Each source has the adapter its evidence requires, but every accepted document change commits
through one application authority and one ordered transaction stream.

```text
Human editor ── ProseMirror-step adapter ─┐
MCP agent ──── participant adapter ──────┤
Remote client ─ collaboration adapter ───┼─→ document authority ─→ accepted transaction stream
External bytes ─ parse/block-diff adapter┘
```

The canonical contract is an application transaction over the structured document. It may contain
or be derived from ProseMirror steps, but ProseMirror is an editor-adapter implementation detail and
is not the application or domain authority.

No adapter may mutate editor state, collaboration state, or the file around the application
authority. Rendering, reading-position preservation, source-baseline updates, activity, summaries,
and materialization consume accepted transaction results rather than inventing source-specific
document state.

### Provenance is honest, not uniform

Direct participants carry authenticated identity and may supply a meaningful transaction name.
Filesystem import knows only that stable external bytes changed. It records a source such as
`external file update`; it does not guess which person, agent, editor, or cloud daemon caused the
write.

An external write is therefore the lossiest adapter input, not a privileged or inferior author. It
is parsed against the accepted source baseline and converted into the smallest safe block or
structural transaction. If accepted state is clean, policy may accept that transaction quietly. If
unsaved state overlaps, SimpleMark keeps both versions and requires an explicit keep/import/merge
decision. A conflicted cloud-drive copy is a new file and never silently enters the stream.

Named activity, attribution, inverse operations, revert, or generated change summaries exist only
when the accepted transaction contains evidence sufficient to support them. Missing provenance is
shown as missing rather than manufactured.

### Provider-neutral materialization groups

Plain Markdown remains the durable result. During a live multi-client session, the authority grants
one renewable save-leader lease for each **materialization group**: the set of clients intentionally
mapped to one logical synced Markdown projection.

A materialization group has a stable opaque id. It is explicitly paired or carried in
SimpleMark-owned portable metadata; it is never inferred from `~/Dropbox`, an iCloud container,
provider APIs, machine identity, or path spelling. Clients that cannot prove they share a group are
different groups. Each group may have one leader, allowing a teammate's independent folder to keep
its own portable copy without allowing two of a person's devices to fight over one cloud-synced
copy.

Cloud providers replicate the leader's bytes. They do not order live document transactions, elect
the leader, or become document authority. Provider-specific OAuth, hosted drive browsers, and sync
logic remain out of scope.

### One product, capability-honest shells

Web and native clients use the same document model, application commands, and future live authority
contract. Equal product status does not mean identical platform capabilities. Native may provide
filesystem watching and atomic replacement; capable browsers may retain a writable file handle;
other browsers may require an upload/download replacement. A shell must report the capability it
actually has and may not simulate a stronger storage guarantee.

## Consequences

### Positive

- The page can react consistently after a change is accepted, regardless of its source.
- Source-specific parsing and security stay explicit without creating a second document authority.
- Attribution remains trustworthy.
- Cloud-drive choice stays customer-owned and provider-neutral.
- Web and native share product semantics without false platform-parity claims.

### Costs

- The filesystem path needs a stable-read, parse, block-diff, conflict, and acceptance pipeline
  before transaction summaries or automatic refresh are truthful.
- Multi-device save leadership needs explicit materialization-group identity and recovery tests.
- Some external imports cannot support actor attribution or automatic revert.
- Browser and mobile capability differences remain visible where they affect safety.

## Rejected alternatives

### Call every source a ProseMirror transaction

Rejected because external bytes are not ProseMirror steps and the accepted module boundary keeps
ProseMirror in the editor adapter.

### Give the watcher a separate reload path

Rejected because it can bypass dirty-state protection, source baselines, activity, and reading
continuity.

### Infer a shared cloud root from provider and path

Rejected because paths differ across devices, provider topology is not generally observable, and it
would contradict the provider-neutral product boundary.

### Claim identical web and native file behavior

Rejected because the platforms expose different file, watching, and atomic-write capabilities.

## References

- [`PRODUCT.md`](../PRODUCT.md) — product invariant and capability language
- [`COLLABORATION.md`](../COLLABORATION.md) — later authority and save leadership
- `POC.md` — external-change acceptance contract
- [`ADR-0001`](0001-single-product-modular-architecture.md) — module boundaries
- [`ADR-0002`](0002-local-document-session-before-crdt.md) — local authority and later rebasing gate
- [`ADR-0005`](0005-rendered-document-before-agent-participation.md) — renderer-first sequencing
