# Bear-inspired editing reference

**Status:** observed in Bear on macOS, 2026-08-03; implementation reference for SimpleMark

This is a behavior reference, not a request to copy Bear's code, assets, wording, or exact visual
design. SimpleMark keeps portable Markdown as its canonical source and uses its own visual system.
The useful lesson is Bear's restraint: the document stays visually dominant, while editing tools are
available in one quiet place and become specific only when the cursor needs them.

## Product rule

SimpleMark's reader remains calm by default. Formatting is an optional, compact *styles bar* that
can be toggled from View. It must never turn the document into a permanent ribbon, a source editor,
or an application cockpit.

The styles bar is an editing aid. It does not change the source-preservation contract: untouched
Markdown remains byte-identical; a changed table serializes only its source block through
`DocumentSession`.

## Observed Bear interaction

### Styles bar

In the inspected Bear configuration, the styles bar was hidden. When enabled it appears as a small,
centered strip at the bottom of the editor, rather than consuming a full app-wide toolbar. The
observed control order is:

| Order | Control | Form |
| --- | --- | --- |
| 1 | Headers | menu |
| 2 | Todo | button |
| 3 | Lists | menu |
| 4 | Bold | button |
| 5 | Italic | button |
| 6 | Highlight | menu |
| 7 | Link | button |
| 8 | Tables | button |
| 9 | Image/File | button |
| 10 | More | overflow menu |

Controls are monochrome, compact, evenly spaced, and have no explanatory labels in the normal
state. They acquire meaning through hover/focus tooltips and their menus. SimpleMark should use
the same density and progressive disclosure, but its own icons and typography.

The styles-bar popovers are smaller than the full Format menu and were inspected control by
control:

| Trigger | Bear popover contents |
| --- | --- |
| Headers | Heading 1 through Heading 6 |
| Lists | List; Ordered List; Block Quote; Todo submenu; Callout submenu; Separator |
| Todo submenu | Todo; Toggle; Mark as Completed; Mark as Incomplete; Move Completed to Bottom |
| Callout submenu | Note; Tip; Important; Warning; Caution |
| Highlight | Default; Green; Red; Blue; Yellow; Purple |
| More | Underline; Strikethrough; Footnote; Code; Code Block; Math; Math Block; Wiki Link; Hide Style Bar |

Tables and Image/File are direct buttons, not another layer of menus. Headers, Lists, Highlight,
and More show a small chevron; More uses vertical dots. The Image/File glyph is a picture/file card,
not a paperclip. Popover rows stay visible but dim when the current selection cannot use them.

### Format menu

Bear's macOS **Format** menu is the complete, keyboard-accessible fallback for the styles bar. The
observed hierarchy is:

```text
Headers: Heading 1 … Heading 6
Bold · Italic · Underline · Strikethrough
Highlighter: Default, Green, Red, Blue, Yellow, Purple
Link · Wiki Link
Footnotes: Footnote, Renumber Footnotes
Code: Code, Code Block, Math, Math Block, YAML, Copy Code
List · Ordered List · Quote
Todo: Todo, Toggle, Mark as Completed, Mark as Incomplete, Move Completed to Bottom
Callout: Note, Tip, Important, Warning, Caution
Line Separator
Tables: see below
File
Current Date: several date/time formats
Image Playground · folding actions
```

Commands unavailable at the cursor are visible but disabled. This is important: the menu teaches
what exists without pretending an action applies. SimpleMark should do the same for its supported
subset; it must not expose unsupported rich-text-only commands.

### Other observed menus

Bear uses the normal macOS menubar as a reliable second path, rather than duplicating every action
in the canvas. The relevant patterns are:

| Menu | Observed pattern worth carrying forward |
| --- | --- |
| File | New note, import/export, and print live here—not in the editing bar. |
| Edit | Undo/redo, paste variants, move/indent, find, and system writing tools live here. Copy offers portable output variants, including Markdown and HTML. |
| View | Changes navigation density and document presentation. It includes quick open, preview size, sorting, editor-only modes, statistics/outline/backlinks, and **Toggle Styles Bar**. |
| Note | Controls note-level state: pin, open in new window, read-only, duplicate, archive, privacy, and copy link/identifier. |

For SimpleMark v1, expose only File, Edit, View, and Format commands that map to real local-Mardown
capabilities. The essential borrowed pattern is the split: **View** owns whether editing chrome is
visible; **Format** owns mutations to the focused document block; **File** owns document I/O.

### Tables

Choosing **Tables → Table** at the cursor inserts a compact 2-column × 2-row grid. The top row is
a visually muted, bold header row. The cursor starts in its first cell. Cells are typed into
directly—no modal, column-definition dialog, or separate table editor.

Observed keyboard flow:

```text
type in header cell → Tab → next header cell → Tab → next row, first cell
```

The table is a modest content block, not a database. Borders are thin and pale; the header has a
slightly darker neutral fill. The grid takes only the width it needs within the note measure.

With the cursor in a table, Bear enables these contextual actions:

