# `adapters/mcp`

Thin MCP transport: tool schemas and JSON mapping onto application use cases,
and nothing else.

MCP is an optional later capability. The first product needs no provider setup,
agent inventory, session management, or MCP UI: an external agent writes the
local Markdown file and SimpleMark watches and renders it (PRODUCT.md,
ADR-0005).

It never writes the file, operates the editor, or holds a parallel document
model — the same rule that keeps 33 Switchboard MCP tools consistent
(SWITCHBOARD-KERNEL.md §4). Calls reach the document through
`DocumentAuthorityPort`, implemented for a later local participant by the
in-process `DocumentSession` and later by whatever the ADR-0002 authority spike
selects; no tool signature changes across that boundary.

The contract is `docs/MCP-SERVER.md`, governed by ADR-0004. Read §5 before
implementing any write: concurrency is `baseVersion` plus rebase, **not**
compare-and-swap, and §9.1 fixes the order every check runs in.
