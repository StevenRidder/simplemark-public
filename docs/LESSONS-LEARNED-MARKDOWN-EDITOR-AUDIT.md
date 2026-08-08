# Lessons learned from the Markdown editor and collaboration audit

- **Status:** Research record; evidence and recommendations, not an architecture decision
- **Date:** 2026-08-02
- **Products inspected:** MerMark Editor, NeverWrite, CollabMD, and Mindle
- **Community inspected:** recent `r/Markdown` requests and product discussions
- **SimpleMark baseline:** the beautiful living document for AI-generated Markdown; local,
  source-preserving, always rendered, with editing and participation subordinate to reading

## 1. Executive conclusion

The competing applications do not invalidate SimpleMark. They reinforce its product boundary.
They are building for a different job. Their user wants to **operate AI work**: select models,
manage sessions, supervise edits, inspect diffs and history, comment, collaborate, manage files, and
recover mistakes. Markdown is the substrate underneath that control system.

Their interfaces tend to expose their implementation machinery: provider selectors, chats, sessions,
workspaces, review queues, file explorers, snapshots, comments, collaboration controls, and status
surfaces. The result is often a cockpit surrounding a Markdown document. SimpleMark's opportunity is
the inverse:

> **AI writes Markdown. Humans read, judge, and occasionally correct the result.**

Make the document exceptional, keep external AI updates calm, and hide coordination machinery until
real use proves it is needed.

There is useful engineering in every inspected codebase, but almost none of it should determine
SimpleMark's product shape. The best material to borrow is underneath the interface:

1. **NeverWrite:** attribution and selective-revert semantics, external-change metadata, and durable
   atomic persistence.
2. **MerMark:** request-scoped cancellation, exactly-one terminal results, byte-safe streaming, and a
   diagram-specific proposal target.
3. **Mindle:** a small cursor-based event feed with gap detection and self-event filtering, plus a
   compact fallback anchor.
4. **CollabMD:** multi-client race tests, relative-position anchors, room lifecycle fencing,
   persistence recovery, awareness, and backpressure handling for a later authority spike.

The central lesson is:

> **Borrow mechanisms and failure cases. Do not borrow shells, product scope, or document authority.**

The strongest immediate plan is to finish the renderer-first product proof. A handful of competitor
mechanisms remain useful underneath file watching, atomic persistence, contextual corrections, and
later direct participation. The plan is not to fork any competitor, import a collaboration
framework, or surface its control model.

## 2. The product test used in this audit

An implementation is useful only if it strengthens [`PRODUCT.md`](PRODUCT.md), [`DESIGN.md`](DESIGN.md),
and the renderer-first `POC.md`:

- open an ordinary Markdown file directly;
- present one calm, always-rendered document canvas;
- make technical typography and rendering materially better than an IDE preview;
- update without disrupting the reader when an external AI changes the file;
- reveal editing only for a small intentional correction;
- preserve every untouched byte;
- make only intentionally edited blocks eligible for normalization;
- save atomically to portable Markdown;
- require no workspace, vault, provider, session, chat, or collaboration setup; and
- remain worth installing if in-app agent participation and collaboration never ship.

For later direct participation, the earlier safety filter still applies: shared `DocumentSession`
commands, visible attribution, scoped transactions, binding Stop and Redirect, communication/control
separation, independent human undo and agent revert, and no CRDT before evidence.

This filter matters. A mechanism can be competently implemented and still be wrong for SimpleMark.
For example, CollabMD has tests proving that it normalizes CRLF content to LF after an intentional
edit. Passing those tests demonstrates its chosen behavior; it does not make that behavior compatible
with SimpleMark's fidelity contract.

## 3. Method and evidence boundary

### 3.1 Repository snapshots

Each repository was downloaded and inspected at its then-current default-branch `HEAD`. A live
`git ls-remote <origin> HEAD` check confirmed that every local snapshot matched its remote head.

