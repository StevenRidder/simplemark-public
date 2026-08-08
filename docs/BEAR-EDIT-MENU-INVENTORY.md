# Bear Edit and View menu inventory for SimpleMark

- **Status:** Product inventory and decision record; not an implementation claim
- **Captured:** 2026-08-03
- **Bear observed:** Bear for macOS **2.9.2 (14657)**
- **SimpleMark baseline compared:** origin/main at 4d8ee4603cd7cf21dcdd293eb4aa1cc4dabc11ce

## Decision in one sentence

Take Bear's calm, direct document corrections; do not take its note-database assumptions,
invisible source mutations, or macOS-only plumbing as SimpleMark product requirements.

SimpleMark opens a file the user already owns and keeps it ordinary Markdown. The criterion for
every command is:

> Can this make a small correction, move text, search text, or move portable text into or out of
> the document without hiding or damaging the Markdown file?

If yes, it belongs in SimpleMark. If it is an operating-system service, use the platform where it
exists rather than turning it into permanent product machinery. If it needs Bear's internal note
database or metadata, it does not belong in the first local-file product.

## How this was captured

Bear was opened directly on this Mac. Its window was inspected through accessibility and its actual
compiled MainMenu.nib was read to obtain the complete Edit-menu hierarchy; the app's macOS menu bar
is not exposed in the available accessibility tree. Official Bear support pages were then used only
to confirm behavior for Find/Replace, spelling, substitutions, and clipboard commands.

The list below is the Edit menu in the installed Bear version. It deliberately distinguishes menu
items from the wider Bear feature set: headings, tables, attachments, and themes exist in Bear but
are not Edit-menu commands.

## The complete Bear Edit menu

### History and clipboard

| Bear command | What it does | SimpleMark decision | Current SimpleMark state |
|---|---|---|---|
| Undo | Reverses the last editor action. | **Keep.** Normal local editing behavior. | Implemented in the editor toolbar and browser keyboard handling. |
| Redo | Restores an undone action. | **Keep.** Normal local editing behavior. | Implemented in the editor toolbar and browser keyboard handling. |
| Cut | Removes selected content to the clipboard. | **Keep.** Native editor behavior; no special UI needed. | Browser/ProseMirror behavior, not a visible command yet. |
| Copy | Copies selected content. | **Keep.** Native editor behavior; add an obvious command only if testing shows it is needed. | Browser/ProseMirror behavior, not a visible command yet. |
| Paste | Inserts clipboard content. | **Keep.** It must remain a portable parse-first paste path. | Implemented: Markdown is parsed, and bare Mermaid/SVG at a block boundary is handled deliberately. |
| Copy As → Plain Text | Copies selection with no formatting. | **Keep.** Useful for email, chat, and forms. | Not yet explicit. |
| Copy As → Rich Text | Copies selection as formatted rich text. | **Keep.** Clipboard export only; never a document format. | Not yet explicit. |
| Copy As → Markdown | Copies portable Markdown. | **Keep, high priority.** Clean handoff of a selected section to an agent or code tool. | Not yet explicit. |
| Copy As → HTML | Copies rendered HTML. | **Keep.** Useful for email/CMS handoff; it must never be saved into the MD file. | Not yet explicit. |
| Copy As → Highlighted Parts Only | Restricts copying to Bear's highlights. | **Do not copy literally.** Highlight-only is a Bear-specific query/filter concept; SimpleMark offers normal selection copy. | Not applicable. |
| Copy As → Keep Tags | Includes Bear tags in copied output. | **Do not copy.** SimpleMark has no note-library tag database; a hash is ordinary Markdown text. | Not applicable. |
| Paste From → Plain Text | Pastes text without source formatting. | **Keep.** A deliberate paste-as-plain-text command. | Not yet explicit. |
| Paste From → Rich Text | Uses rich clipboard representation. | **Keep, with a Markdown rule.** Convert where possible; never insert opaque rich-text state. | Normal paste accepts structured clipboard content; no explicit choice yet. |
| Paste From → HTML | Imports an HTML clipboard representation. | **Keep, with a Markdown rule.** Parse allowed Markdown equivalents and preserve unsupported material as readable content. | Normal paste path exists; no explicit HTML-paste choice yet. |
| Paste From → Code | Pastes clipboard content as code. | **Keep.** Insert a fenced code block and leave the source portable. | Not yet explicit. |

### Structure and selection

