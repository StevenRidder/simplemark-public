# Sidebar parity test plan

## Native acceptance gate

Finder delivery is one document transition, never a request for another app
window. With SimpleMark already running, double-clicking a second Markdown file
must keep one window, select that file in the existing middle pane, and retain
the notes explicitly opened in this session. It must not adopt every Markdown
file beside an opened file; full-folder discovery requires an explicit Open
Folder action. Pinning the selected note must move it
to the top immediately, update the Pinned count/filter, and survive quit and
relaunch.

Shell icons use the vendored official Tabler outline subset documented in
`THIRD-PARTY-ICONS.md`, including both sidebars and the floating styles bar.
No icon needs a network request at runtime.

**Status:** Executable product contract
**Reference:** Bear for macOS, observed 2026-08-03
**Scope:** The library sidebar and note-list sidebar in web and native SimpleMark

SimpleMark does not pass because it resembles Bear in a screenshot. It passes when the same action
causes the same useful state transition. Browser fixture behavior is useful component proof, but it
does not prove that the native app can discover, create, pin, trash, or reopen real files.

## Product rule

Opening a note adds exactly that note to persistent **Recent Notes** history and selects it. This
includes Finder, the picker, and a note selected while browsing an adopted folder. Reopening moves
the note to the top without duplication; X removes it from history without deleting the file.
Closing a background row preserves the active editor DOM, selection, and scroll position. Closing
the active row removes it from both the list and reading/editing pane, then selects the next visible
note or a clean no-selection state. In a folder view, X persists a local exclusion so a catalog
refresh cannot resurrect the row. Folder membership is always
explicit: **Add Folder** adopts the direct Markdown children of that folder as a named collection.
Several adopted folders may remain in the library at once, and selecting one scopes the middle
pane without opening another window. Adding a folder never bulk-adds its files to Recent Notes;
selecting Recent Notes is the explicit way to leave folder mode. The files on disk remain durable authority; catalog
membership, pins, and preview density are shell state and never rewrite Markdown.

## Test environments

| Environment | Purpose | Required evidence |
|---|---|---|
| Bear disposable note | Behavioral oracle | Before/after state and screenshot for every reference behavior |
| Browser fixture | Fast shared-shell regression | Playwright against the real shared chrome and editor |
| Native temporary folder | Filesystem and Tauri adapter proof | Test-owned `.md` files, exact resulting files, and native UI state |
| Installed `/Applications/SimpleMark.app` | Release proof | Manual smoke on the same build that passed automation |

Native tests must use a temporary folder containing known Markdown fixtures. They must not read,
rename, trash, or rewrite a person's notes.

## Bear observations

The reference pass established these behaviors:

- New Note inserts a selected row without removing existing rows.
- Selecting another row preserves the catalog and swaps only the document.
- Pin To Top moves a note to the top immediately and adds a persistent pin marker.
- Pinned is a filtered collection. Unpin removes the row from that collection while leaving the
  open document visible.
- Search filters the current collection, updates live, and does not close the open document.
- Note-list options expose sorting, preview density, attachment visibility, export, and collection
  navigation.
- Notes and tag groups collapse independently.
- Untagged, Todo, Today, Locked, Pinned, Trash, and a tag each select a distinct collection and
  provide an honest empty state.
- Moving to Trash is reversible. Restore removes the note from Trash and returns it to Notes.
- Sync and Preferences open their corresponding settings surfaces.

## Traceability matrix

Status meanings: **pass** is automated against that surface; **observed** is manually verified;
**gap** is known missing product behavior; **planned** is specified but not implemented.

