# ADR-0001: Single-product repo with enforced modular architecture

- **Status:** Accepted
- **Date:** 2026-08-01
- **Decision owners:** SimpleMark maintainers
- **Supersedes:** the pnpm-workspace and `packages/core` / `packages/editor` layout in the Phase 0–1 implementation plan

> **Sequencing amendment:** [`ADR-0005`](0005-rendered-document-before-agent-participation.md)
> removes the local agent from the first product proof. The single-repo boundary and dependency
> direction accepted here remain unchanged.

## Context

SimpleMark is one small product with web and native shells. At the time of this decision, its first
proof was deliberately narrow: one Markdown file, one product shell, Mermaid, and one local agent.
`ADR-0005` later removed the local agent from that first proof without changing this repository
decision. Splitting that product into a
monorepo of internal packages would add manifests, build graphs, version boundaries, and dependency
ceremony before any component has an independent consumer or release.

The opposite failure is equally damaging. Putting file I/O, Markdown fidelity, editor state,
rendering, collaboration, MCP, agent control, and UI actions into one application module would make the code
hard to reason about and eventually unsafe to change. In particular, Stop and Redirect fencing,
source preservation, and atomic writes must not acquire different implementations at different call
sites.

We want one cohesive product without either monorepo sprawl or monolithic code.

## Decision

SimpleMark uses **one canonical repository, one JavaScript package, and one application release**.
The code is organized as modules with explicit dependency direction and narrow public contracts.

There is no `pnpm-workspace.yaml`, no top-level `packages/` directory, and no package manifest per
internal module. The Tauri Rust crate under `src-tauri/` is a platform adapter compiled into the same
application; it is not a separately versioned product.

The initial layout is:

```text
simplemark/
├── src/
│   ├── domain/          # pure document, source, transaction, and fence rules
│   ├── application/     # use cases and ports; owns DocumentSession
│   ├── adapters/
│   │   ├── editor/      # Milkdown/ProseMirror integration
│   │   ├── filesystem/  # local read, atomic write, hashes, external changes
│   │   ├── renderers/   # Mermaid first
│   │   ├── collaboration/ # deferred multi-client authority adapter
│   │   └── mcp/         # thin local MCP transport
│   └── app/
│       ├── ui/          # reusable editor chrome and wireframe-derived components
│       ├── styles/      # the wireframe's tokens, typography, and states
│       ├── bootstrap.ts # composition shared by development and native entrypoints
│       ├── browser.ts   # development entrypoint and browser file-port wiring
│       └── tauri.ts     # production entrypoint and native file-port wiring
├── src-tauri/           # operating-system bridge only
├── spike/               # disposable, decision-producing experiments
├── tests/               # cross-module and acceptance tests
└── docs/
```

Folder names may change when the fidelity spike selects Milkdown or raw ProseMirror. The boundaries
and dependency direction do not.

### Dependency direction

```text
app ───────────────┐
                   v
adapters ──> application ──> domain
                   ^
                   │
        UI and MCP call the same use cases
```

- `domain` imports no SimpleMark module and no framework, DOM, Tauri, CRDT, MCP, or filesystem API.
- `application` imports only `domain`. It defines ports and owns workflows such as open, save,
  invoke agent, apply transaction, leave note, redirect, stop, and revert.
- `adapters` implement application ports. Adapters do not call one another's private code.
- `app` is the only composition root. It wires concrete adapters to application services and owns
  presentation state, not document rules.
- Tauri commands and MCP tools are thin transports into the same application API. Neither may edit
  editor state, future CRDT state, or files directly.

### Web and native shells

The browser is a first-class shell for the same product, not a second implementation or a
throwaway prototype. It may supply browser-specific implementations of application ports, such as
the File System Access API, browser persistence, or an in-memory fixture port. All document
parsing, source preservation, transactions, editor integration, Mermaid rendering, toolbar
commands, and UI components remain the same modules used by the Tauri build.