| Bear command | What it does | SimpleMark decision | Current SimpleMark state |
|---|---|---|---|
| Shift Right | Indents the current list item or structure. | **Keep.** For lists this is portable indentation. | Not yet an explicit command. |
| Shift Left | Outdents the current list item or structure. | **Keep.** For lists this is portable indentation. | Not yet an explicit command. |
| Move Up | Moves the current line/block upward. | **Keep.** A useful direct correction for AI-generated sections. | Implemented as **Move block up**. |
| Move Down | Moves the current line/block downward. | **Keep.** A useful direct correction for AI-generated sections. | Implemented as **Move block down**. |
| Delete | Deletes selected content, a note, or another object depending on Bear context. | **Keep only the document meaning.** Delete selected text/block/table is normal; no hidden note store. | Normal editor delete plus table-local delete actions. |
| Restore | Restores a deleted Bear note from Bear's library/trash. | **Do not copy.** This assumes a managed note database. Recovery belongs to Finder/OS versioning, a future explicit backup feature, or Git. | Not applicable. |
| Select All | Selects all document content. | **Keep.** Native editor behavior. | Browser/ProseMirror behavior, not a visible command yet. |
| Typewriter Mode | Holds the active line around the center of the editing viewport. | **Later reader/editor preference, not content.** A quiet preference if writing sessions prove it useful. | Not implemented. |
| End Editing | Leaves Bear's edit state. | **Do not reproduce as a mode switch.** SimpleMark's default is already the rendered document; a small correction returns to reading. | Product direction already covers this. |
| Note From Selection | Creates a new Bear note from selected content. | **Do not copy as-is.** It creates an item in Bear's database. A future explicit Save Selection as New MD File needs a chosen destination. | Not implemented. |

### Find

| Bear command | What it does | SimpleMark decision | Current SimpleMark state |
|---|---|---|---|
| Find → Note List Search | Searches Bear's note library. | **Do not copy.** There is no SimpleMark library; the OS finds files and SimpleMark opens a chosen one. | Not applicable. |
| Find → Find | Finds text in the current note. | **Keep, high priority.** A long AI report needs calm in-document search. | Search button exists but is not complete. |
| Find → Find and Replace | Finds/replaces text in the current note. | **Keep, high priority.** Replace changes only the explicit target text through the dirty-block save path. | Not implemented. |
| Find → Find Next | Goes to next match. | **Keep.** | Not implemented. |
| Find → Find Previous | Goes to previous match. | **Keep.** | Not implemented. |
| Find → Use Selection for Find | Puts selected text into the search field. | **Keep.** Small, discoverable acceleration. | Not implemented. |
| Find → Jump to Selection | Scrolls the current selection into view. | **Keep where needed.** It should happen automatically after Find and an external update. | Partial editor/browser behavior; no explicit command. |

### Writing assistance supplied by macOS

| Bear command | What it does | SimpleMark decision | Current SimpleMark state |
|---|---|---|---|
| Spelling and Grammar → Show Spelling and Grammar | Opens macOS's spelling/grammar panel. | **Platform integration, not a web feature.** Use native macOS support in the native app; do not build a second spellchecker into the document format. | Not implemented as an app command. |
| Spelling and Grammar → Check Document Now | Runs a spelling pass. | **Platform integration.** | Not implemented. |
| Spelling and Grammar → Check Spelling While Typing | Toggles live spell checking. | **Platform integration.** Web uses browser support where available; native clients use the OS. | Browser-dependent; no product control. |
| Spelling and Grammar → Check Grammar With Spelling | Toggles grammar checking. | **Platform integration.** | Not implemented. |
| Spelling and Grammar → Correct Spelling Automatically | Lets macOS correct text while typing. | **Do not enable silently.** Automatic substitutions can change Markdown/source unexpectedly. Optional platform preference only. | Not implemented. |
| Substitutions → Show Substitutions | Shows macOS text-substitution settings. | **Platform integration.** | Not implemented. |
| Substitutions → Smart Copy/Paste | Applies macOS spacing/paste behavior. | **Platform integration, carefully.** Never let it reformat source beyond the chosen paste command. | Not implemented as a product switch. |
| Substitutions → Smart Quotes | Converts straight quotes to typographic quotes. | **Do not silently apply.** Dangerous in code, JSON, CLI flags, and Markdown examples. Optional OS preference only. | Not implemented. |
| Substitutions → Smart Dashes | Converts hyphens to typographic dashes. | **Do not silently apply.** Dangerous in code and technical prose. Optional OS preference only. | Not implemented. |
| Substitutions → Smart Links | Detects URLs and makes links. | **Keep the visible result, not hidden source mutation.** Save an ordinary Markdown link or raw URL chosen by the user. | Links are supported through the toolbar. |
| Substitutions → Data Detectors | Detects dates, addresses, and similar entities. | **Do not make this a document-format feature.** Browser/OS recognition must not inject proprietary annotations. | Not implemented. |
| Substitutions → Text Replacement | Runs macOS text replacements. | **Platform integration, opt-in.** Never store replacement metadata in the file. | Not implemented. |
| Transformations → Make Upper Case | Changes selected text to upper case. | **Keep.** Plain text transformation, fully portable. | Not implemented. |
| Transformations → Make Lower Case | Changes selected text to lower case. | **Keep.** Plain text transformation, fully portable. | Not implemented. |
| Transformations → Capitalize | Capitalizes selected words. | **Keep.** Plain text transformation, fully portable. | Not implemented. |
| Speech → Start Speaking | macOS speaks the selected/current text. | **Platform/accessibility integration.** Native app delegates to system speech; it is not document content. | Not implemented. |
| Speech → Stop Speaking | Stops speech. | **Platform/accessibility integration.** | Not implemented. |

