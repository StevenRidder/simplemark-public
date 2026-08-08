# Reader-canvas zoom: macOS technical scope

**Status:** proposed implementation scope; no accepted architecture is changed by this document

**Applies to:** macOS Tauri shell only

**Product authority:** [`PRODUCT.md`](PRODUCT.md) §§3–3a, 7, and 9

**Governing architecture:** [`ADR-0001`](decisions/0001-single-product-modular-architecture.md),
[`ADR-0002`](decisions/0002-local-document-session-before-crdt.md), and
[`ADR-0006`](decisions/0006-one-authoritative-change-stream.md)

## 1. The outcome

SimpleMark should zoom like Pages, Preview, or Word:

```text
macOS window
┌──────────────────────────────────────────────────────────────────┐
│ native menu / fixed application chrome                            │
├───────────────┬───────────────────────┬──────────────────────────┤
│ Library       │ Notes                 │ Reader canvas            │
│ fixed         │ fixed                 │ pinch magnifies here     │
│               │                       │ only                     │
│               │                       │                          │
│               │                       │ document, images, SVG,  │
│               │                       │ Mermaid, tables, text    │
└───────────────┴───────────────────────┴──────────────────────────┘
```

Pinching over the reader magnifies the rendered document as a visual canvas. It does **not**
reflow the text, resize the Library or Notes panes, move their controls, or enlarge the fixed
formatting dock. Images, diagrams, tables, and text scale together. The reader remains editable.

`Command +` and `Command -` remain reader-text-size commands. `Command 0` restores both reader
text size and reader-canvas magnification to actual size. All of this is local presentation state;
none of it changes Markdown.

The safe operating range remains 20% through 500%. “As small or large as I want” means smooth,
useful access across that range, not an unbounded scale that can overflow rendering or make the
window unusable.

## 2. Why the current implementation cannot provide that outcome

Today the Tauri window has one `WKWebView`. Its DOM contains the title bar, Library pane, Notes
pane, formatting dock, and `document-surface`:

```text
one WKWebView
├── title bar
├── Library pane
├── Notes pane
├── document surface
│   ├── editor / rendered blocks
│   └── formatting dock
└── document-information panel
```

`src-tauri/src/macos_zoom.rs` correctly asks WebKit to magnify that complete view. WebKit does
not expose a “magnify only this DOM subtree” boundary, so the three-pane window must magnify as a
unit. When only the document pane is visible, that happens to look like document zoom.

CSS `zoom`, `transform`, or inverse-scaling the sidebars is not an acceptable substitute:

- `zoom` changes layout and line wrapping, so text moves rather than being magnified;
- `transform` requires independently fixing scroll extent, pinch focal point, selection/caret
  coordinates, menus, drag/drop, IME, and accessibility; and
- compensating the fixed panes produces clipping and unstable geometry at non-100% scales.

Those techniques are rejected for the native reader experience.

## 3. Proposed native shape

The macOS host composes two presentation views in one native window:

```text
NSWindow
├── shell WebView (fixed)
│   ├── Library and Notes panes
│   ├── title/status presentation
│   └── fixed formatting and reader controls
└── reader WebView (child, magnifiable)
    ├── Milkdown / rendered document
    ├── inline edit surface, selection, and contextual block controls
    └── floating document-information panel
```

The native menu bar and macOS traffic lights remain native, outside both WebViews. The child reader
WebView is bounded to the current document rectangle. On resize, pane collapse, column resize, or
editor-only mode, the shell reports that rectangle and the macOS host updates the child bounds.

Only the child reader WebView enables `WKWebView.allowsMagnification` and receives the persisted
reader-canvas scale. This makes native WebKit responsible for smooth pinch animation, visual scale,
scroll bounds, hit testing, and the pinch focal point—the same class of responsibility it has in a
browser or document viewer.

The implementation must use a supported Tauri/Wry child-WebView route on macOS. A short spike
decides whether the supported Tauri multi-WebView API is sufficient or whether the small AppKit
adapter in `src-tauri/` must host the child `WKWebView`. Application and document rules do not move
into Rust in either case.

## 4. One document authority remains non-negotiable

This is a **presentation split**, not two editors.

