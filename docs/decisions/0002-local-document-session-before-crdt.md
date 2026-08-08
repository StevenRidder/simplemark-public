# ADR-0002: Local DocumentSession before distributed collaboration

- **Status:** Accepted
- **Date:** 2026-08-01
- **Decision owners:** SimpleMark maintainers
- **Supersedes:** Yjs as a dependency of the Phase 1 one-human/one-agent POC

> **Sequencing amendment:** [`ADR-0005`](0005-rendered-document-before-agent-participation.md)
> makes the beautiful living document the first POC and moves direct agent participation later.
> This ADR still governs `DocumentSession` authority and any later multi-client decision.

## Context

SimpleMark's eventual room may contain multiple humans, agents, and intermittently connected
devices. That is a distributed editing problem. The first executable proof is not: it has one
macOS process, one human editor, one local agent, and one Markdown file.

Putting Markdown source characters directly in a text CRDT is rejected. Concurrent edits to
formatting delimiters can preserve valid text while losing both authors' formatting intent, as
demonstrated by Ink & Switch's Peritext research. A collaborative rich-text system therefore needs
a structured document representation, stable relative positions, explicit undo ownership, schema
convergence tests, persistence, and compaction. Those are real costs, but they do not answer whether
scoped, visible, interruptible agent editing feels useful. `ADR-0005` subsequently moved even that
question behind the renderer-first product proof.

## Decision

Phase 1 uses one in-process `DocumentSession` as the coordination authority. The ProseMirror editor
and local MCP adapter call the same application use cases and submit the same typed transactions.
No Yjs document, provider, update log, relay, or CRDT-specific position type is required.

```text
Human editor ─┐
              ├─ DocumentSession ─→ structured document ─→ atomic Markdown save
Local agent ──┘
```

The session owns:

- the current structured ProseMirror-compatible document;
- a monotonically increasing document revision;
- actor-attributed, named transactions;
- scoped agent invocation and focus awareness;
- run generations and the `mayApply` fence for Stop and Redirect;
- human undo and deliberate agent-transaction revert; and
- serialization through the source-preservation model.

The MCP adapter never edits the editor, future CRDT state, or files. It invokes `DocumentSession`
commands. The editor adapter translates ProseMirror transactions to the same application contract.

### Source-preservation metadata

`originalSource` is not collaborative text and is not an independently editable last-writer-wins
register. Each block begins a save epoch with an immutable source baseline:

```ts
interface SourceBaseline {
  sourceRevision: string
  originalSource: string
  dirty: boolean
}
```

`dirty` is monotonic within that epoch. Once a transaction touches a block, serialization ignores
`originalSource` and emits the current structured block. Only a successful save/checkpoint creates
a new baseline. This prevents metadata merging from resurrecting stale Markdown.

### Agent edit granularity

For the POC, an agent receives one explicit selection or whole-block scope and returns one coherent,
named transaction. It never edits beneath an active human cursor. Nothing selected and no explicit
invocation means nothing happens. Arbitrary character-offset patches and ambient document-wide
rewrites are out of scope.

## Later multi-client authority decision

The first candidate is a single authority that orders and rebases native ProseMirror steps, using
`prosemirror-collab-commit` or Pitter Patter Collab as the reference implementation. This extends
the POC's `DocumentSession` model: clients submit inspectable steps with their last-seen version;
the authority validates schema, permission, agent scope, and generation before committing them.

Yjs remains a comparison candidate only if the product demonstrates a requirement for truly
masterless peer-to-peer operation. Offline or intermittent editing alone is not sufficient evidence:
a step authority can support optimistic local edits and reconnect/rebase while remaining easier to
inspect and debug.

The version-pinned spike must prove:

1. two ProseMirror clients converge after concurrent structural edits;
2. the schema remains valid through concurrent delete, split, join, list, quote, and table edits;
3. selections, comments, decorations, and NodeViews survive remote changes;
4. human undo, remote edits, and agent transaction revert remain independent;
5. temporary disconnection, reconnect, contention, retry, and authority restart are explicit;
6. the authority rejects invalid schema versions, permissions, scopes, and fenced generations;
7. history growth has measured bounds and an explicit checkpoint/compaction policy;
8. source baselines and save leadership cannot resurrect stale bytes; and
9. the exact supported library versions pass the tests.

Pitter Patter is promising but newly announced. It is spike material, not an assumed production
dependency. In particular, its documented contention/retry path must be tested rather than trusted.

Older integration reports are evidence for what to test, not permanent statements about current
library behavior.

## Consequences

### Positive

- The POC tests the product interaction without paying distributed-systems cost first.
- Human and agent edits still happen live through one authoritative transaction stream.
- Stop and Redirect are binding because the application fence rejects late generations.
- The editor and MCP contracts survive a later collaboration-adapter change.
- The multi-client algorithm becomes an evidence-based decision rather than an assumed CRDT.

### Costs

- Phase 1 does not support a second human, process, or device editing concurrently.
- Cursor positions and anchors are session-local until the authority spike selects a durable mapping.
- A later collaboration adapter will require dedicated convergence, persistence, and growth work.

## Rejected alternatives

### Yjs in the first POC

Rejected because one local process already supplies ordering and authority. It would make cursor
mapping, undo, persistence, schema convergence, and compaction prerequisites for testing live agent
editing.

### Markdown text in a CRDT

Rejected because syntax characters are not the user's formatting intent. Valid merged Markdown can
still be the wrong rich-text result.

### Separate collaboration authority in the first POC

Rejected because it adds a process and lifecycle boundary without another client. A step-based
authority becomes the preferred first candidate as soon as a second client exists.

## References

- [Peritext: A CRDT for Rich-Text Collaboration](https://www.inkandswitch.com/peritext/)
- [ProseMirror collaborative editing](https://marijnhaverbeke.nl/blog/collaborative-editing.html)
- [Pitter Patter announcement](https://discuss.prosemirror.net/t/a-new-rich-text-framework-built-with-prosemirror/9036)
- [Pitter Patter Collab](https://pitter-patter.dev/docs/collab/overview/)
- [`prosemirror-collab-commit`](https://github.com/handlewithcarecollective/prosemirror-collab-commit)
- [Yjs relative positions](https://github.com/yjs/yjs)
- [Yjs UndoManager](https://docs.yjs.dev/api/undo-manager)
- [Yjs IndexedDB persistence](https://docs.yjs.dev/ecosystem/database-provider/y-indexeddb)