| ID | Surface | Action | Bear pass condition | Web | Native | Required automation |
|---|---|---|---|---|---|---|
| L1-001 | Library | Select Notes | Notes selected; complete non-trashed catalog shown | pass | gap | component + native |
| L1-002 | Library | Collapse/expand Notes | Built-in collections hide and return; selection survives | planned | gap | component |
| L1-010 | Library | Untagged | Only notes without tags; honest empty state | planned | gap | component + native |
| L1-020 | Library | Todo | Only notes with open todos; honest empty state | planned | gap | component + native |
| L1-030 | Library | Today | Notes modified today | planned | gap | component + native |
| L1-040 | Library | Locked | Locked notes or honest unsupported state | planned | gap | component |
| L1-050 | Library | Pinned | Only pinned notes; count and title agree | pass | gap | component + native |
| L1-060 | Library | Trash | Only trashed notes; restore is available | planned | gap | component + native |
| L1-070 | Library | Collapse/expand folder or tag | Children hide and return independently | planned | gap | component |
| L1-075 | Library | Add two folders | Both remain named in the library with independent counts | planned | partial | adapter + native |
| L1-080 | Library | Select folder or tag | List is scoped and header names the scope | planned | partial | component + native |
| L1-090 | Footer | Sync | Opens truthful sync/folder state; never implies cloud sync | planned | gap | component + manual |
| L1-100 | Footer | Preferences | Opens preferences and returns without losing selection | planned | gap | component + manual |
| L1-110 | Pane | Resize | Width follows pointer, clamps, and persists | planned | gap | component + native |
| L1-120 | Library | Keyboard/accessibility | Logical order, visible focus, names, selected state | planned | gap | axe + keyboard |
| L2-001 | Header | Collection menu | Correct count, sort, density, export, collections | pass | partial | component + native |
| L2-010 | Header | New Note | Creates a durable note, selects it, list count +1 | fixture pass | gap | component + native filesystem |
| L2-020 | List | Select notes repeatedly | Catalog count is stable; only selection/document changes | fixture pass | gap | component + native |
| L2-030 | Header | Search/open/close | Live, scoped, case-insensitive; clear restores rows | partial | partial | component + native |
| L2-031 | Header | No-result search | Calm explicit zero state; document remains visible | planned | gap | component |
| L2-032 | Row | Close active note | Row and reading pane both close; next visible note is selected | pass | partial | component + native |
| L2-040 | Row | Pin | Moves first, marks row, increments Pinned, persists restart | fixture partial | gap | component + native restart |
| L2-041 | Row | Unpin in Pinned | Row leaves collection; open document remains visible | planned | gap | component + native |
| L2-050 | Menu | Sort by modification | Correct order and stable pinned-first rule | pass | partial | component + native metadata |
| L2-051 | Menu | Sort by creation | Correct order with deterministic ties | planned | gap | component + native metadata |
| L2-052 | Menu | Sort by title | Locale-aware order; direction toggles | partial | partial | component |
| L2-060 | Menu | Small/medium/large preview | Row geometry and shown metadata match setting | partial | partial | visual + component |
| L2-070 | Menu | Hide attachments | Thumbnails hide without changing note data | planned | gap | visual + component |
| L2-080 | Row | Move to Trash | File leaves Notes, enters Trash, next row selected | planned | gap | native filesystem |
| L2-081 | Trash | Restore | File leaves Trash and returns to its prior collection | planned | gap | native filesystem |
| L2-082 | Trash | Permanent delete | Requires explicit confirmation; removes only target | planned | gap | native filesystem |
| L2-090 | List | Empty collection | Clear label, no disabled-looking ghost rows | planned | gap | component |
| L2-100 | App | Restart | Active collection, pin, density, pane widths persist | planned | gap | native relaunch |
| L2-110 | Folder | External add | New Markdown file appears once without relaunch | planned | gap | native watcher |
| L2-111 | Folder | External rename | One row renames; identity/selection handled explicitly | planned | gap | native watcher |
| L2-112 | Folder | External remove | Row disappears; dirty open note is protected | planned | gap | native watcher |
| L2-113 | App | Switch watched note | Prior watcher stops; same path deduplicates; quit never panics | n/a | pass | native unit + installed smoke |
| L2-120 | List | Arrow/Return/Delete keys | Selection and destructive shortcuts match menu commands | planned | gap | keyboard + native |
| L2-130 | List | Scroll and selection | Selected row stays visible; no jump after refresh | planned | gap | component + native |
| L2-140 | List | Duplicate filenames | Full paths remain unique; labels disambiguate safely | planned | gap | native filesystem |
| L2-150 | List | Unsupported/corrupt file | One bad file cannot blank or poison the catalog | planned | gap | native filesystem |

## P0 release path

The first useful parity slice is deliberately smaller than all of Bear:

1. Opening a file adopts only that file; unopened siblings never appear by accident.
2. Add Folder adopts that folder's direct Markdown children and leaves previously added folders available.
3. Switching folder rows scopes the middle pane in the same window and saves the previous note first.
4. New Note creates a collision-safe Markdown file in the active folder and selects it.
5. Pin/unpin reorders immediately, drives Pinned, and survives an app restart.
6. Search, Recent Notes, and Pinned operate on the real catalog, and Recent Notes survives relaunch.
7. External create/remove/rename refreshes the catalog without duplicating rows.

Trash, tags, todo extraction, locked notes, and sync follow as separately testable slices. Until a
slice exists, its control is either absent or plainly disabled; it must not pretend to work.

## Executable test shape

Every behavior gets three layers where applicable:

1. **Pure model test:** filtering, ordering, counts, pin state, and collision-safe names.
2. **Shared-shell Playwright:** clicks, focus, accessibility names, selection, visual state, and
   catalog preservation.
3. **Native adapter/release test:** real temporary files, Tauri commands, relaunch persistence, and
   the installed app.

A parity claim requires the test ID in its test name or comment. A screenshot alone cannot close a
behavioral gap, and a browser-only pass cannot close a native gap.

## Manual release checklist

- Open one file from a three-note test folder; only that file appears.
- Add two test folders from the left sidebar; both rows remain and each shows its own Markdown count.
- Switch between both folder rows; the middle pane scopes correctly and the app remains one window.
- Open three rows in sequence; edits save and the count never falls to one.
- Create two notes rapidly; both paths are unique and both remain in the list.
- Pin two notes, switch to Pinned, unpin the selected note, and confirm the editor stays open.
- Quit and relaunch; pins, density, and pane widths return.
- Add, rename, and remove files in Finder while SimpleMark is open; list state converges once.
- Switch between notes repeatedly, hide a row, then quit; the app stays stable and does not leave a
  watcher capable of emitting or panicking after replacement.
- Exercise every visible button in both sidebars with mouse and keyboard.
- Run empty, one-note, 100-note, long-title, duplicate-title, Unicode-title, and unreadable-file
  fixtures.
- Confirm disabled future controls explain why they are unavailable.
- Confirm the tested build is the exact app copied to `/Applications`.