| Product | Repository | Inspected commit | Commit date | License at that commit |
|---|---|---|---|---|
| MerMark Editor | [Vesperino/MerMarkEditor](https://github.com/Vesperino/MerMarkEditor) | [`8970487`](https://github.com/Vesperino/MerMarkEditor/commit/8970487e375e1940a68ee20b0d99c2d398765a3e) | 2026-08-01 | MIT |
| NeverWrite | [jsgrrchg/NeverWrite](https://github.com/jsgrrchg/NeverWrite) | [`94b8d1a`](https://github.com/jsgrrchg/NeverWrite/commit/94b8d1ad7da37ee24c719a063e6e53c5014f810c) | 2026-07-29 | Apache-2.0 |
| CollabMD | [andes90/collabmd](https://github.com/andes90/collabmd) | [`2793d24`](https://github.com/andes90/collabmd/commit/2793d2410128e52dbc238bffce1b3c80a6dc70f5) | 2026-07-28 | MIT |
| Mindle | [nonatofabio/mindle](https://github.com/nonatofabio/mindle) | [`4d494d9`](https://github.com/nonatofabio/mindle/commit/4d494d9f6d9f83246a97d5f668f523256986a200) | 2026-06-19 | MIT plus Commons Clause for v2+ |

Commit hashes are recorded because these projects are active. Conclusions about individual code
paths can become stale after their heads move.

### 3.2 What was read

The audit followed the actual document-change and collaboration paths rather than inferring behavior
from screenshots or README claims. It included:

- editor-to-save conversion and file-watcher paths;
- agent process spawning, streaming, cancellation, and terminal-state handling;
- agent edit application and review models;
- atomic-write and interrupted-write recovery;
- collaboration hydration, persistence, teardown, awareness, anchors, and backpressure;
- annotation events, sidecars, external-change detection, and MCP surfaces;
- relevant unit and integration tests;
- repository licenses;
- current `r/Markdown` threads about simple editors, local files, source rewriting, and AI features.

### 3.3 Runtime and test limitations

This was a code audit with targeted verification, not a complete release qualification of four
third-party products.

- MerMark's targeted AI-apply, Mermaid-target, and watcher suites passed: **32 tests**.
- A temporary hostile-corpus test added only to the MerMark clone failed **10 of 10** byte-identical
  visual-mode round trips. The test was not added to MerMark upstream or to SimpleMark.
- CollabMD's focused room and comment-anchor suites passed: **27 tests**. The Node test process left
  handles alive, so verification used Node's `--test-force-exit` after assertions completed.
- Mindle's included harness passed **33 checks**, but those checks cover SSH targets and transport;
  they do not cover the event log, watcher, or annotation anchoring discussed here.
- NeverWrite's relevant implementation is primarily Rust. The machine used for this audit had no
  Cargo toolchain, so those Rust tests were read but not executed.
- No competitor was accepted as production-safe merely because a targeted suite passed.

## 4. What the Markdown community is actually asking for

Recent `r/Markdown` discussions repeat a remarkably consistent set of needs.

### 4.1 Direct files, not a managed universe

In [“Desperately looking for a markdown editor”](https://www.reddit.com/r/Markdown/comments/1t0qe3s/desperately_looking_for_a_markdown_editor/),
the request is for WYSIWYG, a small fixed toolbar, minimal clutter, no project-management features,
and the ability to open a file anywhere on disk without adopting a vault workflow.

In [“Best markdown editor for single, large documents?”](https://www.reddit.com/r/Markdown/comments/1t1kkah/best_markdown_editor_for_single_large_documents/),
the user explicitly distinguishes complete documents from networks of small linked notes and says
extra systems like Obsidian feel more complicated than needed.

**Lesson:** direct file opening and document-scale editing are not merely implementation details.
They are product value. SimpleMark should not require a vault, workspace, project, or agent session
before the user can write.

### 4.2 Source trust is visible to users

In [a thread asking people to try another Markdown editor](https://www.reddit.com/r/Markdown/comments/1sy25wk/i_build_a_markdown_editoranyone_willing_to_try_it/),
one commenter asks for a standalone editor that does not copy files elsewhere and does not
auto-reformat them. Another reports that some editors modify a document merely by opening it, causing
a save prompt even without a manual edit. Another says an editor should be ready for text the moment
it opens.

**Lesson:** SimpleMark's D7 fidelity gate is not obscure engineering perfectionism. It addresses a
plain user fear: “Did this editor change my file when I did nothing?” The hostile corpus is part of
the product, not only a serializer test.

### 4.3 AI is welcome when it stays subordinate to the document

In [“Simple MD — My take on a useful Markdown editing and viewing tool”](https://www.reddit.com/r/Markdown/comments/1tp8pml/simple_md_my_take_on_a_useful_markdown_editing/),
a positive comment specifically praises the low-key AI implementation and notes that AI features
often get in the way of the editor.

In [“Are there Markdown editors with some AI tools?”](https://www.reddit.com/r/Markdown/comments/1tlg1lx/are_there_markdown_editors_with_some_ai_tools/),
most suggestions are conventional editors with side-by-side agents, plugins, sidebars, or live file
reload. That demonstrates interest, but not that the interaction problem has been solved.

**Lesson:** provider breadth, chat tabs, and agent inventories are not the opportunity. The useful
experience is a participant working visibly in the selected passage or block, with direct Stop,
Redirect, and Revert controls that do not take over the canvas.

### 4.4 “Simple” is a prioritization discipline

Another thread, [“Why there is no simple markdown editor in the whole world?”](https://www.reddit.com/r/Markdown/comments/1tzfvg4/why_there_is_no_simple_markdown_editor_in_the/),
shows why the category becomes crowded and unsatisfying. People accumulate WYSIWYG, split preview,
tables, math, Mermaid, DOCX, PDF, export, sync, search, and platform requirements. Each request is
reasonable; the combined surface stops being simple.

**Lesson:** SimpleMark needs a narrow hierarchy, not a maximal checklist:

1. trusted local file;
2. beautiful document canvas;
3. technical material that renders in place;
4. optional participation in this document;
5. everything else justified by evidence.

## 5. MerMark Editor

### 5.1 What it is architecturally

MerMark is a Vue and Tauri application with a Rust backend. Its AI system supports several providers,
streams assistant output, exposes file tools, maintains per-document access maps, creates snapshots,
and records audit entries. Its visual editing save path converts Markdown to HTML and later converts
the edited HTML back to Markdown.

That architecture explains both its strength and its principal mismatch with SimpleMark:

- it has real process and provider plumbing;
- its agent model ultimately permits filesystem operations;
- its visual editor treats serialized Markdown as regenerated output rather than preserved source.

### 5.2 Borrow: request-scoped process control

[`ChildRegistry`](https://github.com/Vesperino/MerMarkEditor/blob/8970487e375e1940a68ee20b0d99c2d398765a3e/src-tauri/src/ai/process/registry.rs#L7-L74)
tracks either a child process or an HTTP streaming task by request id. Useful details include:

- natural task completion removes the registry entry;
- cancellation removes and aborts the active handle;
- application shutdown can drain and kill all registered work;
- an already-finished-task race is checked immediately after inserting its abort handle;
- HTTP task entries carry a shared terminal flag.

[`cancel_inner` and `emit_terminal`](https://github.com/Vesperino/MerMarkEditor/blob/8970487e375e1940a68ee20b0d99c2d398765a3e/src-tauri/src/ai/process/mod.rs#L262-L305)
use an atomic flag so completion and cancellation cannot both emit terminal results. Whoever flips the
flag first owns the terminal event.

This is good adapter-level behavior. SimpleMark should adapt the mechanism for its local agent
process adapter and preserve its race tests.

It is not sufficient as SimpleMark's Stop implementation. A process may die after it has already
produced a result, an HTTP abort may race with buffered output, and a late callback may still reach
application code. SimpleMark must first advance the document run generation, making the old run
ineligible under `mayApply`, and then request process cancellation. The fence protects the document;
the process kill only reclaims work.

### 5.3 Borrow: byte-safe streaming

MerMark's [`LineBuffer`](https://github.com/Vesperino/MerMarkEditor/blob/8970487e375e1940a68ee20b0d99c2d398765a3e/src-tauri/src/ai/process/mod.rs#L308-L342)
buffers raw network bytes until a complete newline-delimited SSE or NDJSON record exists. This avoids
decoding arbitrary network chunks independently and corrupting a multibyte UTF-8 code point split
across chunks.

This is a small, well-bounded utility worth adapting if SimpleMark directly hosts an HTTP-streaming
local model or agent process. Required tests should split every byte of representative multibyte text,
include CRLF frame endings, and verify the unterminated final remainder.

### 5.4 Borrow: path-hardening tests, not file tools

MerMark canonicalizes both the existing document and the target's parent before authorizing writes,
then permits only the exact active document. This correctly treats symlinks, `..`, and path aliases as
security concerns.

SimpleMark agents must not receive equivalent file tools. They submit transactions to document
authority. The useful borrowing is the adversarial test corpus for the filesystem adapter and note
identity boundary:

- symlink to the same file;
- symlink escaping the allowed root;
- nonexistent target with a canonical parent;
- `..` and `.` segments;
- macOS `/tmp` versus `/private/tmp` aliases;
- Windows separator, drive-letter, and case behavior;
- renamed note whose stable identity no longer matches an old path.

### 5.5 Borrow: the diagram target, not the AI panel

[`useAiMermaidTarget`](https://github.com/Vesperino/MerMarkEditor/blob/8970487e375e1940a68ee20b0d99c2d398765a3e/src/composables/useAiMermaidTarget.ts#L9-L99)
contains a useful local interaction model:

- a stable diagram id identifies the target;
- the starting diagram source is pinned as context;
- an assistant response can produce a candidate;
- the candidate renders before commitment;
- Apply commits it;
- Discard removes the candidate but leaves the target active for another attempt;
- Clear or Stop cancels the target.

MerMark places much of that interaction in its AI panel. SimpleMark should keep the concept but put
the minimum useful affordance next to the diagram itself. The user should experience “work on this
diagram,” not “open an AI workspace, find the diagram chip, and manage a session.”

### 5.6 Adapt cautiously: pre-edit snapshots

MerMark keeps all pinned snapshots plus a configured number of the newest unpinned snapshots. It
also validates snapshot ids against an index before constructing a filename, preventing an arbitrary
caller-supplied id from becoming path traversal.

The rotation and id-validation policies are reasonable. The implementation is not a durability model
for SimpleMark: snapshot and index writes use ordinary filesystem writes without the required file and
directory synchronization. More importantly, whole-file snapshots are a coarse substitute for
transaction history.

SimpleMark should prefer named, attributed, revertible transactions. An invisible crash-recovery
snapshot may later be useful as a last resort, but it should not become a visible snapshot-management
subsystem in the POC.

### 5.7 Reject: direct file authority and reload

MerMark's agent tools can write the active document on disk. The host then observes or reloads the
result. That is incompatible with SimpleMark because it creates a second writer outside the
`DocumentSession`, bypassing:

- structural validation;
- the granted scope;
- active-human focus exclusion;
- run-generation fencing;
- coherent transaction grouping;
- attribution;
- separate transaction revert;
- the source-preservation baseline.

Path restrictions make direct writes narrower; they do not make them transactions.

### 5.8 Reject: the visual-mode Markdown round trip

The temporary audit test mirrored MerMark's visual save path:

```ts
const converted = htmlToMarkdown(markdownToHtml(original)).trimEnd()
const roundTripped = applyLineEnding(converted, detectLineEnding(original)).trimEnd()
expect(roundTripped).toBe(original)
```

Every SimpleMark hostile fixture failed:

| Fixture | Observed rewrite or loss |
|---|---|
| `01-switchboard-borrowing-map.md` | table padding and inline formatting changed; nested lists collapsed; blank lines moved |
| `02-front-matter-comments.md` | front-matter spacing, indentation, and comments were rewritten |
| `03-embedded-html.md` | blank lines were inserted throughout opaque HTML |
| `04-mixed-list-markers.md` | list markers and numbering changed; nested structure was corrupted |
| `05-ragged-tables.md` | padding and alignment markers normalized; inline code and emphasis changed |
| `06-reference-links-footnotes.md` | definitions moved; continuation formatting and blank lines changed |
| `07-unusual-fences.md` | tilde and long-backtick fences were misinterpreted or rewritten |
| `08-mermaid-and-bare-diagram.md` | whitespace was inserted inside bare diagrams and surrounding prose |
| `09-byte-level-hostility.md` | CRLF, tabs, trailing spaces, table whitespace, and final-newline state changed |
| `10-external-edit-reopen.md` | front matter, tables, paragraph spacing, and final newline changed |

This is not merely a failure to reach byte identity. Several cases changed document structure or
meaning. It confirms SimpleMark's D7 premise: a rich editor cannot regain trusted source by
round-tripping the entire document through a conventional serializer. Clean blocks must retain and
re-emit their original source slices.

### 5.9 Reject: the temporary-file apply protocol as written

MerMark's AI apply composable writes a `.mermark-ai.tmp` candidate, but its `commitTmp` and
`discardTmp` functions both remove that temporary file. The surrounding application may commit the
new content through a different path, but this helper is not an atomic rename protocol and should not
be used as one. Its fixed suffix also invites collisions between concurrent operations.

The lesson is to specify one authoritative save operation end to end rather than infer atomicity from
the presence of a temporary file.

## 6. NeverWrite

### 6.1 What it is architecturally

NeverWrite is a substantially broader application built around a CodeMirror editor, AI sessions,
filesystem-backed agent activity, review state, workcycles, and multiple desktop subsystems. Its
state and interface breadth are not a model for SimpleMark. Its diff and persistence code, however,
contains the strongest immediately reusable semantics in the audit.

### 6.2 Borrow the attribution rule

[`map_agent_span_through_text_edits`](https://github.com/jsgrrchg/NeverWrite/blob/94b8d1ad7da37ee24c719a063e6e53c5014f810c/crates/diff/src/action_log.rs#L310-L333)
expresses a valuable ownership rule:

- if a human edit is before or after an agent-authored span, remap the span;
- if a human edit touches the span, retire that pending agent attribution;
- the resulting text is now human-owned rather than pretending to remain a pristine agent change.

This is much better than permanently coloring text by its first author. It matches the way people
actually edit: once the human changes a passage, review and undo should not later erase the human's
work under the label “reject agent change.”

SimpleMark should adopt the semantics and test cases, not the implementation. NeverWrite maps UTF-16
text offsets through flat text edits. SimpleMark should map structural ProseMirror steps and ranges
using Step Maps and transaction metadata. The authority remains the structured document.

### 6.3 Borrow selective keep and reject semantics

NeverWrite reconstructs a review baseline from still-pending agent spans and supports keeping or
rejecting exact spans without absorbing adjacent agent work. Particularly valuable tests cover two
independent agent changes on the same visual line.

The SimpleMark translation is:

- an agent result commits as one named, attributed transaction;
- the activity entry may expose the transaction as a group;
- finer review can address independent steps or mapped ranges only if the document model can do so
  without violating structural validity;
- accepting part of the agent's work retires only that part's pending review metadata;
- rejecting one part must not revert adjacent human or agent changes;
- if later human editing overlaps a pending agent range, that range becomes human-owned and is no
  longer eligible for blind rejection.

This behavior should be proven before elaborate review UI exists. A calm activity entry with Revert
is sufficient for the POC; per-hunk review can remain a later presentation choice.

### 6.4 Borrow explicit transaction authorship

NeverWrite annotates editor transactions with their author so agent-originated editor changes can be
distinguished from human input and excluded from human-change callbacks.

SimpleMark already has the stronger contract. Every document transaction should carry at least:

```ts
interface TransactionMetadata {
  actorId: string
  name: string
  transactionId: string
  run?: { id: string; generation: number }
}
```

That metadata must be authoritative and flow through `DocumentSession`, ProseMirror, Activity, save,
and revert. It should not be reconstructed later from filesystem diffs or inferred from timing.

### 6.5 Borrow the atomic persistence details

NeverWrite's
[`write_json_atomically`](https://github.com/jsgrrchg/NeverWrite/blob/94b8d1ad7da37ee24c719a063e6e53c5014f810c/apps/desktop/native-backend/src/ai_history/storage.rs#L556-L590)
and
[`read_json_atomically`](https://github.com/jsgrrchg/NeverWrite/blob/94b8d1ad7da37ee24c719a063e6e53c5014f810c/apps/desktop/native-backend/src/ai_history/storage.rs#L592-L623)
include several details commonly omitted from “write temp, rename” implementations:

- create the temporary file with create-new semantics;
- never silently overwrite an unexplained leftover temporary file;
- compare a pre-existing temporary state with the intended logical state;
- flush the temporary file with `sync_all` before replacement;
- rename or use Windows replacement with write-through;
- synchronize the containing directory;
- recover when only a valid temporary file exists;
- remove a duplicate temporary file only when destination and temporary content agree;
- refuse ambiguous, differing destination and temporary states.

SimpleMark's `FilePort` already requires same-directory temp, `fsync`, and rename. This code supplies a
useful recovery matrix and platform detail. Adapt it for Markdown bytes and any activity sidecar,
while preserving D7's rule that only a successful save establishes a new clean source baseline.

### 6.6 Borrow the external-change event envelope

NeverWrite's editable-file resource receives reload metadata including:

- `origin`: user, agent, external, system, or unknown;
- `opId`: logical operation identity;
- `revision`: monotonic event revision;
- `contentHash`: content identity.

It uses these fields to distinguish a local save acknowledgement from an external overwrite, ignore
stale revisions, coalesce same-content events, and surface dirty conflicts.

SimpleMark should borrow the envelope and race tests, not the reload decision. During a live
`DocumentSession`, an external write becomes a named external transaction or a visible conflict
choice; it must never blindly replace in-memory authority. When cold, the file remains truth and is
read normally on open.

### 6.7 Borrow Stop acceptance cases, not the store

NeverWrite has extensive state-machine coverage around stopping an assistant: clearing buffered
deltas, entering a stopping state, requesting backend cancellation, ignoring late activity, returning
to idle, and only then draining queued messages.

These are useful acceptance scenarios. Its very large central chat store is not useful architecture
for SimpleMark. The corresponding SimpleMark behavior belongs in small domain and application units:

1. bump generation synchronously;
2. mark the run stopped;
3. prevent all old-generation transactions from applying;
4. ask the adapter to cancel the process;
5. accept at most one terminal process event;
6. retain already-committed document transactions;
7. allow deliberate transaction revert separately;
8. start a replacement only under a new run generation.

### 6.8 Reject: reconstructing authority from agent filesystem activity

NeverWrite contains sophisticated machinery for observing tools and deriving diffs from files. That
is appropriate to an environment where external coding agents own file changes. It is the wrong
authority boundary for SimpleMark.

SimpleMark's agent participates through the same document commands as the editor. It should not need
to infer who changed a passage by correlating tool calls, watcher timestamps, hashes, or later diffs.
Those are useful diagnostics for external changes, not the normal editing protocol.

## 7. CollabMD

### 7.1 What it is architecturally

CollabMD is a collaborative workspace around Markdown and other document types. It uses Yjs documents,
Y.Text for Markdown content, awareness for presence, WebSockets for transport, persisted collaboration
snapshots, comments stored in shared Yjs structures, and a server-managed room lifecycle.

This is the closest inspected implementation to conventional real-time collaboration. It is also the
clearest warning against importing collaboration before SimpleMark has proven its document model.

### 7.2 Borrow later: room hydration and recovery tests

The room implementation has valuable tests and behavior for:

- only one durable read when multiple clients join concurrently;
- retry after transient hydration failure;
- hydration from a collaboration snapshot;
- rejection and replacement of invalid or schema-incompatible snapshots;
- fallback to durable file content;
- caching initial sync data until the document changes;
- serializing overlapping persists;
- retaining the latest state while final persistence is in flight;
- not destroying the room if activity resumes during finalization.

These cases should become part of the eventual multi-client authority spike regardless of whether the
chosen implementation is centralized ProseMirror steps or a structured CRDT.

### 7.3 Borrow later: generation-guarded teardown

[`RoomPersistenceController`](https://github.com/andes90/collabmd/blob/2793d2410128e52dbc238bffce1b3c80a6dc70f5/src/server/domain/collaboration/room-persistence-controller.js#L1-L80)
increments a shutdown generation when activity occurs. Finalization captures the current generation,
persists, and destroys the room only if it remains idle and the generation still matches.

This is the same broad concurrency pattern as SimpleMark's run generation: make stale asynchronous
work unable to apply after authority has advanced. The room lifecycle code has no place in the
renderer-first POC, but its race tests are valuable for a later ephemeral authority service.

### 7.4 Borrow later: layered comment anchors

CollabMD stores comment selection positions as Yjs RelativePositions and also records a quote and line
information. This combines a live position mechanism with human-readable fallback context.

SimpleMark should apply the same layered principle without taking a Yjs dependency now:

- primary live anchor: opaque authority-issued structural block/node/range token;
- display context: a short selected excerpt;
- fallback recovery context: short prefix and suffix plus structural hints;
- explicit orphaned state when the anchor cannot be resolved confidently.

An anchor must never silently jump to a different identical passage merely because a text search found
something plausible.

### 7.5 Borrow later: backpressure behavior

CollabMD checks WebSocket `bufferedAmount`, refuses to continue filling a slow client's buffer, closes
that client with an explicit retryable status, and removes disconnected clients after expected send
errors. It permits a single oversized initial sync frame from an empty buffer so a legitimate first
sync is not rejected by the steady-state threshold.

This is good future transport behavior. It has no reason to exist in the renderer-first POC.

### 7.6 Reject now: Yjs and raw Markdown as shared authority

CollabMD binds collaborative editing to a Y.Text containing Markdown source. That is incompatible with
SimpleMark's source-preserving document model and later authority plan, and carries the Peritext problem already recorded in
[`COLLABORATION.md`](COLLABORATION.md): merging Markdown delimiter characters can preserve valid text
while losing both authors' formatting intent.

If Yjs is evaluated later, it must own a structured document, and the spike must prove:

- schema-valid concurrent formatting;
- relative positions across structural edits;
- per-participant undo and grouped agent transaction revert;
- persistence and recovery;
- save leadership;
- source-preserving Markdown projection;
- contention, reconnect, retry, and authority restart;
- behavior when the collaboration snapshot and durable file disagree.

### 7.7 Reject: global newline normalization

CollabMD's `normalizeEditableText` replaces CRLF and bare CR with LF. Its test suite explicitly expects
an untouched CRLF file not to be rewritten merely by opening, but expects the whole file to save as LF
after an intentional text edit.

That is a coherent policy for CollabMD and a D7 violation for SimpleMark. Editing one block must not
change newline bytes in untouched blocks.

### 7.8 Reject: the workspace shell

The surrounding server, vault, explorer, tunnel, authentication, Git integration, Excalidraw rooms,
panels, and workspace routes demonstrate how quickly collaboration infrastructure becomes the product.
None belongs in the SimpleMark POC. The future collaboration capability must attach to one note and
disappear when that note has no active session.

## 8. Mindle

### 8.1 What it is architecturally

Mindle is a native macOS reader and annotation application. It watches files and annotation sidecars,
supports passage-anchored threads and reactions, exposes MCP operations through an internal socket,
and lets agents participate mainly through annotations while external tools continue to modify files.

Its annotation-heavy interface does not satisfy SimpleMark's document-first reading goal. Its basic
assumption that an external agent changes the file is now aligned with the first SimpleMark workflow,
and its annotation event loop remains one of the cleanest small mechanisms found.

### 8.2 Borrow the event-feed behavior

[`AnnotationEventLog`](https://github.com/nonatofabio/mindle/blob/4d494d9f6d9f83246a97d5f668f523256986a200/Sources/mindle/AnnotationEventLog.swift#L31-L198)
provides:

- monotonically increasing event ids;
- a bounded ring buffer of 256 events;
- snapshots after a caller-supplied cursor;
- filtering of events produced by the same MCP client;
- immediate return when unseen events exist;
- long polling with timeout when there is nothing new;
- a gap flag if the caller fell behind the retained window;
- a gap flag if the caller presents a cursor newer than the log after application restart;
- exactly-once continuation resumption across event arrival and timeout;
- a pinned cursor for “from now” waits, preventing the threshold from moving on every append.

This is an excellent pattern for SimpleMark's lightweight `Leave note` and attention feed. It gives an
agent an efficient way to notice messages without treating a message as execution authority.

The SimpleMark version should keep event delivery and run controls separate:

- a `note_left` event communicates;
- a `redirected` event reports that the Redirect command already advanced authority;
- a `stopped` event reports that the Stop command already fenced the run;
- receiving text containing the word “stop” does nothing to execution state.

Required tests include wraparound, restart, self-filtering, timeout-versus-append races, multiple
waiters, duplicate polling, cancellation, and rebaseline after a gap.

### 8.3 Borrow the compact fallback anchor

Mindle records selected text plus roughly 32 characters of prefix and suffix. This is useful as a
portable fallback and as context for displaying or manually repairing an orphaned annotation.

It should not be SimpleMark's primary live anchor because repeated text is ambiguous and a text search
cannot reliably follow concurrent structural changes. Use it beneath a structural authority-issued
anchor, not instead of one.

### 8.4 Borrow external-drift conflict cases

When a block edit opens, Mindle captures a content hash. Before saving, it rechecks the current file
and warns if another writer changed it. Its `lastSyncedText` baseline also supports reviewing external
changes and accepting or rejecting them.

The useful cases are:

- external write before a human edit opens;
- external write while the human is editing;
- human save acknowledgement mistaken for external change;
- same-content external rewrite;
- file rename or replacement;
- external insertion shifting all later anchors;
- external change while another tab is active;
- accept, reject, and merge choices.

SimpleMark should resolve these through its cold/live ownership rule. During a live session, import or
merge the external write as a named transaction. Do not overwrite the session from a watcher callback.

### 8.5 Reject: the file-watcher stability heuristic

Mindle debounces FSEvents and waits until file size remains stable for about 200 ms. The implementation
then fires only if the stable size is greater than zero.

This creates important failure cases:

- a same-size rewrite does not prove that content is unchanged;
- size stability does not prove the writer is finished;
- an empty file never satisfies `size > 0`, so the check can keep rescheduling;
- a rapid replace can reuse the prior size;
- file size says nothing about operation identity or whether the event acknowledges SimpleMark's own
  save.

SimpleMark may use filesystem notifications as a trigger to inspect state, but the decision must use
content identity, operation metadata where available, and the `DocumentSession` ownership rule.

### 8.6 Reject: annotations plus external agent writes as “collaboration”

Mindle's MCP surface is primarily annotation-oriented while an agent may use its own tools to edit the
file. That is useful turn-taking around a document but not simultaneous human-agent editing under one
authority. It cannot provide reliable scope, focus exclusion, run-generation fencing, structural
rebase, or coherent attributed transactions for those external writes.

SimpleMark should borrow the ambient note channel, not the filesystem authority model.

### 8.7 License constraint

Mindle v2 and later is MIT with the Commons Clause. The license says the software may not be “Sold,”
where sale includes products or services whose value derives substantially from the software, without
a separate commercial agreement.

Therefore:

- do not copy Mindle v2+ implementation code into a potentially commercial SimpleMark product;
- independently specify and implement the event-feed behavior;
- use public concepts and independently authored tests, not copied source or distinctive expression;
- seek a commercial agreement before any direct reuse.

## 9. Cross-cutting lessons

### 9.1 Cancellation has four separate responsibilities

The competitors often cover one or two of these responsibilities. SimpleMark needs all four and must
not collapse them:

| Responsibility | Owner | What it proves |
|---|---|---|
| User intent | application command | the user requested Stop or Redirect |
| Document fence | domain run generation and `mayApply` | the old run can no longer change the document |
| Work cancellation | agent process adapter | unnecessary process or HTTP work was asked to stop |
| Terminal delivery | adapter/application protocol | observers receive at most one final run result |

The binding order is:

```text
Stop or Redirect
  -> advance document generation
  -> record the authoritative run transition
  -> ask the adapter to cancel work
  -> ignore every old-generation result, even if cancellation failed
```

MerMark contributes good work-cancellation and terminal-delivery primitives. SimpleMark's existing
architecture contributes the document fence. Neither replaces the other.

### 9.2 Attribution is metadata at commit time, not forensic reconstruction

NeverWrite demonstrates good review behavior despite having to reconstruct changes from flat text and
filesystem activity. SimpleMark can make the same behavior simpler and more reliable because every
participant already submits a typed transaction.

Record actor, name, run, scope, base version, and steps when the authority commits. Then map that
metadata through later document changes. Do not infer authorship later from timing, colors, tool-call
logs, or watcher events.

### 9.3 Human ownership must override stale agent ownership

If a human edits an agent-authored range, the system must not later reject that range and delete the
human's intervention. The review model should retire or split the pending agent attribution where the
human touched it.

This should apply equally to prose, list items, table cells, code, and diagram source. Structural
mapping makes the rule harder to implement than flat offsets but also prevents invalid partial edits.

### 9.4 External file change is an input, not an authority switch

Watchers are notification mechanisms. They do not decide which state is true.

| Document state | Authority | External change behavior |
|---|---|---|
| Cold | file | read normally on open or refresh |
| Open renderer-first POC | `DocumentSession` | import through the application boundary or surface a local conflict choice |
| Future live room | selected document authority | submit external state through an explicit reconciliation protocol |

Blind reload is forbidden while a live authority exists.

### 9.5 Anchors need a strong primary form and a humane fallback

CollabMD and Mindle together suggest the right layered design:

1. opaque structural anchor issued by document authority;
2. mapped live position or range;
3. selected quote for display;
4. short prefix and suffix for recovery;
5. explicit orphaned state when confidence is insufficient.

The fallback makes failures understandable. It must not conceal them.

### 9.6 Durability includes ambiguous recovery states

“Write a temp file and rename it” is incomplete. The real questions are:

- Is the temp file unique to the operation?
- Was the temp file flushed?
- Was the directory flushed?
- What happens if destination exists and temp remains?
- What if their bytes differ?
- What if rename succeeded but acknowledgement was lost?
- Does recovery accidentally establish a clean D7 baseline for bytes not proven durable?

NeverWrite provides a useful recovery matrix. SimpleMark should specify these states at the `FilePort`
boundary and test injected failures at every step.

### 9.7 Collaboration infrastructure is not product value by itself

CollabMD proves that awareness, rooms, snapshots, tunnels, auth, explorers, and recovery can consume
the center of a product. NeverWrite proves that agent sessions, queues, workcycles, review stores, and
provider surfaces can do the same. MerMark proves it at a smaller scale with its AI panel, access
maps, snapshots, and audit controls.

In the first product, SimpleMark should expose only what changes the user's immediate understanding
of the document: what the content says, what just changed, and where a small correction can be made.
Participant identity, scope, run state, Stop, Redirect, Leave note, Revert, and Activity belong only
to a later direct-participation mode, and even there must stay contextual or diagnostic-only.

## 10. Recommended borrowing plan

### 10.1 Phase 1: beautiful living document

#### A. External-change envelope and reading continuity

- **Source lesson:** NeverWrite's metadata plus Mindle's conflict cases, with Mindle's watcher
  heuristic rejected.
- **SimpleMark home:** filesystem adapter events plus `DocumentSession` reconciliation commands.
- **Implement:** origin, operation id, revision, content hash, complete-write detection,
  self-acknowledgement suppression, smallest-safe update, viewport anchor, and local conflict state.
- **Prove:** partial write, local acknowledgement, same-content event, external insertion, visible and
  offscreen changes, simultaneous human correction, rename, replacement, delete, and re-creation.

#### B. Atomic `FilePort`

- **Source lesson:** NeverWrite's synchronized replacement and recovery.
- **SimpleMark home:** `src/adapters/filesystem/` implementing the application port.
- **Implement:** unique same-directory temp, create-new, byte write, file sync, atomic replace,
  directory sync, operation identity, and explicit recovery of leftover temp states.
- **Prove:** crash before write, partial write, crash after file sync, crash after rename, destination
  and temp equal, destination and temp different, save acknowledgement lost, and Windows replacement.

#### C. Rendered correction targets

- **Source lesson:** MerMark's stable diagram target without its AI panel or file tools.
- **SimpleMark home:** rendered NodeViews and editor adapter calling application commands.
- **Implement:** click-to-reveal source for the exact block, starting-source capture, apply/cancel,
  focus stability, and a return to rendered state.
- **Prove:** another diagram cannot receive the correction, a deleted target fails visibly, source
  never leaks into adjacent blocks, and the edit changes no unrelated bytes.

### 10.2 After the renderer-first one-day gate: optional agent participation

#### A. Transaction attribution and review semantics

- **Source lesson:** NeverWrite.
- **SimpleMark home:** `src/domain/transactions/` plus application integration.
- **Implement:** transaction identity, actor, readable name, run metadata, mapped attributed ranges,
  human-touch ownership transfer, grouped revert.
- **Prove:** human edits before, after, adjacent to, and overlapping agent work; two independent agent
  changes on one line; human undo does not undo agent work; agent revert does not erase later human
  work.

#### B. Run generation and process controller

- **Source lesson:** SimpleMark/Switchboard fencing plus MerMark's registry and terminal flag.
- **SimpleMark home:** `src/domain/fences/`, application run coordinator, and a local-agent adapter.
- **Implement:** generation advance, fail-closed `mayApply`, request registry, cancellation, exactly-one
  terminal event, natural-completion cleanup, process-tree termination where needed.
- **Prove:** completion/cancel race, Stop after result production but before application, Redirect while
  streaming, late callback after cancellation failure, repeated Stop, process exit, and application
  shutdown.

#### C. Lightweight attention/event feed

- **Source lesson:** Mindle's event cursor.
- **SimpleMark home:** application event port plus thin MCP transport.
- **Implement:** bounded ids, cursor snapshots, long poll, gap/rebaseline, self-filter, timeout, explicit
  event kinds.
- **Prove:** no self-wake, exactly-once waiter completion, ring-buffer overrun, restart, two simultaneous
  waiters, duplicate poll, and communication that never changes run authority.

#### D. Local Mermaid proposal target

- **Source lesson:** MerMark's stable diagram target.
- **SimpleMark home:** Mermaid NodeView/editor adapter calling application commands.
- **Implement:** explicit diagram scope, starting-source capture, inline candidate preview, Apply,
  Discard, Stop, and new-run iteration.
- **Prove:** another diagram cannot receive the candidate, deleted target fails visibly, human focus
  blocks application, stopped generation cannot apply, and Apply produces one attributed transaction.

### 10.3 After direct participation proves a multi-client need

Only if the renderer product is delightful, direct participation adds value, and real use justifies
multiplayer work:

1. use CollabMD's hydration, snapshot-recovery, lifecycle, anchor, and backpressure cases as a test
   catalog;
2. spike centralized ProseMirror step authority first;
3. pin exact library versions;
4. compare a structured Yjs model only if evidence demonstrates a genuinely masterless requirement;
5. reject any candidate that makes untouched-source preservation impossible;
6. keep the collaboration shell contextual to the current note.

## 11. Explicit non-goals derived from the audit

The audit supplies additional evidence not to build the following into the POC:

- an AI side panel as the primary interaction;
- provider and model management in the document surface;
- workspaces, projects, vault onboarding, or folder scanning;
- SimpleMark-managed agent file-write tools in the first POC;
- blind whole-document reload after an agent edit;
- a global review tab;
- an agent session browser;
- visible snapshot administration;
- an access-map editor;
- persisted chat as a second durable artifact competing with the note;
- raw Markdown text as CRDT authority;
- Yjs before a demonstrated multi-client need;
- a collaboration server, tunnel, relay, login, or permission system in the renderer-first phase;
- global reserialization of a document after a local edit;
- time-only or size-only file watcher heuristics;
- reconstruction of normal agent changes from filesystem diffs;
- one giant UI store owning run, document, queue, review, and persistence state.

These are not statements that the features are universally bad. They are statements that each one
moves SimpleMark toward the cockpit category the product is intended to avoid.

## 12. License and provenance guidance

| Source | Reuse posture |
|---|---|
| MerMark, MIT | Small code reuse is legally possible with required copyright and license notice. Prefer adaptation because its Vue/Tauri authority assumptions differ. |
| NeverWrite, Apache-2.0 | Reuse is possible with Apache notice, attribution, and modification obligations. Its patent grant is useful. Prefer adapting bounded storage/process-independent code and independently implementing document semantics. |
| CollabMD, MIT | Reuse is possible with notice. Treat primarily as a future test oracle because its Yjs/Y.Text storage model is incompatible with the renderer-first product and current authority plan. |
| Mindle v2+, Commons Clause | Do not copy into a commercializable SimpleMark without a separate agreement. Use independently implemented concepts and tests only. |

Every direct code borrowing decision should record:

- upstream repository and exact commit;
- source file and lines;
- license at that commit;
- whether code was copied, translated, or only used to derive tests;
- modifications made;
- retained notices required by the license.

This document records research provenance; it does not itself authorize copying.

## 13. Final product lesson

The competitors are not “already-built SimpleMark.” They solve adjacent problems with different
centers of gravity:

- MerMark centers an editor plus a provider-rich AI panel and direct file tools.
- NeverWrite centers an AI work environment and review system.
- CollabMD centers a collaborative workspace and room infrastructure.
- Mindle centers reading, annotations, and file-watcher-mediated agent cooperation.

SimpleMark centers one trusted technical document. The external agent can already write the file;
SimpleMark's job is to make the result exceptional to read, current while it changes, and safe to
correct.

That distinction survives the code audit. In fact, the code makes it clearer. The mechanisms worth
borrowing are mostly invisible and can make SimpleMark calmer:

- stronger cancellation means Stop can be one small reliable control;
- stronger attribution means Activity can be concise and trustworthy;
- stronger atomic writes mean the user never needs a recovery dashboard;
- a small event feed means Leave note can work without a chat application;
- stronger anchors mean comments can collapse when resolved;
- later room race tests can prevent a future collaboration layer from leaking into the notebook.

The durable product rule is therefore:

> **Your agent writes the Markdown. SimpleMark turns it into a document. Build the beautiful living
> artifact first; keep every control system optional and invisible.**

## 14. Source index

### SimpleMark authority and context

- [`PRODUCT.md`](PRODUCT.md)
- [`DESIGN.md`](DESIGN.md)
- `POC.md`
- [`ADR-0005`](decisions/0005-rendered-document-before-agent-participation.md)
- [`COLLABORATION.md`](COLLABORATION.md)
- [`MCP-SERVER.md`](MCP-SERVER.md)
- `SWITCHBOARD-KERNEL.md`
- [`ADR-0001`](decisions/0001-single-product-modular-architecture.md)
- [`ADR-0002`](decisions/0002-local-document-session-before-crdt.md)

### MerMark

- [Process registry](https://github.com/Vesperino/MerMarkEditor/blob/8970487e375e1940a68ee20b0d99c2d398765a3e/src-tauri/src/ai/process/registry.rs)
- [Cancellation, terminal emission, and line buffering](https://github.com/Vesperino/MerMarkEditor/blob/8970487e375e1940a68ee20b0d99c2d398765a3e/src-tauri/src/ai/process/mod.rs)
- [File-tool path authorization](https://github.com/Vesperino/MerMarkEditor/blob/8970487e375e1940a68ee20b0d99c2d398765a3e/src-tauri/src/ai/process/file_tools.rs)
- [Snapshot policy](https://github.com/Vesperino/MerMarkEditor/blob/8970487e375e1940a68ee20b0d99c2d398765a3e/src-tauri/src/ai/snapshots.rs)
- [Mermaid AI target](https://github.com/Vesperino/MerMarkEditor/blob/8970487e375e1940a68ee20b0d99c2d398765a3e/src/composables/useAiMermaidTarget.ts)
- [AI apply path](https://github.com/Vesperino/MerMarkEditor/blob/8970487e375e1940a68ee20b0d99c2d398765a3e/src/composables/useAiApply.ts)
- [Visual Markdown conversion](https://github.com/Vesperino/MerMarkEditor/blob/8970487e375e1940a68ee20b0d99c2d398765a3e/src/utils/markdown-converter.ts)

### NeverWrite

- [Action log and attribution mapping](https://github.com/jsgrrchg/NeverWrite/blob/94b8d1ad7da37ee24c719a063e6e53c5014f810c/crates/diff/src/action_log.rs)
- [Atomic AI-history persistence](https://github.com/jsgrrchg/NeverWrite/blob/94b8d1ad7da37ee24c719a063e6e53c5014f810c/apps/desktop/native-backend/src/ai_history/storage.rs)
- [Editable-file external-change handling](https://github.com/jsgrrchg/NeverWrite/blob/94b8d1ad7da37ee24c719a063e6e53c5014f810c/apps/desktop/src/features/editor/useEditableFileResource.ts)

### CollabMD

- [Collaboration room](https://github.com/andes90/collabmd/blob/2793d2410128e52dbc238bffce1b3c80a6dc70f5/src/server/domain/collaboration/collaboration-room.js)
- [Room persistence lifecycle](https://github.com/andes90/collabmd/blob/2793d2410128e52dbc238bffce1b3c80a6dc70f5/src/server/domain/collaboration/room-persistence-controller.js)
- [Comment-thread store](https://github.com/andes90/collabmd/blob/2793d2410128e52dbc238bffce1b3c80a6dc70f5/src/client/infrastructure/comment-thread-store.js)
- [Collaboration room tests](https://github.com/andes90/collabmd/blob/2793d2410128e52dbc238bffce1b3c80a6dc70f5/tests/node/collaboration-room.test.js)

### Mindle

- [Annotation event log](https://github.com/nonatofabio/mindle/blob/4d494d9f6d9f83246a97d5f668f523256986a200/Sources/mindle/AnnotationEventLog.swift)
- [Document and annotation model](https://github.com/nonatofabio/mindle/blob/4d494d9f6d9f83246a97d5f668f523256986a200/Sources/mindle/DocumentStore.swift)
- [File watcher](https://github.com/nonatofabio/mindle/blob/4d494d9f6d9f83246a97d5f668f523256986a200/Sources/mindle/FileWatcher.swift)
- [MCP server](https://github.com/nonatofabio/mindle/blob/4d494d9f6d9f83246a97d5f668f523256986a200/Sources/mindle/MCPServer.swift)
- [License](https://github.com/nonatofabio/mindle/blob/4d494d9f6d9f83246a97d5f668f523256986a200/LICENSE)

### Community discussions

- [Desperately looking for a markdown editor](https://www.reddit.com/r/Markdown/comments/1t0qe3s/desperately_looking_for_a_markdown_editor/)
- [Best markdown editor for single, large documents?](https://www.reddit.com/r/Markdown/comments/1t1kkah/best_markdown_editor_for_single_large_documents/)
- [Are there Markdown editors with some AI tools?](https://www.reddit.com/r/Markdown/comments/1tlg1lx/are_there_markdown_editors_with_some_ai_tools/)
- [Simple MD — My take on a useful Markdown editing and viewing tool](https://www.reddit.com/r/Markdown/comments/1tp8pml/simple_md_my_take_on_a_useful_markdown_editing/)
- [Why there is no simple markdown editor in the whole world?](https://www.reddit.com/r/Markdown/comments/1tzfvg4/why_there_is_no_simple_markdown_editor_in_the/)
- [I build a markdown editor, anyone willing to try it](https://www.reddit.com/r/Markdown/comments/1sy25wk/i_build_a_markdown_editoranyone_willing_to_try_it/)