## The complete Bear View menu

### Capture boundary

The View menu below was opened directly in installed Bear 2.9.2 on 2026-08-03. The app exposed
every item and all three submenus through macOS accessibility. Items marked disabled were disabled
only because no note was open in the current window; they are still part of Bear's View menu and are
included here.

### Library navigation and saved library views

| Bear command | What it does | SimpleMark decision | Current SimpleMark state |
|---|---|---|---|
| Show All Notes | Opens Bear's complete managed-note list. | **Do not copy.** SimpleMark opens a chosen file; it has no managed note library. | Not applicable. |
| Show Untagged | Shows notes that have no Bear tag. | **Do not copy.** Requires Bear's note database and tag index. | Not applicable. |
| Show Todo | Shows Bear notes with incomplete todos. | **Do not copy as a library view.** The open document can render todos, but SimpleMark should not become a task database. | Task lists render in the document. |
| Show Today | Opens Bear's Today library view. | **Do not copy.** This is note-library navigation, not document reading. | Not applicable. |
| Show Locked | Opens Bear's encrypted-note view. | **Do not copy in this form.** Document encryption, if ever needed, is a separate file-security decision. | Not applicable. |
| Show Pinned | Opens Bear's pinned-note view. | **Do not copy.** Pinning is a library feature. A future native recent-file list is a different and much smaller feature. | Not applicable. |
| Show Archive | Opens Bear's archived-note view. | **Do not copy.** Archive is Bear-managed storage state. | Not applicable. |
| Show Trash | Opens Bear's note trash. | **Do not copy.** Local-file recovery belongs to Finder, OS versioning, Git, or a future explicit backup command. | Not applicable. |
| Dismiss Workspace | Leaves a Bear workspace, which is a saved tag-based view. | **Do not copy.** It presumes a workspace and tag library that SimpleMark deliberately does not have. | Not applicable. |
| Quick Open | Finds and opens any Bear note, tag, or sidebar section from a keyboard palette. | **Later, in a narrower form.** Native SimpleMark can offer Open Recent or Quick Open Local File, but never a vault/browser of imported notes. | File open exists; no recent-file palette. |
| Tag Quick Open | Keyboard jump to a Bear tag. | **Do not copy.** Tags are a Bear library navigation system. | Not applicable. |

### List appearance and sorting

