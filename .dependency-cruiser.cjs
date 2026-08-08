// Executable enforcement of ADR-0001.
//
//   app ──> adapters ──> application ──> domain
//                             ^
//                             │
//                 UI and MCP call the same use cases
//
// ADR-0001 §Enforcement requires these to be executable before product code
// grows beyond the fidelity spike, and explicitly prefers "a small TypeScript
// import-boundary rule plus a cycle check" over inventing internal packages
// just to obtain dependency enforcement. One dev dependency does both.

/** Node built-ins that must never reach a pure module, with or without the `node:` prefix. */
const NODE_BUILTINS = '^(node:)?(fs|fs/promises|path|os|child_process|http|https|net|worker_threads)$'

/** Framework, DOM, shell, and CRDT packages the pure modules may not depend on. */
const IMPURE_PACKAGES = '^(@tauri-apps|@milkdown|prosemirror-|yjs|y-|mermaid|dompurify|react|vue|svelte)'

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports make ownership of a rule ambiguous. ADR-0001 §Enforcement (1).',
      from: {},
      to: { circular: true },
    },

    // ---- Dependency direction (ADR-0001 §Dependency direction) ----
    {
      name: 'domain-imports-nothing-inward',
      severity: 'error',
      comment:
        'domain imports no other SimpleMark module. It owns source preservation and fencing, ' +
        'so it may not depend on use cases, adapters, or UI.',
      from: { path: '^src/domain/' },
      to: { path: '^src/(application|adapters|app)/' },
    },
    {
      name: 'application-imports-only-domain',
      severity: 'error',
      comment:
        'application defines ports and owns DocumentSession. It may import domain only — ' +
        'never a concrete adapter or the composition root.',
      from: { path: '^src/application/' },
      to: { path: '^src/(adapters|app)/' },
    },
    {
      name: 'adapters-do-not-import-app',
      severity: 'error',
      comment: 'app is the only composition root; an adapter that reaches into it inverts the graph.',
      from: { path: '^src/adapters/' },
      to: { path: '^src/app/' },
    },
    {
      name: 'no-cross-adapter-imports',
      severity: 'error',
      comment:
        'Adapters do not call one another. Shared behavior belongs in application or domain, ' +
        'never a sideways import. ADR-0001 §Enforcement (3).',
      from: { path: '^src/adapters/([^/]+)/' },
      to: {
        path: '^src/adapters/([^/]+)/',
        pathNot: '^src/adapters/$1/',
      },
    },

    // ---- Module contracts (ADR-0001 §Module contracts) ----
    {
      name: 'domain-via-public-entry-point',
      severity: 'error',
      comment:
        'Reach domain through src/domain/index.ts. Importing an internal path couples callers ' +
        'to a file layout the fidelity spike is still allowed to change.',
      from: { pathNot: '^src/domain/' },
      to: { path: '^src/domain/.+', pathNot: '^src/domain/index\\.ts$' },
    },
    {
      name: 'application-via-public-entry-point',
      severity: 'error',
      comment: 'Reach application through src/application/index.ts.',
      from: { pathNot: '^src/(application|app)/' },
      to: { path: '^src/application/.+', pathNot: '^src/application/index\\.ts$' },
    },

    // ---- Purity (ADR-0001: domain and application run in plain Node, no DOM) ----
    {
      name: 'pure-modules-avoid-node-builtins',
      severity: 'error',
      comment:
        'domain and application must run without a filesystem or process. Filesystem reads, ' +
        'hashes, and atomic writes are owned by adapters/filesystem behind an application port.',
      from: { path: '^src/(domain|application)/' },
      to: { dependencyTypes: ['core'], path: NODE_BUILTINS },
    },
    {
      name: 'pure-modules-avoid-frameworks',
      severity: 'error',
      comment:
        'No DOM, editor, renderer, Tauri, or CRDT package may reach domain or application. ' +
        'ADR-0002 additionally forbids a Yjs dependency anywhere in Phase 1.',
      from: { path: '^src/(domain|application)/' },
      to: { dependencyTypes: ['npm', 'npm-dev'], path: IMPURE_PACKAGES },
    },

    // ---- Hygiene ----
    {
      name: 'no-orphan-modules',
      severity: 'error',
      comment:
        'An unreachable module is dead code or a missing wire-up. Say which. ' +
        'Playwright specs are exempt: the runner discovers them by path, so having ' +
        'no importer is what a test entrypoint looks like, not dead code. Vitest ' +
        'suites are not exempt — they import the modules under test, so a genuinely ' +
        'orphaned one is still a real finding.',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '^tests/ui/.+\\.spec\\.ts$',
          // The CSP spike is a page a human opens in a browser to watch Vega
          // refuse and then succeed under the packaged policy (RENDERERS.md
          // §4.65). Nothing can import it — enforcement is what it tests.
          '^spike/vega-csp/',
        ],
      },
      to: {},
    },
    {
      name: 'src-does-not-import-spike',
      severity: 'error',
      comment:
        'The fidelity spike is disposable — ADR-0001 keeps it under spike/ because it ' +
        'produces a decision, not a module. Product code importing it would promote it ' +
        'by accident.',
      from: { path: '^src/' },
      to: { path: '^spike/' },
    },
    {
      name: 'src-does-not-import-tests',
      severity: 'error',
      comment: 'Product code may not depend on fixtures or test helpers.',
      from: { path: '^src/' },
      to: { path: '^tests' },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    // Built output is regenerated, not authored — cruising it reports the
    // bundle as an orphan every time someone runs the spike build.
    exclude: { path: 'node_modules|^spike/[^/]+/dist/' },
    tsConfig: { fileName: 'tsconfig.json' },

    // Follow type-only imports. Off by default, which would make every
    // `import type` invisible — and the ports that define this architecture are
    // exactly that. Without this, `application/ports.ts` reads as dead code and
    // a framework type could be imported into `domain` unchallenged.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
}