The web and native shells are equal participants when a document is live: both call the same
`DocumentAuthorityPort`; neither owns a parallel document model. A hosted authority may serve web,
native, and MCP clients, while exactly one authority-designated save leader materializes the
portable Markdown projection. The native shell replaces only platform wiring where native
capabilities are useful: open/save dialogs, atomic writes, external-change watching, and window
integration.

`docs/wireframe.html` is the visual specification and extraction source. Its tokens, typography,
layout, toolbar, activity, and conversation states move into reusable `app/ui` and `app/styles`
modules. Its inline demo state and scripted state-switching do not become product logic.

A feature is not accepted if it works only in `browser.ts` or requires a separate editor model in
the native shell.

### Module contracts

Each module exposes a small public entry point. Imports of another module's internal paths are
forbidden. Shared behavior moves downward only when it represents a real stable rule; a generic
`utils/` dumping ground is not a module.

The following rules have one owner:

| Rule | Owner |
|---|---|
| Untouched-source preservation and dirty-block serialization | `domain` |
| Run generation and `mayApply` fencing | `domain` |
| Document open/save and named transaction workflows | `application` |
| Filesystem reads, hashes, and atomic writes | `adapters/filesystem` |
| ProseMirror/Milkdown translation | `adapters/editor` |
| Browser and native file capabilities | separate implementations of the application file port |
| Future CRDT origins, presence, and relative positions | `adapters/collaboration` |
| MCP request/response mapping | `adapters/mcp` |
| Window chrome and contextual controls | `app` |

### Enforcement

Before product implementation grows beyond the fidelity spike, CI must enforce:

1. no circular imports;
2. no framework or adapter imports from `domain` or `application`;
3. no cross-adapter private imports;
4. Tauri and MCP handlers delegate to application use cases;
5. unit tests run at the owning boundary, with cross-module behavior covered by acceptance tests.

Prefer a small TypeScript import-boundary rule plus a cycle check. Do not create internal packages
merely to obtain dependency enforcement.

## Repository extraction rule

An internal module becomes another repository only when all of these are true:

- it has an independent release or deployment lifecycle;
- it has at least one real consumer outside SimpleMark;
- its public contract is stable enough to version;
- ownership and operational cost are explicit.

Until then, extraction is speculative architecture and is rejected. If extraction becomes
justified, create a separate focused repository rather than turning SimpleMark into a monorepo.

## Consequences

### Positive

- One checkout, dependency install, test command, version, and application release.
- Strong boundaries without package-management overhead.
- Source preservation and agent fencing remain reusable rules rather than UI behavior.
- The native app, editor, and MCP surface can change independently behind application ports.
- A future extraction has a clean seam if evidence ever justifies it.

### Costs

- Boundaries rely on automated import checks and review rather than package-manager isolation.
- The root dependency list includes both browser and test dependencies.
- Contributors must resist both convenience imports across adapters and premature shared helpers.
- The existing Phase 0–1 plan must be rewritten from `packages/*` paths to this layout before it is
  executed.

## Rejected alternatives

### pnpm workspace with `@simplemark/core` and `@simplemark/editor`

Rejected for now. It creates release-shaped boundaries without separate releases or consumers. The
useful separation survives as `domain`, `application`, and adapter modules inside one package.

### One application module organized by screens

Rejected. UI-driven organization would let file, collaboration, and control rules leak into event
handlers and become inconsistent across desktop and MCP entry points.

### Microservices or local daemons for internal functions

Rejected. The POC is local and single-process. Process boundaries add lifecycle and failure modes
without improving the first proof. A future remote relay is a separate product decision.

## Follow-up

1. Revise the Phase 0–1 implementation plan to use this layout.
2. Add import-boundary and cycle checks during repository scaffolding.
3. Keep the fidelity spike under `spike/fidelity/`; it produces a decision and is not promoted into
   a permanent internal package.
4. Follow [`ADR-0002`](0002-local-document-session-before-crdt.md): Phase 1 uses the application
   `DocumentSession`; the collaboration adapter waits for the multi-client authority decision.