| Bear command | What it does | SimpleMark decision | Current SimpleMark state |
|---|---|---|---|
| Zoom In | Enlarges Bear's current view. It was disabled with no note selected. | **Keep the reader outcome, not a second zoom system.** SimpleMark has document-level reader scale. | Implemented as reader text-size preferences. |
| Zoom Out | Shrinks Bear's current view. It was disabled with no note selected. | **Keep the reader outcome, not a second zoom system.** | Implemented as reader text-size preferences. |
| Actual Size | Resets Bear's view zoom. It was disabled with no note selected. | **Keep as Reset Reader Size later.** It must reset only the local reader preference, never write to Markdown. | Reader scale exists; no reset command yet. |
| Preview Style → Small | Uses small previews in Bear's note list. | **Do not copy.** This controls a note-library list, absent by design. | Not applicable. |
| Preview Style → Medium | Uses medium previews in Bear's note list. | **Do not copy.** | Not applicable. |
| Preview Style → Large | Uses large previews in Bear's note list. | **Do not copy.** | Not applicable. |
| Preview Style → Hide Attachments | Hides attachment previews in Bear's note list. | **Do not copy.** The document should render its attachments inline; there is no SimpleMark note-list preview. | Not applicable. |
| Preview Style → Hide Subtag Notes | Hides notes inherited from subtags in a tag view. It was disabled in the current state. | **Do not copy.** Requires nested tag-library semantics. | Not applicable. |
| Notes Sorting → Modification Date | Sorts Bear's note list by modification date. | **Do not copy.** Requires a note library. | Not applicable. |
| Notes Sorting → Creation Date | Sorts Bear's note list by creation date. | **Do not copy.** Requires a note library. | Not applicable. |
| Notes Sorting → Title | Sorts Bear's note list by title. | **Do not copy.** Requires a note library. | Not applicable. |
| Notes Sorting → Newest on Top | Sets Bear's note-list sort direction. | **Do not copy.** Requires a note library. | Not applicable. |
| Tags Sorting → Title | Sorts Bear's tag list by title. | **Do not copy.** Requires a tag library. | Not applicable. |
| Tags Sorting → Number of Notes | Sorts Bear tags by note count. | **Do not copy.** Requires a tag library and its index. | Not applicable. |
| Tags Sorting → A to Z | Sets Bear tag-list sort direction. | **Do not copy.** Requires a tag library. | Not applicable. |

### Document navigation, panels, and layout

| Bear command | What it does | SimpleMark decision | Current SimpleMark state |
|---|---|---|---|
| Back | Returns to the previous Bear navigation-history location. | **Later, narrow scope.** Keep only history between intentionally opened local files and document anchors; do not create note-library history. | Not implemented. |
| Forward | Moves forward through Bear's navigation history. It was disabled because history had no forward entry. | **Later, narrow scope.** Same rule as Back. | Not implemented. |
| Open Link | Follows the selected/current link. It was disabled with no link context. | **Keep.** Ordinary Markdown links should open safely through the platform, with a visible external-link rule. | Links render; explicit command is not implemented. |
| Open Link In New Window | Opens a link in another Bear window. It was disabled with no link context. | **Later.** For local Markdown links, a new native window must still open the ordinary file, not a private note copy. | Not implemented. |
| Show Editor Only | Hides Bear's sidebar and note list. It was disabled because there was no note. | **Keep as the default, not a command.** SimpleMark starts with the one rendered document canvas. | Implemented product shape. |
| Show Notes and Editor | Shows Bear's note list plus editor. | **Do not copy as a permanent view.** This is Bear's library layout. | Not applicable. |
| Show Tags, Notes and Editor | Shows Bear's tag sidebar, note list, and editor. | **Do not copy.** This is the three-panel model we intentionally rejected. | Not applicable. |
| Toggle Statistics Panel | Shows Bear's note information such as word/character count, paragraph count, read time, and edit date. It was disabled with no note. | **Later, quiet document info popover.** Useful only if it stays temporary and document-specific. | Not implemented. |
| Toggle Table of Contents | Shows Bear's heading outline in the information panel. It was disabled with no note. | **Keep.** Long AI documents need this, but as a temporary popover, not a sidebar. | Implemented as the Contents popover. |
| Toggle Backlinks | Shows Bear notes that link to, or mention, this note. It was disabled with no note. | **Do not copy for the first local-file product.** It requires an indexed document collection. A future local-folder index is a separate feature. | Not applicable. |
| Toggle Word Count | Shows/hides Bear's word count. It was disabled with no note. | **Later, as part of document info.** Do not give it permanent chrome. | Not implemented. |
| Toggle Styles Bar | Shows/hides Bear's formatting controls. It was disabled with no note. | **Keep the calm principle.** SimpleMark has a temporary formatting popover and should not add a permanent formatting strip. | Implemented as Text Formatting popover. |
| Toggle History Navigation | Shows/hides visible Back/Forward controls. It was disabled with no note. | **Later, only if local-file history proves valuable.** No permanent browser-like navigation before then. | Not implemented. |
| Expand All Tags | Expands nested tags in Bear's sidebar. | **Do not copy.** Requires a nested tag library. | Not applicable. |
| Collapse All Tags | Collapses nested tags in Bear's sidebar. | **Do not copy.** Requires a nested tag library. | Not applicable. |
| Customize Toolbar | Lets a Bear user customize macOS toolbar items. It was disabled in the current state. | **Defer.** First prove a compact, fixed set of SimpleMark tools; customization is not a reading problem. | Not implemented. |
| Enter Full Screen | Enters native macOS full-screen mode. | **Keep as native platform behavior.** It changes no document state. | Native client not built yet. |