```text
shell click / native menu / keyboard intent
                  │
                  ▼
          reader command bridge
                  │
                  ▼
  one DocumentSession → one accepted transaction stream → one save/watch path
                  │
                  ▼
       read-only shell presentation snapshot
```

The reader owns the only live `DocumentSession`, `MilkdownEditor`, file port, save lifecycle, and
external-change watcher. The shell has no document model, editor adapter, file watcher, or write
capability. It renders workspace/catalog state and emits typed user intent.

This protects the existing contracts:

- a ProseMirror edit, menu action, agent operation, and external-byte import still converge through
  the one application acceptance path;
- open/save/watch behavior cannot split according to which WebView originated an action; and
- a native presentation choice does not create a second product or a native-only document model.

The existing browser build remains a single DOM composition. It continues to use the same reader,
workspace, command, renderer, and `DocumentSession` modules; it simply does not have a macOS child
WebView boundary to exploit.

## 5. Required contracts

The two WebViews may not exchange DOM objects, ProseMirror state, source bytes, or ad-hoc strings.
They communicate over a small typed bridge.

### Shell → reader: intent only

```ts
type ShellIntent =
  | { readonly type: 'select-note'; readonly noteId: string }
  | { readonly type: 'select-collection'; readonly collectionId: string }
  | { readonly type: 'create-note' }
  | { readonly type: 'toggle-pin'; readonly noteId: string }
  | { readonly type: 'run-command'; readonly command: DocumentCommandId }
  | { readonly type: 'set-reader-bounds'; readonly bounds: PhysicalRect }
```

The reader validates and handles each intent through existing application commands or the native
workspace coordinator. The shell never sends a Markdown replacement or a ProseMirror transaction.

### Reader → shell: presentation snapshot only

```ts
interface ShellSnapshot {
  readonly workspace: WorkspaceOptions
  readonly title: string
  readonly saveState: SaveState
  readonly commandState: Readonly<Record<DocumentCommandId, CommandState>>
  readonly readerBounds: PhysicalRect
}
```

The shell uses this snapshot to paint pane rows, title/status state, and disabled controls. It does
not cache a hidden editable document. State updates are versioned so an old snapshot cannot replace
the state for a newly opened note.

### Host responsibilities

The macOS host alone creates/destroys the child view, applies physical bounds, directs menu events
to the focused reader, and applies reader-canvas magnification. It never parses, edits, saves, or
watches a document.

## 6. Delivery sequence

### Phase A — native feasibility spike

Create no product feature yet. Build two static native WebViews in one development window and prove:

1. the reader child can be positioned, resized, hidden, and restored with no white seams or stale
   hit-test region;
2. trackpad pinch magnifies only the reader child at 20%, 100%, and 500%;
3. the shell stays pixel-stable while the reader changes scale;
4. keyboard focus, IME, copy/paste, native right-click, and an AppKit menu command reach the reader;
5. child destruction at close does not leak an event monitor or crash the app; and
6. macOS VoiceOver exposes a coherent focus order across shell and reader.

Record the exact macOS/Tauri/Wry APIs and the result in `spike/reader-canvas-zoom/RESULT.md`.
If this spike fails, stop. Do not substitute CSS scaling.

### Phase B — extract presentation seams without changing behaviour

Refactor `src/app/ui/window-chrome.ts` into reusable presentation pieces:

- `WorkspaceShell`: Library, Notes, title/status, fixed controls, and layout measurement;
- `ReaderSurface`: editor section, contextual block controls, document information, and reader
  scroll state; and
- shared typed command and workspace snapshot interfaces.

The browser continues to mount those pieces in its current single DOM. Existing browser tests must
remain unchanged in outcome. This phase is structural extraction, not a visual redesign.

### Phase C — native reader ownership and bridge

Move the current native composition so `DocumentSession`, `MilkdownEditor`, file watching, selection
state, context-menu preparation, and menu command execution live in the reader process. Add the
typed shell-intent and shell-snapshot bridge. The active-document transition remains one superseding
operation: a late open, watcher event, or snapshot must not revive a previous document.

Persist shared preferences through one logical preference owner. Do not rely on two independently
written WebView `localStorage` records for the same preference. Existing retained state—pane layout,
column widths, reader preferences, active collection, window geometry, styles-bar visibility and
position—must survive this refactor.