```text
Tables
  Table
  Copy Table As: Markdown, HTML, CSV
  Align Column: Left, Center, Right
  Add Row · Add Row Above
  Add Column · Add Column Before
  Move Row Up · Move Row Down
  Move Column Left · Move Column Right
  Delete Row · Delete Column
```

Actions which cannot apply are disabled: for example, moving the first row up or first column left.
Outside a table the same mutation/copy actions are disabled, while **Table** remains available to
insert one.

## SimpleMark contract

### v1 table model

- A table is a standard GFM pipe table in the Markdown file; the header row is semantic, not a
  visual-only convention.
- The editor renders it as a native editable table block.
- `Tab` moves to the next cell; `Shift+Tab` moves to the previous cell. At the final cell, SimpleMark
  adds one body row and moves there. This is an explicit usability rule for SimpleMark; the final
  Tab behavior was not relied upon from the Bear observation.
- The contextual table menu appears only when focus is inside the table. It contains only commands
  implemented by the current Markdown serializer.
- Column alignment maps to the normal GFM delimiter syntax (`:---`, `:---:`, `---:`).
- Copy as Markdown is required; HTML and CSV may follow once they can be tested from the same table
  model.
- No database fields, formulas, sorting, free column resize, or proprietary sidecar format in this
  feature. Those are a different product.

### Source and collaboration safety

1. Opening and saving an untouched GFM table preserves its original bytes.
2. Editing a table marks only that block dirty. Save serializes the table block and preserves
   unrelated source bytes, front matter, and line endings.
3. Every table action is a `DocumentSession` operation. UI clicks, keyboard shortcuts, and future
   MCP calls use the same command model.
4. A future agent operation names its table target and expected revision; it cannot silently replace
   a human's active table edit.
5. If a filesystem watcher imports an external change while the table is dirty, use the existing
   external-change path—never patch table cells directly from the watcher.

### SimpleMark styles bar

Implement the following bar, in Bear's observed order:

```text
Headers | Todo | Lists | Bold | Italic | Highlight | Link | Tables | Image/File | More
```

No item in this bar is decorative. Default highlight uses `==text==`; colour highlights use the
readable extension `=={green}text==`; callouts use GitHub's `> [!TYPE]` blockquote syntax; todos use
GFM task items; and More uses portable Markdown or inline HTML where Markdown has no equivalent.
The bar is optional and remembers the user's local preference. On narrow windows it collapses
lower-priority controls into **More** rather than wrapping onto a second row.

### Verified Bear-parity matrix

The Bear macOS style bar and Format menu were inspected as the behavioral oracle. SimpleMark keeps
Bear's order and result while routing every item through the shared command registry:

| Surface | Items exercised | Durable result |
|---|---|---|
| Headers | Heading 1 through Heading 6 | `#` through `######` |
| Todo | Todo, Toggle, Complete, Incomplete, completed-last | GFM `- [ ]` / `- [x]` |
| Lists | List, ordered list, block quote, separator | CommonMark/GFM |
| Callout | Note, Tip, Important, Warning, Caution | GitHub `> [!TYPE]` |
| Inline | Bold, italic, link | CommonMark |
| Highlight | Default, green, red, blue, yellow, purple | `==text==` / `=={color}text==` |
| Object | Table, Image/File | GFM table and portable relative reference |
| More | Underline, strike, footnote, code, code block, math, math block, wiki link | Portable source that reopens rendered |
| Palette | Hide, show, drag, persist, double-click reset | Local UI preference; source unchanged |

Automated UI coverage must click the bar item itself—not call the editor adapter directly—and assert
both rendered output and serialized Markdown. The installed Tauri build is then checked manually for
the native menu dispatch, picker, palette movement, and hide/show behavior.

The macOS menu and styles bar must call the same application commands. The browser and Tauri shells
must render the same bar and table behavior; Tauri supplies native menu wiring, not a second editor.
The approved bottom-centre position is the default and reset point. Users can drag the palette by
its quiet background, its normalized position is remembered locally, and a double-click resets it;
dragging a formatting control still performs only that control's command.

## Acceptance tests

1. With the styles bar off, an opened note is a quiet rendered/editable document with no permanent
   ribbon.
2. Toggle the bar from View and confirm the compact, single-row control order above.
3. Insert a table from the bar and from the native Format menu; both produce identical GFM source.
4. Type four cells and use Tab/Shift+Tab to traverse them. Confirm final-Tab row creation.
5. In the first data row/column, confirm impossible move commands are disabled; move/add/delete
   commands update the visual table and GFM source correctly.
6. Set each alignment and confirm the GFM delimiter row is correct after reopen.
7. Copy as Markdown and confirm the clipboard content is portable GFM.
8. Save an untouched fixture table and prove byte identity. Edit one cell and prove only that table
   block changed.
9. Repeat the table test in the browser shell and the macOS Tauri shell against the same fixture.
10. Verify keyboard focus, buttons, menus, disabled states, and table cells with accessibility
    tooling.

## Scope placement

This is an implementation reference, not permission to expand the current rendered-document POC
into a full word processor. The visually editable GFM table belongs after the Markdown fidelity gate
and shared editor shell are proven. It should be scheduled as a small, independently testable
editor task when that work reaches it.
