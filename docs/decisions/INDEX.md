# Architecture decision register

Accepted decisions are binding on implementation plans and code. If a plan conflicts with an
accepted ADR, update the plan before executing it; do not silently choose the easier source.

| ADR | Status | Decision |
|---|---|---|
| [0001](0001-single-product-modular-architecture.md) | Accepted | One product repo and release, with enforced internal modules; no monorepo and no monolithic application core |
| [0002](0002-local-document-session-before-crdt.md) | Accepted | An open document uses `DocumentSession`; later direct participants and clients do not imply a CRDT |
| [0003](0003-rendered-block-frame.md) | Accepted | Rendered blocks keep a shared frame; their controls fade in on hover or focus |
| [0004](0004-mcp-as-participant-client.md) | Accepted | MCP is a participant client of the document authority: one tool surface, rebase rather than compare-and-swap, hosted in the app process |
| [0005](0005-rendered-document-before-agent-participation.md) | Accepted | Prove the beautiful living local document before in-app agent participation or collaboration |
| [0006](0006-one-authoritative-change-stream.md) | Accepted | Editor steps, participant operations, remote steps and external bytes converge on one authoritative accepted-change stream; supersedes the iCloud-only mobile policy in `DESIGN.md` D2 |
| [0007](0007-annotation-before-participation.md) | Accepted | Annotation decomposes into A→B→C0→C→D; its human half ships without an agent, threads live in application data, and note anchors are text while participant anchors stay authority-issued |
| [0008](0008-pasted-images-become-local-files.md) | Accepted | A rich-HTML paste downloads its remote images into `assets/` beside the note through one bounded Rust command; the paste is the consent, the content policy stays closed, and a failed download keeps the remote URL |