### Phase D — native layout and zoom

1. The fixed shell measures the document rectangle after every layout change.
2. It reports debounced physical-pixel bounds to the host while pane drags are active.
3. The host applies those bounds to the reader child without recreating it.
4. The reader child enables native magnification and restores the last reader-canvas scale.
5. `Command +` / `Command -` change text size only; pinch changes canvas scale only; `Command 0`
   resets both.
6. The formatting dock stays in the shell and remains fixed. Contextual block affordances remain in
   the reader and magnify with the page.

Reader-only mode sets the reader bounds to the full content region and preserves the existing
centered filename rule. Two- and three-pane modes retain their current title placement.

### Phase E — remove the interim whole-window magnification path

After the child reader passes the acceptance criteria, remove the current main-WebView
`enable_page_magnification`/`set_page_magnification` route. There must be one page-magnification
implementation in the macOS product, not a feature flag or a hidden fallback.

## 7. Acceptance criteria

The work is complete only when an installed macOS build proves all of the following on a real
Markdown file containing prose, a large image, a table, Mermaid, SVG, and editable text:

1. Pinch over the document smoothly magnifies and shrinks only the document canvas; text, images,
   diagrams, and tables remain proportionate and the pinch focal point stays under the pointer.
2. The Library pane, Notes pane, native menu bar, title/status controls, and fixed formatting dock
   do not change size or position at reader scales 20%, 100%, and 500%.
3. Zooming never causes sidebars to stack, controls to clip, the reader to overflow its bounds, or
   a blank/black region to appear.
4. Selecting, editing, typing with an IME, drag selection, copy/paste, right-click Copy As, and
   native Format/View menu commands work at non-100% reader scales.
5. `Command +`, `Command -`, and `Command 0` have the stated split semantics and persist/reopen
   correctly.
6. Changing panes, resizing columns, opening another note, and receiving an external-file update
   preserve the single-session guarantees and never leave an orphan reader view.
7. The browser product retains its current one-DOM behavior and shares the same commands, document
   model, renderer, and source-preservation tests.

Required evidence:

- focused TypeScript tests for bridge ordering, stale-snapshot rejection, preferences, and command
  routing;
- existing browser Playwright coverage plus new extraction coverage;
- `npm run test:native` and `npm run build:native` on macOS;
- `bash scripts/simplemark_ci.sh` from a clean worktree before the final PR; and
- a recorded manual installed-app smoke matrix for the native child-view behavior.

## 8. Explicit non-goals

- No new Markdown syntax, storage format, workspace/vault, cloud connection, OAuth flow, or
  provider-specific code.
- No second `DocumentSession`, file watcher, save leader, or collaboration transport.
- No migration of document rules into `src-tauri/`.
- No CSS-only visual zoom workaround.
- No promise of identical native pinch semantics in the browser, Windows, or mobile as part of this
  macOS scope.
- No release or `/Applications` install until the native proof and the full batch gate pass.

## 9. Main risks and their controls

| Risk | Control |
| --- | --- |
| Tauri cannot safely host the child at the required layer | Phase A is a stop/go spike before product refactoring. |
| Two views accidentally create two document authorities | Reader-only `DocumentSession` ownership; shell gets snapshots and sends typed intent only. |
| Focus or menu actions land in the wrong view | One host-owned focus/router contract, covered by native smoke cases. |
| Resize causes flicker or stale hit testing | Keep the reader view alive; update physical bounds in place and coalesce drag updates. |
| Preferences diverge between WebViews | One logical preference owner and versioned values. |
| Browser and native become separate products | Extract shared presentation and command modules first; browser remains the same composition with one host. |

## 10. Decision required before implementation

Approve Phase A as a dedicated macOS architecture spike. Its only question is whether a child
native reader WebView can satisfy the fixed-shell/magnified-canvas contract without breaking focus,
editing, accessibility, or the one-`DocumentSession` rule.

If it passes, Phases B–E are the implementation plan. If it fails, the honest choices are to keep
whole-window WebKit magnification temporarily or defer native canvas zoom. CSS reflow is not a
fallback.