### What Bear's View menu teaches us

Bear's View menu is mostly the control surface for a managed-note library: navigation sections,
sorting, tags, workspaces, previews, and multi-pane layout. Those commands are not missing
SimpleMark features. They belong to Bear because Bear's primary object is its library.

The parts worth carrying forward are much smaller:

1. one-document reader scale and Reset Reader Size;
2. a temporary contents popover, already present;
3. a later temporary document-info popover with word count/read time;
4. safe link opening;
5. native full screen; and
6. only later, simple Back/Forward for files and anchors the user explicitly opened.

Everything else would move SimpleMark away from the rendered document and toward the exact
three-panel cockpit we are avoiding.

## What all of them means for SimpleMark

We should not put the entire menu in the top bar. That would recreate a word processor and violate
the single-document, rendered-first promise. Make every relevant capability available in one of
three places:

1. **Quiet top toolbar/popover:** formatting, lists, tables, portable insertion, undo/redo, and the
   handful of operations used during a correction.
2. **Contextual selection/block/table menu:** copy-as, paste-as, indent/outdent, move, transforms,
   and table actions. It appears only when there is something to act on.
3. **Native menu / keyboard / platform setting:** history, selection, spellcheck, substitutions,
   speech, and other OS behavior. The future Tauri app gets standard menu entries on macOS, Windows,
   and Linux where their platform counterpart exists.

This produces Bear's cleanliness without pretending a browser must emulate macOS.

## Recommended sequence

This is intentionally a sequence, not permission to build a 40-button toolbar.

### A. Finish the direct-document corrections first

1. In-document **Find / Find Next / Find Previous / Use Selection for Find**.
2. **Find and Replace**, scoped to the open document and saved through dirty-block serialization.
3. Explicit **Copy As Markdown / Plain Text / Rich Text / HTML**.
4. Explicit **Paste As Plain Text / Rich Text / HTML / Code** with a clear portable-result rule.
5. **Indent / outdent** for lists and selected list items.
6. Selected-text **Upper Case / Lower Case / Capitalize**.

### B. Make the native app feel native

1. Standard menus and keyboard commands: Undo, Redo, Cut, Copy, Paste, Delete, Select All, Find.
2. Platform spellcheck, grammar, substitutions, text replacement, and speech—visible as platform
   capabilities rather than pretending they are portable Markdown features.
3. A small optional Typewriter Mode preference if dogfooding says longer writing sessions need it.

### C. Explicitly reject for the local-file product

- A Bear-style note library, note trash, restore command, archive system, or database-only tags.
- Note From Selection that silently creates a proprietary note. If wanted later, it is an explicit
  **Save Selection as New Markdown File** command.
- Automatic smart quotes, smart dashes, or automatic grammar rewrites that can corrupt technical
  source.
- Any clipboard or data-detector state saved alongside the Markdown.

## Delivery scope and order

### Decision: do the native Mac one-file client first

The next product delivery should be the **native macOS one-file proof**, not this entire Edit-menu
bundle.

It is the product's install reason: open the original local Markdown file, render it beautifully,
save it back safely, and show a calm external-file update when an agent changes it. It also gives
the product proper filesystem access, file watching, native menus, and standard platform editing
behavior. Without that, a larger browser toolbar is still a good demo, but not the local application
we are promising.

The current browser implementation remains the shared editor/test harness. The native shell is
supposed to load that same editor, renderer, document session, and UI; it replaces only the
platform file/window adapters. That means this is not throwaway work and the correction layer below
will ship in both clients.

### Native Mac delivery: minimum, not Bear clone

**Goal:** one calm macOS window for one chosen Markdown file.

It must:

1. open an existing local MD file and show the rendered document first;
2. save the same file with atomic local persistence;
3. watch that file and surface a clean external-change decision without overwriting a dirty edit;
4. use the shared SimpleMark editor, table behavior, rendering, and reader preferences;
5. support normal platform Undo, Redo, Cut, Copy, Paste, Delete, and Select All;
6. give a clear failed-write or changed-on-disk state; and
7. avoid a file library, sidebar, workspace, account, agent setup, or permanent menu cockpit.

It does **not** need to implement Find/Replace, Copy As, Paste As, transformations, typewriter mode,
speech, or a full custom macOS Edit menu. A visible unfinished web Search affordance must remain
truthful in the native shell; it may be hidden/disabled until the command actually works.

### Follow-up delivery: the real board sequence

This inventory was written before the work was broken down, and named a single generic EDITOR-5
delivery. That reference is obsolete. The scope below is now carried by five board tasks, and each
row in the tables above belongs to exactly one of them:

| Task | Scope from this inventory |
|---|---|
| **EDITOR-8** | This document and its command registry — contract only, no UI behaviour |
| **EDITOR-9** | Render and edit portable technical blocks: math, footnotes, callouts |
| **EDITOR-10** | Portable clipboard and technical exports — Copy As / Paste As |
| **EDITOR-11** | Structural corrections — indent/outdent, move, text transformations |
| **EDITOR-12** | Temporary reader navigation and document information |
| **APP-3** | The macOS menubar and native OS services that expose the above |

The scope itself is unchanged and is intentionally limited to the Bear commands that improve an
existing document without needing a note database:

1. **Find and replace:** Find, Next, Previous, Use Selection for Find, and explicit Replace/Replace
   All in the open document only.
2. **Clipboard output:** Copy As Markdown, Plain Text, Rich Text, and HTML. Markdown is the selected
   portable source; Rich Text and HTML are clipboard representations only.
3. **Clipboard input:** Paste As Plain Text, Rich Text, HTML, and Code. The result must be portable
   Markdown or visibly rejected; no opaque rich-text state.
4. **Structure:** indent/outdent selected list items, plus existing move-block actions.
5. **Plain-text transformations:** upper case, lower case, capitalize.
6. **Interaction:** commands live in a contextual selection/block menu and keyboard shortcuts, not
   as another permanent toolbar row.

### Acceptance criteria for that sequence

- Find highlights and navigates matches without replacing the rendered document shell or losing the
  reading position.
- Replace changes only the requested matches, creates one undoable user action per command, and
  follows the existing dirty-block save rules.
- Copy As Markdown gives a valid portable selection; Copy As Rich Text/HTML never changes the file.
- Every Paste As option has a deterministic source result, passes through the normal sanitizer and
  parser rules, and remains undoable.
- Indent/outdent and text transformations survive save and reopen as ordinary Markdown.
- Existing untouched bytes remain untouched, including around the edited block.
- The same behavioral tests run against the browser bundle and the Tauri-loaded bundle.

### Explicitly deferred beyond that sequence

- Typewriter Mode only if dogfooding proves it improves sustained editing.
- Native spelling, grammar, substitutions, speech, and data-detector menu integration: platform
  polish, not a portable-document milestone.
- Save Selection as New Markdown File, only after we specify destination, collision, title, and
  atomic-write behavior.
- Windows/Linux menu adaptation after the macOS client proves the one-file experience.

## Guardrails for implementation

- An untouched MD file must remain byte-identical after open/save.
- A document change must be ordinary Markdown or be rejected with a clear explanation. Clipboard HTML
  and rich text may be input but never become hidden editor state.
- A command that exports rich text or HTML is clipboard-only; saving always writes Markdown.
- The default screen remains the rendered document. Search, table tools, and selection controls are
  temporary and dismissible.
- Native menus can meet platform expectations. The web app exposes the meaningful actions without
  cloning macOS-only commands.

## Evidence links

- [Bear: search text and replace in a note](https://bear.app/faq/how-to-search-text-inside-notes-in-bear/)
- [Bear: disable spell check and corrections](https://bear.app/faq/disable-spell-check-and-corrections/)
- [Bear: smart quotes and dashes](https://bear.app/faq/how-to-disable-smart-quotes-and-dashes/)
- [Bear: macOS custom shortcuts apply to menu functions](https://bear.app/faq/customise-mac-shortcuts/)
- [Bear: macOS and web editor/table keyboard shortcuts](https://bear.app/faq/web-keyboard-shortcuts/)
- [Bear: note search and Quick Open](https://bear.app/faq/how-to-search-notes-in-bear/)
- [Bear: information panel, contents, and backlinks](https://bear.app/faq/how-to-use-the-info-panel-table-of-contents-and-backlinks-in-bear/)
- [Bear: sidebar and tag sorting](https://bear.app/faq/about-the-sidebar-in-bear/)

The installed-app capture is the authority for the exhaustive menu names above; Bear's public pages
describe selected behavior but are not a complete menu reference.
