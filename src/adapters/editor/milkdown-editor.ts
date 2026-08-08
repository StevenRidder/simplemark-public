import { Editor, defaultValueCtx, editorViewCtx, rootCtx, serializerCtx } from '@milkdown/kit/core'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { history, redoCommand, undoCommand } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import {
  codeBlockSchema,
  commonmark,
  createCodeBlockCommand,
  imageSchema,
  insertImageCommand,
  insertHrCommand,
  liftListItemCommand,
  sinkListItemCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  columnResizingPlugin,
  gfm,
  insertTableCommand,
  setAlignCommand,
  toggleStrikethroughCommand,
  footnoteDefinitionSchema,
  footnoteReferenceSchema,
} from '@milkdown/kit/preset/gfm'
import { $prose, $useKeymap, $view, callCommand, getMarkdown } from '@milkdown/kit/utils'
import { closeHistory } from '@milkdown/kit/prose/history'
import { DOMSerializer, Fragment } from '@milkdown/kit/prose/model'
import type { Node as ProseNode, ResolvedPos } from '@milkdown/kit/prose/model'
import { toggleMark } from '@milkdown/kit/prose/commands'
import { NodeSelection, Plugin, Selection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import {
  addRowAfter,
  CellSelection,
  deleteColumn,
  deleteRow,
  deleteTable,
  goToNextCell,
  isInTable,
  moveTableColumn,
  moveTableRow,
} from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'

import type {
  AssetReference,
  ClipboardPort,
  DiagramFixPort,
  DiagramRenderer,
  NoteImageStore,
} from '../../application/index.js'
import { looksLikeMermaid, looksLikeSvg, withFenceMetaKey } from '../../domain/index.js'
import { AssetImageNodeView } from './asset-image-node-view.js'
import { codeBlockMetaSchema } from './code-fence-meta.js'
import { DiagramNodeView, isZoomableLanguage } from './diagram-node-view.js'
import type { DiagramViewRegistry } from './diagram-node-view.js'
import {
  HIGHLIGHT_COLOURS,
  type HighlightColour,
  highlightInputRule,
  highlightRemark,
  highlightSchema,
  toggleHighlightCommand,
} from './highlight-mark.js'
import { foldingKey, foldingPlugin } from './folding.js'
import { codeHighlightPlugin } from './code-highlight.js'
import { findKey, findPlugin } from './find.js'
import type { FindState } from './find.js'
import { calloutRemark, calloutSchema } from './callout.js'
import { largeTableRemark, largeTableSchema } from './large-table.js'
import { mathBlockSchema, mathRemark } from './math-block.js'
import { inlineMathSchema, InlineMathNodeView } from './inline-math.js'
import { toggleUnderlineCommand, underlineRemark, underlineSchema } from './underline-mark.js'
import { wikiLinkSchema, wikiRemark } from './wiki-link.js'
import { pasteSniffers } from './paste-sniffers.js'
import { pageTrimOfferPlugin } from './page-trim-offer.js'
import {
  DEFERRED_TABLE_LANGUAGE,
  DeferredTableNodeView,
  isDeferredTableNode,
  prepareMarkdownForEditor,
} from './deferred-tables.js'

/**
 * The candidate editor: Milkdown on ProseMirror and remark.
 *
 * This is the real D3 candidate, not a demo. Markdown is the model — remark
 * parses it into a ProseMirror document and serialises it back — which is D1
 * expressed as a library. FIDELITY-1 decides whether it can be pushed to satisfy
 * the D7 source-preservation contract or whether the document model has to be
 * rebuilt on raw ProseMirror with an explicit source map. Nothing here presumes
 * that answer; if the bridge is replaced, the schema, NodeViews, UI, and
 * application modules survive it.
 *
 * The adapter owns ProseMirror translation and nothing else. It never writes a
 * file, never renders a diagram itself, and never mutates the document behind
 * the application's back: every change leaves through `onMarkdownChanged`, and
 * the composition root is what turns that into a DocumentSession transaction.
 */

export type EditorCommandName =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'highlight'
  | 'highlightGreen'
  | 'highlightRed'
  | 'highlightBlue'
  | 'highlightYellow'
  | 'highlightPurple'
  | 'inlineCode'
  | 'footnote'
  | 'inlineMath'
  | 'mathBlock'
  | 'quote'
  | 'codeBlock'
  | 'divider'
  | 'link'
  | 'wikiLink'
  | 'foldAll'
  | 'unfoldAll'
  | 'moveBlockUp'
  | 'moveBlockDown'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'toggleTask'
  | 'completeTask'
  | 'incompleteTask'
  | 'moveCompletedTasks'
  | 'indentListItem'
  | 'outdentListItem'
  | 'paragraph'
  | 'uppercase'
  | 'lowercase'
  | 'titleCase'
  | 'calloutNote'
  | 'calloutTip'
  | 'calloutImportant'
  | 'calloutWarning'
  | 'calloutCaution'
  | 'table'
  | 'insertCurrentDate'
  | 'insertLongDate'
  | 'insertCurrentDateTime'
  | 'undo'
  | 'redo'

export interface MilkdownEditorOptions {
  readonly mount: HTMLElement
  readonly initialMarkdown: string
  readonly renderer: DiagramRenderer
  /** Backs the diagram-error box's Copy button. Absent hides that button. */
  readonly clipboard?: ClipboardPort
  /** Backs the diagram-error box's Fix it button. Absent hides that button. */
  readonly diagramFix?: DiagramFixPort
  /** Called after every user edit, with the serialised document. */
  readonly onMarkdownChanged: (markdown: string) => void
  /** Opens a rendered link through the shell's explicit platform boundary. */
  readonly onOpenLink?: (href: string) => Promise<void>
  /** Copies a virtualised table through the shell's clipboard boundary. */
  readonly onCopyDeferredTable?: (source: string) => Promise<boolean>
  /**
   * Fires after the live ProseMirror selection changes — a click, an arrow
   * key, Escape, anything that moves it — not after every keystroke
   * (`onMarkdownChanged` already covers those, on its own debounce). The
   * native menubar is what needs this today: `Format → Diagram`'s ids only
   * read fresh `commandState` when something repaints the menu, and nothing
   * did that on a bare selection change before this (final review Finding 1).
   */
  readonly onSelectionChange?: () => void
  /** Absent in hosts that cannot keep images beside the note. */
  readonly images?: NoteImageStore
}

/**
 * §4 of the chip-chrome spec: every diagram-block action as a command an
 * agent can call — the one behavior surface chips (Task 2), the Format →
 * Diagram submenu (bootstrap.ts), and this app API all call into. Every verb
 * acts on the current selection and returns `false` when it does not apply
 * (no diagram selected, or the selected kind does not support the verb).
 */
export interface DiagramController {
  setWidth(px: number | null): boolean
  setFloat(side: 'left' | 'right' | null): boolean
  delete(): boolean
  editSource(): boolean
  zoomIn(): boolean
  zoomOut(): boolean
  zoomReset(): boolean
  /**
   * `null` off a diagram selection. `'generated'` is the zoomable set
   * (mermaid/dot/graphviz/vega-lite); `'math'` covers a `$$` display block
   * and a latex/tex fence alike; `'text'` is everything else this renderer
   * claims — the paste-exhaust cards (json/ansi/diff/tree/stacktrace) —
   * where only Edit source and Delete apply (final review Finding 2).
   */
  kind(): 'svg' | 'generated' | 'math' | 'text' | null
}

export class MilkdownEditor {
  #blockDrag: { pointerId: number; source: number } | undefined
  #tableControls: HTMLElement | undefined
  #tableControlsOpen = false
  #activeTable: HTMLTableElement | undefined
  #activeTableCell: HTMLTableCellElement | undefined
  /**
   * Fence languages this editor's renderer claims — the same test the
   * codeBlockView NodeView factory runs (`options.renderer.languages`),
   * cached as a Set for `#selectedDiagram`'s membership check.
   */
  readonly #renderLanguages: ReadonlySet<string>

  private constructor(
    private readonly editor: Editor,
    private readonly renderer: DiagramRenderer,
    /** The single exit every document change leaves through. */
    private readonly emitMarkdown: (editorMarkdown: string) => void,
    /** Live diagram/math NodeViews, keyed by nothing but membership — the
     * controller finds the one it wants by matching `blockPos()` against the
     * current selection. */
    private readonly diagramViews: ReadonlySet<DiagramNodeView>,
  ) {
    this.#renderLanguages = new Set(renderer.languages)
  }

  /** §4 of the chip-chrome spec: the one behavior surface under chips, menu
   * items, and (later, gated) agents. Doc-state verbs are transactions; view
   * verbs go through the live NodeView registry. */
  readonly diagram: DiagramController = {
    kind: (): 'svg' | 'generated' | 'math' | 'text' | null => {
      const found = this.#selectedDiagram()
      if (found === null) return null
      const language = (found.node.attrs['language'] as string | undefined) ?? ''
      if (language === 'svg') return 'svg'
      if (
        found.node.type.name === 'math_block' ||
        language === 'math' ||
        language === 'latex' ||
        language === 'tex'
      ) {
        return 'math'
      }
      // Everything else this renderer claims that is not zoomable is a
      // paste-exhaust text card (json/ansi/diff/tree/stacktrace) — 'text',
      // not 'generated'. Classifying through the same predicate `#buildChips`
      // and the grip already use keeps this from drifting onto its own,
      // wider set the way it used to (final review Finding 2).
      return isZoomableLanguage(language) ? 'generated' : 'text'
    },
    setWidth: (px: number | null): boolean => {
      const kind = this.diagram.kind()
      if (kind !== 'svg' && kind !== 'generated') return false
      // Finding 6: a non-finite or sub-pixel width is refused outright,
      // before rounding — never silently clamped or coerced. The API stays
      // unclamped above 1px; the resize grip keeps its own ceiling.
      if (px !== null && (!Number.isFinite(px) || px < 1)) return false
      return this.#layoutKey('width', px === null ? null : String(Math.round(px)))
    },
    setFloat: (side: 'left' | 'right' | null): boolean => {
      const kind = this.diagram.kind()
      if (kind !== 'svg' && kind !== 'generated') return false
      return this.#layoutKey('float', side)
    },
    delete: (): boolean => {
      const found = this.#selectedDiagram()
      if (found === null) return false
      const view = this.editor.action((ctx) => ctx.get(editorViewCtx))
      // closeHistory: the identical fix `DiagramNodeView#deleteBlock` (the
      // chip's own delete path) already applies — a scripted delete through
      // this API is one undo step, not folded into whatever transaction
      // (a paste conversion, say) happened to precede it within
      // prosemirror-history's grouping window (final review Finding 3).
      view.dispatch(closeHistory(view.state.tr.delete(found.pos, found.pos + found.node.nodeSize)))
      view.focus()
      return true
    },
    editSource: (): boolean => {
      const nodeView = this.#selectedDiagramView()
      if (nodeView === undefined) return false
      nodeView.openSource()
      return true
    },
    zoomIn: (): boolean => this.#selectedDiagramView()?.zoomBy('in') ?? false,
    zoomOut: (): boolean => this.#selectedDiagramView()?.zoomBy('out') ?? false,
    zoomReset: (): boolean => this.#selectedDiagramView()?.zoomBy('reset') ?? false,
  }

  /** The selected block, if it is a diagram (or math) block — `kind()`, the
   * layout verbs, and delete all start here. */
  #selectedDiagram(): { pos: number; node: ProseNode } | null {
    return this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { selection } = view.state
      if (!(selection instanceof NodeSelection)) return null
      const node = selection.node
      if (node.type.name !== 'code_block' && node.type.name !== 'math_block') return null
      if (node.type.name === 'code_block') {
        const language = (node.attrs['language'] as string | undefined) ?? ''
        if (!this.#renderLanguages.has(language)) return null
      }
      return { pos: selection.from, node }
    })
  }

  /** The live NodeView behind the selected diagram, for view-state verbs. */
  #selectedDiagramView(): DiagramNodeView | undefined {
    const found = this.#selectedDiagram()
    if (found === null) return undefined
    for (const nodeView of this.diagramViews) {
      if (nodeView.blockPos() === found.pos) return nodeView
    }
    return undefined
  }

  /**
   * Rewrites one fence-meta layout key on the selected diagram, one
   * transaction.
   *
   * `setNodeMarkup` replaces the node's opening/closing "tag" as a structural
   * step, so ProseMirror's default selection mapping reports the
   * `NodeSelection`'s anchor deleted and strands the caret after the block —
   * a chip click surviving the click that made it would be one thing, but the
   * API contract here is that a chained verb (setWidth after setFloat, say)
   * keeps working without a re-select in between. The node's size is
   * unchanged, so `found.pos` is still valid in the post-transaction doc and
   * the same transaction can restore the selection to it directly.
   */
  #layoutKey(key: string, value: string | null): boolean {
    const found = this.#selectedDiagram()
    if (found === null || found.node.type.name !== 'code_block') return false
    const view = this.editor.action((ctx) => ctx.get(editorViewCtx))
    const meta = withFenceMetaKey((found.node.attrs['meta'] as string | undefined) ?? '', key, value)
    const transaction = view.state.tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, meta })
    view.dispatch(transaction.setSelection(NodeSelection.create(transaction.doc, found.pos)))
    view.focus()
    return true
  }

  static async mount(options: MilkdownEditorOptions): Promise<MilkdownEditor> {
    // Do this before Milkdown sees the Markdown. The unsafe work was building
    // a giant ProseMirror table tree during initial parse, so a post-parse
    // NodeView cannot protect the UI thread in time.
    const preparedMarkdown = prepareMarkdownForEditor(options.initialMarkdown)
    /**
     * Live diagram/math NodeViews. Built before `.create()` because Milkdown
     * constructs NodeViews for the initial document during that call, and the
     * `MilkdownEditor` instance the controller lives on does not exist yet —
     * this Set is what the instance is handed once it does.
     */
    const diagramViews = new Set<DiagramNodeView>()
    const diagramRegistry: DiagramViewRegistry = {
      register: (view) => {
        diagramViews.add(view)
      },
      deregister: (view) => {
        diagramViews.delete(view)
      },
    }
    const codeBlockView = $view(codeBlockSchema.node, () => {
      return (node: ProseNode, view: EditorView, getPos: () => number | undefined) => {
        const language = (node.attrs['language'] as string | undefined) ?? ''
        if (
          language === DEFERRED_TABLE_LANGUAGE &&
          isDeferredTableNode(node, preparedMarkdown.deferredTables)
        ) {
          return new DeferredTableNodeView(
            node,
            preparedMarkdown.deferredTables,
            options.onCopyDeferredTable,
          )
        }
        // Only claim fences this renderer actually handles. Every other code
        // block stays an ordinary editable fence.
        if (!options.renderer.languages.includes(language)) {
          return null as unknown as DiagramNodeView
        }
        return new DiagramNodeView(
          node,
          view,
          getPos,
          options.renderer,
          options.clipboard,
          options.diagramFix,
          diagramRegistry,
        )
      }
    })
    // Display math renders through the same NodeView as a diagram fence: one
    // rendered block, one editable source, one failure surface.
    const mathView = $view(mathBlockSchema.node, () => {
      return (node: ProseNode, view: EditorView, getPos: () => number | undefined) =>
        new DiagramNodeView(
          node,
          view,
          getPos,
          options.renderer,
          options.clipboard,
          options.diagramFix,
          diagramRegistry,
        )
    })
    const inlineMathView = $view(inlineMathSchema.node, () => {
      return (node: ProseNode, view: EditorView, getPos: () => number | undefined) =>
        new InlineMathNodeView(node, view, getPos, options.renderer)
    })
    const imageView = $view(imageSchema.node, () => {
      return (node: ProseNode, view: EditorView, getPos: () => number | undefined) =>
        new AssetImageNodeView(node, view, getPos, options.images)
    })

    /**
     * The last Markdown the application has been told about.
     *
     * Every change leaves through `emitMarkdown`, whether it arrives on
     * Milkdown's debounced listener or on a flush, and each emission is
     * measured against this. So a flush that beats the timer does not get
     * counted twice when the timer finally fires, and the document never
     * looks dirty again for an edit that was already delivered.
     */
    let lastEmitted: string | undefined
    const emitMarkdown = (editorMarkdown: string): void => {
      const markdown = preparedMarkdown.restoreMarkdown(editorMarkdown)
      if (markdown === lastEmitted) return
      lastEmitted = markdown
      options.onMarkdownChanged(markdown)
    }

    const editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, options.mount)
        ctx.set(defaultValueCtx, preparedMarkdown.editorMarkdown)
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          emitMarkdown(markdown)
        })
      })
      .use(commonmark)
      // A visual-only mark would disappear after reopen. `==highlight==` is a
      // small portable extension whose parser and serializer travel together.
      .use(highlightRemark)
      .use(highlightSchema)
      .use(toggleHighlightCommand)
      .use(highlightInputRule)
      .use(underlineRemark)
      .use(underlineSchema)
      .use(toggleUnderlineCommand)
      // Tables, task lists, strikethrough, autolinks. DESIGN.md §6 specifies
      // commonmark + gfm, and §5 puts tables and task lists in portability
      // tier 1 — without this preset they have no schema at all (BUG-2).
      .use(gfm)
      // Width handles write only ProseMirror's in-memory table layout. GFM has
      // no column-width syntax, so the Markdown serializer deliberately emits
      // no width metadata (EDITOR-5's portability boundary).
      .use(columnResizingPlugin)
      // Undo/redo. Neither the commonmark nor the gfm preset bundles history,
      // so without this Cmd+Z did nothing at all — POC.md requires it, and
      // DESIGN.md §4.3 requires undo immediately after a paste conversion to
      // restore the raw pasted text.
      .use(history)
      // Cmd/Ctrl+Y for redo alongside the standard Cmd+Shift+Z. It is what many
      // people reach for, and the history keymap does not bind it by default.
      .use($useKeymap('simplemarkRedoKeymap', { Redo: { shortcuts: ['Mod-y'], command: (ctx) => { const call = callCommand(redoCommand.key); return () => { call(ctx); return true } } } }))
      // Parses text/plain clipboard content as Markdown. Without it
      // ProseMirror inserts the payload verbatim and remark then escapes the
      // syntax on the way out, so a pasted document comes back as hundreds of
      // paragraphs full of \\# and \\*\\* (BUG-1).
      // Registered BEFORE clipboard. ProseMirror runs handlePaste in plugin
      // order and the first handler to return true wins, so the sniffer chain
      // must precede the clipboard plugin to see the payload at all.
      .use(pasteSniffers({
        renderer: options.renderer,
        ...(options.images === undefined ? {} : { images: options.images }),
      }))
      // Rides on the same paste transaction as the sniffer chain's HTML path
      // (§4.2): the trim offer bar decorates whatever that plugin marked.
      // Gets the same bound image store as the sniffers: an accepted trim
      // rebuilds content from the raw clipboard HTML, whose image sources are
      // remote again, so it must be able to re-issue capture for them.
      .use($prose(() => pageTrimOfferPlugin(options.images)))
      .use(clipboard)
      .use(listener)
      // Final review Finding 1: the native menubar's Format → Diagram ids
      // only ever repainted from inside a menu action's own `activate` — a
      // bare selection change (a click, an arrow key, Escape) never touched
      // it, so those 8 ids sat permanently disabled, or stale-enabled from
      // whatever the last menu click happened to leave behind. A ProseMirror
      // plugin view's `update` is the one hook that fires on every state
      // change, selection-only ones included; `onSelectionChange` carries
      // that up to whoever owns the menu, which debounces its own repaint
      // rather than this plugin doing it once per keystroke.
      .use($prose(() => new Plugin({
        view: () => ({
          update: (view: EditorView, previousState: EditorState) => {
            if (!view.state.selection.eq(previousState.selection)) options.onSelectionChange?.()
          },
        }),
      })))
      // Quiet gutter folding (EDITOR-3). View state only: a fold hides content
      // with decorations and never changes the serialised Markdown.
      .use(foldingPlugin)
      // Syntax highlighting and in-document find (EDITOR-7). Both are
      // decoration-only: the serialised Markdown is byte-identical with either
      // active. Diagram fences keep their NodeView and stay unhighlighted.
      .use(codeHighlightPlugin(options.renderer.languages))
      .use(findPlugin)
      .use(mathRemark)
      .use(inlineMathSchema)
      .use(mathBlockSchema)
      // Registered after gfm so the table nodes exist to count, and before the
      // views so a deferred table never reaches a table NodeView at all. A
      // document may not stall the main thread because it holds a lot of table.
      .use(largeTableRemark)
      .use(largeTableSchema)
      .use(wikiRemark)
      .use(wikiLinkSchema)
      .use(calloutRemark)
      .use(calloutSchema)
      // Carries the fence info tail (D7): must come after the commonmark
      // preset so the extended code_block schema replaces the stock one.
      .use(codeBlockMetaSchema)
      .use(codeBlockView)
      .use(mathView)
      .use(inlineMathView)
      .use(imageView)
      .create()

    // The baseline comes from the mounted document rather than from
    // `initialMarkdown`, and through the same serialiser every later emission
    // uses. Parsing and re-serialising normalises some Markdown, so comparing
    // against the string on disk would make an untouched document look edited
    // the first time anything flushed it.
    lastEmitted = preparedMarkdown.restoreMarkdown(editor.action(getMarkdown()))

    const instance = new MilkdownEditor(editor, options.renderer, emitMarkdown, diagramViews)
    instance.installLinkOpening(options.mount, options.onOpenLink)
    instance.installTaskToggling()
    instance.installBlockReordering()
    instance.installTableControls()
    return instance
  }

  private installLinkOpening(
    mount: HTMLElement,
    onOpenLink: ((href: string) => Promise<void>) | undefined,
  ): void {
    mount.addEventListener('click', (event) => {
      if (event.button !== 0) return
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (target === null) return
      const href = target.getAttribute('href')?.trim()
      if (href === undefined || href === '') return

      event.preventDefault()
      event.stopPropagation()

      if (href.startsWith('#')) {
        let wanted: string
        try {
          wanted = decodeURIComponent(href.slice(1)).toLocaleLowerCase()
        } catch {
          return
        }
        const slug = (text: string): string => text
          .trim()
          .toLocaleLowerCase()
          .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
        const heading = [...mount.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')]
          .find((candidate) => candidate.id.toLocaleLowerCase() === wanted || slug(candidate.textContent ?? '') === wanted)
        heading?.scrollIntoView({ block: 'start' })
        return
      }

      if (onOpenLink === undefined) return
      void onOpenLink(href)
    })
  }

  /**
   * Runs a formatting command against the live selection.
   *
   * Toolbar presses suppress mousedown so focus and selection survive the click;
   * this only has to re-assert focus for keyboard-driven callers.
   */
  runCommand(command: EditorCommandName): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.focus()
    })

    switch (command) {
      case 'bold':
        this.editor.action(callCommand(toggleStrongCommand.key))
        return
      case 'italic':
        this.editor.action(callCommand(toggleEmphasisCommand.key))
        return
      case 'underline':
        this.editor.action(callCommand(toggleUnderlineCommand.key))
        return
      case 'strikethrough':
        this.editor.action(callCommand(toggleStrikethroughCommand.key))
        return
      case 'highlight':
        this.setHighlight('default')
        return
      case 'highlightGreen':
        this.setHighlight('green')
        return
      case 'highlightRed':
        this.setHighlight('red')
        return
      case 'highlightBlue':
        this.setHighlight('blue')
        return
      case 'highlightYellow':
        this.setHighlight('yellow')
        return
      case 'highlightPurple':
        this.setHighlight('purple')
        return
      case 'inlineCode':
        this.editor.action(callCommand(toggleInlineCodeCommand.key))
        return
      case 'footnote':
        this.insertFootnote()
        return
      case 'inlineMath':
        this.insertInlineAtom('inline_math', 'value', 'x')
        return
      case 'mathBlock':
        this.insertMathBlock()
        return
      case 'quote':
        this.editor.action(callCommand(wrapInBlockquoteCommand.key))
        return
      case 'codeBlock':
        this.editor.action(callCommand(createCodeBlockCommand.key))
        return
      case 'divider':
        this.editor.action(callCommand(insertHrCommand.key))
        return
      case 'link':
        this.editLink()
        return
      case 'wikiLink':
        this.insertWikiLink()
        return
      case 'foldAll':
        this.setAllFolds(true)
        return
      case 'unfoldAll':
        this.setAllFolds(false)
        return
      case 'moveBlockUp':
        this.moveCurrentBlock('up')
        return
      case 'moveBlockDown':
        this.moveCurrentBlock('down')
        return
      case 'heading1':
        this.editor.action(callCommand(wrapInHeadingCommand.key, 1))
        return
      case 'heading2':
        this.editor.action(callCommand(wrapInHeadingCommand.key, 2))
        return
      case 'heading3':
        this.editor.action(callCommand(wrapInHeadingCommand.key, 3))
        return
      case 'heading4':
        this.editor.action(callCommand(wrapInHeadingCommand.key, 4))
        return
      case 'heading5':
        this.editor.action(callCommand(wrapInHeadingCommand.key, 5))
        return
      case 'heading6':
        this.editor.action(callCommand(wrapInHeadingCommand.key, 6))
        return
      case 'bulletList':
        this.editor.action(callCommand(wrapInBulletListCommand.key))
        return
      case 'orderedList':
        this.editor.action(callCommand(wrapInOrderedListCommand.key))
        return
      case 'taskList':
        this.toggleTaskList()
        return
      case 'toggleTask':
        this.setTaskState('toggle')
        return
      case 'completeTask':
        this.setTaskState(true)
        return
      case 'incompleteTask':
        this.setTaskState(false)
        return
      case 'moveCompletedTasks':
        this.moveCompletedTasks()
        return
      case 'indentListItem':
        this.editor.action(callCommand(sinkListItemCommand.key))
        return
      case 'outdentListItem':
        this.editor.action(callCommand(liftListItemCommand.key))
        return
      case 'paragraph':
        this.liftListItemToParagraph()
        return
      case 'uppercase':
        this.transformSelectedText('uppercase')
        return
      case 'lowercase':
        this.transformSelectedText('lowercase')
        return
      case 'titleCase':
        this.transformSelectedText('titleCase')
        return
      case 'calloutNote':
        this.setCallout('note')
        return
      case 'calloutTip':
        this.setCallout('tip')
        return
      case 'calloutImportant':
        this.setCallout('important')
        return
      case 'calloutWarning':
        this.setCallout('warning')
        return
      case 'calloutCaution':
        this.setCallout('caution')
        return
      case 'table':
        this.editor.action(callCommand(insertTableCommand.key))
        return
      case 'insertCurrentDate':
        this.insertLocalDate('numeric')
        return
      case 'insertLongDate':
        this.insertLocalDate('long')
        return
      case 'insertCurrentDateTime':
        this.insertLocalDate('dateTime')
        return
      case 'undo':
        this.editor.action(callCommand(undoCommand.key))
        return
      case 'redo':
        this.editor.action(callCommand(redoCommand.key))
        return
    }
  }

  /** Changes only the folding plugin's temporary view state. */
  private setAllFolds(folded: boolean): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(
        view.state.tr.setMeta(foldingKey, folded ? { foldAll: true } : { unfoldAll: true }),
      )
      view.focus()
    })
  }

  /**
   * Focuses the editor with the caret at the end of the document.
   *
   * What a shell wants after opening a note. Also the only reliable way to get
   * there: End stops at the end of a wrapped visual line, and clicking the
   * canvas can land on a NodeView and take a node selection instead of a text
   * one.
   */
  /**
   * Puts the caret where writing continues — after the last block, not inside
   * it (BUG-2).
   *
   * `Selection.atEnd` resolves the end of the document, and when the last node
   * is a diagram fence that position is *inside* the fence's source. Typing
   * there appends Mermaid; pasting there writes the clipboard into the diagram
   * and corrupts it. So when the final block cannot hold prose, a paragraph is
   * opened after it first.
   *
   * That insertion is safe here and deliberately not done on load: focusEnd is
   * only ever called when someone is about to write. Opening a document that
   * ends in a diagram still changes nothing — `continueAfterLastBlock` remains
   * the explicit control for that, and there is a test for the no-change case.
   */
  focusEnd(): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { doc, schema } = view.state
      const last = doc.lastChild
      const holdsProse = last !== null && last.isTextblock && last.type.spec.code !== true
      const paragraph = schema.nodes['paragraph']

      if (holdsProse || paragraph === undefined) {
        view.dispatch(view.state.tr.setSelection(Selection.atEnd(doc)).scrollIntoView())
        view.focus()
        return
      }

      const insertAt = doc.content.size
      const transaction = view.state.tr.insert(insertAt, paragraph.create())
      view.dispatch(
        transaction
          .setSelection(Selection.near(transaction.doc.resolve(insertAt + 1)))
          .scrollIntoView(),
      )
      view.focus()
    })
  }

  /** Inserts one ordinary Markdown image or file link at the live selection. */
  insertAsset(reference: AssetReference): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.focus()
      if (reference.kind === 'image') {
        const insert = callCommand(insertImageCommand.key, {
          src: reference.src,
          alt: reference.label,
          title: '',
        })
        insert(ctx)
        return
      }

      const mark = view.state.schema.marks['link']
      if (mark === undefined) return
      const { from, to } = view.state.selection
      const transaction = view.state.tr.insertText(reference.label, from, to)
      transaction.addMark(from, from + reference.label.length, mark.create({ href: reference.src, title: '' }))
      view.dispatch(transaction.scrollIntoView())
    })
  }

  /**
   * Starts a new paragraph after the final block only when the reader asks to
   * continue. This avoids both a terminal diagram trapping the caret and an
   * unsolicited source change merely from opening the document.
   */
  continueAfterLastBlock(): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { doc, schema } = view.state
      const paragraph = schema.nodes['paragraph']
      if (paragraph === undefined) return
      const insertAt = doc.content.size
      const transaction = view.state.tr.insert(insertAt, paragraph.create())
      view.dispatch(
        transaction
          .setSelection(Selection.near(transaction.doc.resolve(insertAt + 1)))
          .scrollIntoView(),
      )
      view.focus()
    })
  }

  /**
   * The checkbox everyone tries to click becomes the gesture that toggles it.
   *
   * Milkdown's GFM task item emits no `<input>` — the box is drawn by CSS on
   * the list item — so until now a press there only placed the caret and
   * `checked` was reachable solely from the Format menu.
   *
   * Capture phase on the editor's own node, because ProseMirror registered its
   * mousedown listener first and would otherwise move the selection before this
   * ran. Stopping the event there also keeps the block-drag gutter out of it.
   */
  private installTaskToggling(): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dom.addEventListener(
        'mousedown',
        (event) => {
          if (event.button !== 0 || !view.editable) return
          const item = event.target instanceof Element
            ? event.target.closest<HTMLElement>('li[data-item-type="task"]')
            : null
          if (item === null || !this.withinCheckbox(item, event)) return

          event.preventDefault()
          event.stopPropagation()
          this.toggleTaskAt(view, item)
        },
        true,
      )
    })
  }

  /**
   * Hit-tests the drawn box from the item's own layout rather than from the
   * pixel values in app.css, so the two cannot drift apart. The box occupies
   * the item's left padding on its first line: a click on the third line of a
   * wrapped task is prose, not the checkbox.
   */
  private withinCheckbox(item: HTMLElement, event: MouseEvent): boolean {
    const rect = item.getBoundingClientRect()
    const style = getComputedStyle(item)
    const gutter = Number.parseFloat(style.paddingLeft)
    const firstLine = Number.parseFloat(style.lineHeight)
    if (!Number.isFinite(gutter)) return false
    const height = Number.isFinite(firstLine) ? firstLine : rect.height
    return event.clientX >= rect.left
      && event.clientX < rect.left + gutter
      && event.clientY >= rect.top
      && event.clientY < rect.top + height
  }

  /** Flips `checked` on the task item the pointer landed in. */
  private toggleTaskAt(view: EditorView, item: HTMLElement): void {
    const $pos = view.state.doc.resolve(view.posAtDOM(item, 0))
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      const node = $pos.node(depth)
      if (node.type.name !== 'list_item') continue
      // The innermost item wins, and only a task carries `checked` — a plain
      // item here means the click was not on a box after all.
      if (node.attrs['checked'] == null) return
      view.dispatch(
        view.state.tr.setNodeMarkup($pos.before(depth), undefined, {
          ...node.attrs,
          checked: !(node.attrs['checked'] as boolean),
        }),
      )
      return
    }
  }

  /** A quiet gutter drag becomes one ordinary ProseMirror transaction. */
  private installBlockReordering(): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dom.addEventListener('pointerdown', (event) => {
        const block = this.blockAtY(view, event.clientY)
        if (block === undefined) return
        const rect = block.getBoundingClientRect()
        // The narrow inside gutter is deliberately the only drag affordance.
        // Keeping normal prose drags untouched preserves native text selection.
        if (event.clientX < rect.left - 26 || event.clientX > rect.left - 6) return
        event.preventDefault()
        this.#blockDrag = { pointerId: event.pointerId, source: this.topLevelPosition(view, block) }
        view.dom.setPointerCapture(event.pointerId)
      })

      view.dom.addEventListener('pointerup', (event) => {
        const drag = this.#blockDrag
        this.#blockDrag = undefined
        if (drag === undefined || drag.pointerId !== event.pointerId) return
        const target = this.blockAtY(view, event.clientY)
        if (target === undefined) return
        event.preventDefault()
        const source = drag.source
        const targetRect = target.getBoundingClientRect()
        const insertBefore = event.clientY < targetRect.top + targetRect.height / 2
        this.moveBlock(view, source, this.topLevelPosition(view, target), insertBefore)
      })
    })
  }

  /**
   * A selected table earns one quiet entry point, not a second toolbar. The
   * full correction menu appears only after a reader asks for it.
   */
  private installTableControls(): void {
    const controls = document.createElement('div')
    controls.className = 'table-controls'
    controls.hidden = true
    controls.setAttribute('aria-label', 'Table controls')

    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'table-controls-trigger'
    trigger.textContent = 'Table'
    trigger.setAttribute('aria-label', 'Table options')
    trigger.setAttribute('aria-expanded', 'false')
    trigger.addEventListener('mousedown', (event) => event.preventDefault())
    trigger.addEventListener('click', () => this.setTableControlsOpen(!this.#tableControlsOpen))
    controls.append(trigger)

    const menu = document.createElement('div')
    menu.className = 'table-controls-menu'
    menu.hidden = true
    menu.setAttribute('aria-label', 'Table options')

    // The menu stays document-like, but carries the normal table corrections a
    // person expects from Bear/Obsidian: structure, a visible row/column
    // selection for formatting, and moving the table as one document block.
    const groups: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> = [
      ['Rows', [
        ['rowBefore', 'Row above'], ['rowAfter', 'Row below'],
        ['moveRowUp', 'Move row up'], ['moveRowDown', 'Move row down'],
        ['selectRow', 'Select row'], ['deleteRow', 'Delete row'],
      ]],
      ['Columns', [
        ['colBefore', 'Column left'], ['colAfter', 'Column right'],
        ['moveColumnLeft', 'Move column left'], ['moveColumnRight', 'Move column right'],
        ['selectColumn', 'Select column'], ['deleteColumn', 'Delete column'],
      ]],
      ['Column', [['alignLeft', 'Align left'], ['alignCenter', 'Align center'], ['alignRight', 'Align right']]],
      ['Style', [['boldSelection', 'Bold selected cells']]],
      ['Table', [['moveTableUp', 'Move table up'], ['moveTableDown', 'Move table down'], ['deleteTable', 'Delete table']]],
    ]
    for (const [label, actions] of groups) {
      const group = document.createElement('div')
      group.className = 'table-control-group'
      group.setAttribute('aria-label', label)
      const groupLabel = document.createElement('span')
      groupLabel.className = 'table-control-group-label'
      groupLabel.textContent = label
      group.append(groupLabel)
      for (const [action, title] of actions) {
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset['tableAction'] = action
        button.textContent = title
        button.setAttribute('aria-label', title)
        button.title = title
        button.addEventListener('mousedown', (event) => {
          event.preventDefault()
          this.setTableControlsOpen(false)
          this.runTableAction(action)
        })
        group.append(button)
      }
      menu.append(group)
    }
    controls.append(menu)
    document.body.append(controls)
    this.#tableControls = controls

    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const reveal = (event: Event): void => {
        const target = event.target
        if (!(target instanceof Element)) return
        const table = target.closest('table')
        if (!(table instanceof HTMLTableElement) || !view.dom.contains(table)) return
        const cell = target.closest('th, td')
        requestAnimationFrame(() => this.showTableControls(
          view,
          table,
          cell instanceof HTMLTableCellElement ? cell : undefined,
        ))
      }
      view.dom.addEventListener('pointerup', reveal)
      // A parsed table may move the ProseMirror selection during its click
      // handler, after pointerup. Run once more at click time so existing
      // files get the same controls as a newly inserted table.
      view.dom.addEventListener('click', reveal)
      view.dom.addEventListener('focusin', reveal)
      view.dom.addEventListener('keydown', () => {
        requestAnimationFrame(() => this.refreshTableControls(view))
      })
      view.dom.addEventListener('keydown', (event) => {
        // The stock GFM keymap correctly advances within a table, but stops at
        // its final cell. Capture that one dead end before ProseMirror consumes
        // the key: append a row, then continue into it.
        if (event.key !== 'Tab' || event.shiftKey || !isInTable(view.state)) return
        const selectedCell = this.selectedTableCell(view)
        const table = selectedCell?.closest('table')
        const cells = table?.querySelectorAll('th, td')
        if (selectedCell === undefined || cells === undefined || selectedCell !== cells[cells.length - 1]) return
        const dispatch = view.dispatch.bind(view)
        event.preventDefault()
        event.stopImmediatePropagation()
        if (addRowAfter(view.state, dispatch)) goToNextCell(1)(view.state, dispatch)
      }, true)
    })
  }

  private showTableControls(
    view: EditorView,
    table: HTMLTableElement,
    cell: HTMLTableCellElement | undefined = undefined,
  ): void {
    if (this.#tableControls === undefined) return
    this.#activeTable = table
    if (cell !== undefined) this.#activeTableCell = cell
    const controls = this.#tableControls
    const deleteRow = controls.querySelector<HTMLButtonElement>('[data-table-action="deleteRow"]')
    if (deleteRow !== null) {
      // A pipe table's first row is always its header. Deleting it would make
      // a malformed GFM table, so retain the user-visible data rows only.
      deleteRow.disabled = this.#activeTableCell?.tagName === 'TH'
      deleteRow.title = deleteRow.disabled ? 'The first GFM row is the required header' : 'Delete row'
    }
    const activeRow = this.#activeTableCell?.parentElement
    const rowIndex = activeRow instanceof HTMLTableRowElement ? activeRow.rowIndex : undefined
    const lastRow = table.rows.length - 1
    this.setTableControlEnabled('moveRowUp', rowIndex !== undefined && rowIndex > 1)
    this.setTableControlEnabled('moveRowDown', rowIndex !== undefined && rowIndex > 0 && rowIndex < lastRow)
    const columnIndex = this.#activeTableCell?.cellIndex
    this.setTableControlEnabled('moveColumnLeft', columnIndex !== undefined && columnIndex > 0)
    this.setTableControlEnabled('moveColumnRight', columnIndex !== undefined && columnIndex < table.rows[0]!.cells.length - 1)
    controls.hidden = false
    this.positionTableControls()
  }

  private setTableControlsOpen(open: boolean): void {
    if (this.#tableControls === undefined) return
    this.#tableControlsOpen = open
    const trigger = this.#tableControls.querySelector<HTMLButtonElement>('.table-controls-trigger')
    const menu = this.#tableControls.querySelector<HTMLElement>('.table-controls-menu')
    if (trigger !== null) trigger.setAttribute('aria-expanded', String(open))
    if (menu !== null) menu.hidden = !open
    this.positionTableControls()
  }

  private positionTableControls(): void {
    if (this.#tableControls === undefined || this.#activeTable === undefined) return
    const tableRect = this.#activeTable.getBoundingClientRect()
    const controlsRect = this.#tableControls.getBoundingClientRect()
    const menu = this.#tableControls.querySelector<HTMLElement>('.table-controls-menu')
    // The menu is absolutely positioned, so it does not contribute to its
    // trigger's bounding box. Clamp against whichever of the two is visible.
    const visibleWidth = Math.max(controlsRect.width, menu?.hidden ? 0 : (menu?.getBoundingClientRect().width ?? 0))
    this.#tableControls.style.left = `${Math.max(12, Math.min(tableRect.left, window.innerWidth - visibleWidth - 12))}px`
    this.#tableControls.style.top = `${Math.max(12, tableRect.top - controlsRect.height - 8)}px`
    if (menu === null || menu.hidden) return

    // Prefer opening into the table, but never make a control unreachable at
    // the bottom of a short viewport. In that case it becomes a true popover
    // above the trigger instead of a clipped strip below it.
    menu.style.top = 'calc(100% + 7px)'
    menu.style.bottom = 'auto'
    const openedMenuRect = menu.getBoundingClientRect()
    if (openedMenuRect.bottom > window.innerHeight - 12 && controlsRect.top - openedMenuRect.height - 7 >= 12) {
      menu.style.top = 'auto'
      menu.style.bottom = 'calc(100% + 7px)'
    }
  }

  private refreshTableControls(view: EditorView): void {
    if (!isInTable(view.state)) {
      if (this.#tableControls !== undefined) this.#tableControls.hidden = true
      this.#tableControlsOpen = false
      this.#activeTable = undefined
      this.#activeTableCell = undefined
      return
    }
    if (this.#activeTable !== undefined) this.showTableControls(view, this.#activeTable)
  }

  private selectedTableCell(view: EditorView): HTMLTableCellElement | undefined {
    const selection = window.getSelection()
    const node = selection?.anchorNode
    const element = node instanceof Element ? node : node?.parentElement
    const cell = element?.closest('th, td')
    return cell instanceof HTMLTableCellElement && view.dom.contains(cell) ? cell : undefined
  }

  private setTableControlEnabled(action: string, enabled: boolean): void {
    const button = this.#tableControls?.querySelector<HTMLButtonElement>(`[data-table-action="${action}"]`)
    if (button !== undefined && button !== null) button.disabled = !enabled
  }

  /** Uses ProseMirror's native cell selection, so marks apply to whole cells. */
  private selectTableCells(view: EditorView, kind: 'row' | 'column'): void {
    const cell = this.#activeTableCell
    const row = cell?.parentElement
    if (cell === undefined || !(row instanceof HTMLTableRowElement)) return
    // CellSelection expects the position before a cell, which is the cell's
    // offset inside its row — not a text position inside that cell.
    const beforeCell = view.posAtDOM(row, cell.cellIndex)
    const $cell = view.state.doc.resolve(beforeCell)
    const selection = kind === 'row'
      ? CellSelection.rowSelection($cell)
      : CellSelection.colSelection($cell)
    view.dispatch(view.state.tr.setSelection(selection))
  }

  private moveActiveRow(view: EditorView, direction: -1 | 1): void {
    const row = this.#activeTableCell?.parentElement
    if (!(row instanceof HTMLTableRowElement)) return
    const from = row.rowIndex
    const to = from + direction
    // The first GFM row is the header and never moves into the data range.
    if (from < 1 || to < 1 || this.#activeTable === undefined || to >= this.#activeTable.rows.length) return
    moveTableRow({ from, to })(view.state, view.dispatch.bind(view))
  }

  private moveActiveColumn(view: EditorView, direction: -1 | 1): void {
    const from = this.#activeTableCell?.cellIndex
    if (from === undefined || this.#activeTable === undefined) return
    const to = from + direction
    if (to < 0 || to >= this.#activeTable.rows[0]!.cells.length) return
    moveTableColumn({ from, to })(view.state, view.dispatch.bind(view))
  }

  private sortRowsByActiveColumn(view: EditorView, direction: 1 | -1): void {
    if (this.#activeTable === undefined || this.#activeTableCell === undefined) return
    const column = this.#activeTableCell.cellIndex
    const sourceRows = Array.from(this.#activeTable.rows).slice(1)
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    const desired = sourceRows
      .map((row, index) => ({ index, value: row.cells[column]?.textContent?.trim() ?? '' }))
      .sort((left, right) => direction * collator.compare(left.value, right.value))
      .map(({ index }) => index)
    const current = sourceRows.map((_row, index) => index)
    for (let target = 0; target < desired.length; target += 1) {
      const from = current.indexOf(desired[target]!)
      if (from === target) continue
      if (!moveTableRow({ from: from + 1, to: target + 1 })(view.state, view.dispatch.bind(view))) return
      const [moved] = current.splice(from, 1)
      current.splice(target, 0, moved!)
    }
  }

  private runTableAction(action: string): void {
    if (action === 'moveTableUp') {
      this.moveCurrentBlock('up')
      return
    }
    if (action === 'moveTableDown') {
      this.moveCurrentBlock('down')
      return
    }
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      if (!isInTable(view.state)) return
      switch (action) {
        case 'rowBefore':
          this.editor.action(callCommand(addRowBeforeCommand.key))
          break
        case 'rowAfter':
          this.editor.action(callCommand(addRowAfterCommand.key))
          break
        case 'colBefore':
          this.editor.action(callCommand(addColBeforeCommand.key))
          break
        case 'colAfter':
          this.editor.action(callCommand(addColAfterCommand.key))
          break
        case 'deleteRow':
          if (this.#activeTableCell?.tagName === 'TH') return
          deleteRow(view.state, view.dispatch.bind(view))
          break
        case 'deleteColumn':
          deleteColumn(view.state, view.dispatch.bind(view))
          break
        case 'selectRow':
          this.selectTableCells(view, 'row')
          break
        case 'selectColumn':
          this.selectTableCells(view, 'column')
          break
        case 'boldSelection':
          this.editor.action(callCommand(toggleStrongCommand.key))
          break
        case 'moveRowUp':
          this.moveActiveRow(view, -1)
          break
        case 'moveRowDown':
          this.moveActiveRow(view, 1)
          break
        case 'moveColumnLeft':
          this.moveActiveColumn(view, -1)
          break
        case 'moveColumnRight':
          this.moveActiveColumn(view, 1)
          break
        case 'sortAscending':
          this.sortRowsByActiveColumn(view, 1)
          break
        case 'sortDescending':
          this.sortRowsByActiveColumn(view, -1)
          break
        case 'alignLeft':
          this.editor.action(callCommand(setAlignCommand.key, 'left'))
          break
        case 'alignCenter':
          this.editor.action(callCommand(setAlignCommand.key, 'center'))
          break
        case 'alignRight':
          this.editor.action(callCommand(setAlignCommand.key, 'right'))
          break
        // GFM has no width syntax. These are deliberately local display
        // preferences, alongside the drag handles from columnResizingPlugin;
        // they never enter the Markdown document or its save transaction.
        case 'fitColumns':
          if (this.#activeTable !== undefined) this.#activeTable.style.tableLayout = 'auto'
          break
        case 'equalColumns':
          if (this.#activeTable !== undefined) this.#activeTable.style.tableLayout = 'fixed'
          break
        case 'deleteTable':
          deleteTable(view.state, view.dispatch.bind(view))
          if (this.#tableControls !== undefined) this.#tableControls.hidden = true
          this.#tableControlsOpen = false
          this.#activeTable = undefined
          break
        default:
          return
      }
      view.focus()
      requestAnimationFrame(() => this.refreshTableControls(view))
    })
  }

  private blockAtY(view: EditorView, y: number): HTMLElement | undefined {
    const blocks = Array.from(view.dom.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    )
    return blocks.find((block) => {
      const rect = block.getBoundingClientRect()
      return y >= rect.top && y <= rect.bottom
    })
  }

  /** `posAtDOM` in a text block points inside it; moves need its top-level edge. */
  private topLevelPosition(view: EditorView, block: HTMLElement): number {
    const position = view.posAtDOM(block, 0)
    const resolved = view.state.doc.resolve(position)
    return resolved.depth > 0 ? resolved.before(1) : position
  }

  private moveCurrentBlock(direction: 'up' | 'down'): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const source = view.state.selection.$from.depth > 0
        ? view.state.selection.$from.before(1)
        : view.state.selection.from
      let previous: number | undefined
      let next: number | undefined
      let afterSource = false
      view.state.doc.forEach((_node, offset) => {
        if (offset === source) {
          afterSource = true
          return
        }
        if (!afterSource) previous = offset
        else if (next === undefined) next = offset
      })
      const target = direction === 'up' ? previous : next
      if (target === undefined) return
      this.moveBlock(view, source, target, direction === 'up')
    })
  }

  private moveBlock(view: EditorView, source: number, target: number, insertBefore: boolean): void {
    if (source === target) return
    const sourceNode = view.state.doc.nodeAt(source)
    const targetNode = view.state.doc.nodeAt(target)
    if (sourceNode === null || targetNode === null) return
    const requestedPosition = insertBefore ? target : target + targetNode.nodeSize
    const transaction = view.state.tr.delete(source, source + sourceNode.nodeSize)
    const insertionPosition = transaction.mapping.map(
      requestedPosition,
      source < requestedPosition ? -1 : 1,
    )
    view.dispatch(transaction.insert(insertionPosition, sourceNode).scrollIntoView())
  }

  /** Replaces the current selection with one portable atomic inline node. */
  private insertInlineAtom(nodeName: string, attribute: string, fallback: string): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const type = view.state.schema.nodes[nodeName]
      if (type === undefined) return
      const { from, to } = view.state.selection
      const selected = view.state.doc.textBetween(from, to, ' ').trim()
      const value = selected === '' ? fallback : selected
      const transaction = view.state.tr.replaceSelectionWith(type.create({ [attribute]: value }))
      view.dispatch(transaction.scrollIntoView())
      view.focus()
    })
  }

  /** Inserts `[^n]` and its editable, standard Markdown definition together. */
  private insertFootnote(): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const reference = footnoteReferenceSchema.type(ctx)
      const definition = footnoteDefinitionSchema.type(ctx)
      const paragraph = view.state.schema.nodes['paragraph']
      if (paragraph === undefined) return

      const labels = new Set<string>()
      view.state.doc.descendants((node) => {
        if (node.type === reference || node.type === definition) labels.add(String(node.attrs['label'] ?? ''))
      })
      let number = 1
      while (labels.has(String(number))) number += 1
      const label = String(number)
      const { from, to } = view.state.selection
      const selected = view.state.doc.textBetween(from, to, ' ').trim()
      const body = selected === '' ? 'Footnote' : selected

      let transaction = view.state.tr.replaceSelectionWith(reference.create({ label }))
      const definitionNode = definition.create(
        { label },
        paragraph.create(undefined, view.state.schema.text(body)),
      )
      transaction = transaction.insert(transaction.doc.content.size, definitionNode)
      view.dispatch(transaction.scrollIntoView())
      view.focus()
    })
  }

  /** A selected formula becomes a rendered `$$` display block. */
  private insertMathBlock(): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const type = mathBlockSchema.type(ctx)
      const { from, to } = view.state.selection
      const selected = view.state.doc.textBetween(from, to, '\n').trim()
      const source = selected === '' ? 'x = y' : selected
      const node = type.create({ language: 'math' }, view.state.schema.text(source))
      view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
      view.focus()
    })
  }

  /** Stores a note link as `[[target]]`; the renderer resolves it as `target.md`. */
  private insertWikiLink(): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const type = wikiLinkSchema.type(ctx)
      const { from, to } = view.state.selection
      const selected = view.state.doc.textBetween(from, to, ' ').trim()
      const label = selected === '' ? 'New Note' : selected
      const target = label.replace(/\.md$/iu, '')
      view.dispatch(view.state.tr.replaceSelectionWith(type.create({ target, label })).scrollIntoView())
      view.focus()
    })
  }

  /** A deliberate link correction path: selection creates, replaces, or removes. */
  private editLink(): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { from, to } = view.state.selection
      if (from === to) {
        window.alert('Select text first, then choose Link.')
        return
      }

      const href = window.prompt('Link address (leave blank to remove the link)', '')
      if (href === null) return
      if (href.trim() === '') {
        const link = view.state.schema.marks['link']
        if (link !== undefined) view.dispatch(view.state.tr.removeMark(from, to, link))
        return
      }
      this.editor.action(callCommand(toggleLinkCommand.key, { href: href.trim() }))
    })
  }

  /**
   * Converts the current block to a diagram (DESIGN.md §4.3).
   *
   * > "Convert to diagram" is always available as a slash command and
   * > context-menu action on any code block or paragraph — so a missed
   * > conversion is one command away, not a re-paste.
   *
   * Uses the same recognition rules and the same validation gate as the paste
   * sniffer: the block must look like a diagram *and* actually render, or
   * nothing changes and the caller is told why.
   */
  async convertBlockToDiagram(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const found = this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { $from } = view.state.selection
      // The textblock containing the caret — $from.parent, not a walk up to the
      // doc. Walking found the document node and handed Mermaid the entire
      // note, which then failed to parse for a completely misleading reason.
      const node = $from.parent
      if (!node.isTextblock) return null
      return { view, node, pos: $from.before($from.depth) }
    })

    if (found === null) return { ok: false, reason: 'Put the cursor in a paragraph first' }

    // Hard breaks are line breaks to a diagram engine. node.textContent drops
    // them, which turns multi-line Mermaid into one unparseable line.
    let source = ''
    found.node.forEach((child) => {
      source += child.type.name === 'hardbreak' || child.type.isText === false ? '\n' : child.text
    })
    source = source.trim()
    if (source === '') return { ok: false, reason: 'The block is empty' }

    const language = looksLikeSvg(source) ? 'svg' : looksLikeMermaid(source) ? 'mermaid' : null
    if (language === null) {
      return { ok: false, reason: 'This block does not look like Mermaid or SVG' }
    }

    // Same validation gate as the paste sniffer: never guess silently wrong.
    // A renderer that rejects outright — a crash rather than a parse failure —
    // is a refusal like any other, not an exception for the caller to drop on
    // the floor: §4.4 rule 3 wants the reason said out loud either way.
    let rendered
    try {
      rendered = await this.renderer.render(language, source)
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
    if (!rendered.ok) return { ok: false, reason: rendered.message }

    const { view, node, pos } = found
    const { schema } = view.state
    const codeBlock = schema.nodes['code_block']
    if (codeBlock === undefined) return { ok: false, reason: 'No code block in the schema' }

    view.dispatch(
      view.state.tr.replaceWith(
        pos,
        pos + node.nodeSize,
        codeBlock.create({ language }, schema.text(source)),
      ),
    )
    return { ok: true }
  }

  /**
   * Toggles the current list item between task and plain.
   *
   * GFM has no toggle command: a task item is an ordinary list item carrying
   * `checked`, so the list is created first if needed and the attribute is set
   * directly. Done as one transaction so a single undo reverses the whole
   * gesture rather than leaving a half-converted list.
   */
  private toggleTaskList(): void {
    // Three sequential top-level actions, never nested. An earlier version
    // called editor.action() from inside another and then recursed, so the
    // inner call read a stale view.state and the toggle raced its own list
    // creation — intermittently doing nothing.
    const listItemDepth = (): number =>
      this.editor.action((ctx) => {
        const { $from } = ctx.get(editorViewCtx).state.selection
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type.name === 'list_item') return depth
        }
        return -1
      })

    if (listItemDepth() === -1) {
      this.editor.action(callCommand(wrapInBulletListCommand.key))
    }

    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { $from } = view.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth)
        if (node.type.name !== 'list_item') continue
        const checked = node.attrs['checked']
        view.dispatch(
          view.state.tr.setNodeMarkup($from.before(depth), undefined, {
            ...node.attrs,
            // null means "not a task"; false means "an unchecked task".
            checked: checked === null || checked === undefined ? false : null,
          }),
        )
        return
      }
    })
  }

  /**
   * Lifts the current list item out of every enclosing list, regardless of
   * nesting depth, leaving a plain paragraph. `liftListItemCommand` (also
   * used by Outdent) only lifts one level per call — this keeps calling it
   * until the selection is no longer inside a list_item at all, which is
   * what Outdent alone does not do for nested items.
   */
  private liftListItemToParagraph(): void {
    const inListItem = (): boolean =>
      this.editor.action((ctx) => {
        const { $from } = ctx.get(editorViewCtx).state.selection
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type.name === 'list_item') return true
        }
        return false
      })

    // A safety bound, not a meaningful limit: guards against looping forever
    // if a malformed document keeps reporting "still in a list_item".
    for (let guard = 0; guard < 50 && inListItem(); guard += 1) {
      const lifted = this.editor.action(callCommand(liftListItemCommand.key))
      if (!lifted) break
    }
  }

  /** Applies a persistent highlight colour using readable `=={colour}text==` source. */
  private setHighlight(color: HighlightColour): void {
    if (!HIGHLIGHT_COLOURS.includes(color)) return
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const command = toggleMark(highlightSchema.type(ctx), { color })
      command(view.state, view.dispatch)
      view.focus()
    })
  }

  /** Changes the task under the caret; outside a task this deliberately does nothing. */
  private setTaskState(state: boolean | 'toggle'): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { $from } = view.state.selection
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth)
        if (node.type.name !== 'list_item' || node.attrs['checked'] == null) continue
        const checked = state === 'toggle' ? !Boolean(node.attrs['checked']) : state
        view.dispatch(view.state.tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, checked }))
        view.focus()
        return
      }
    })
  }

  /** Stable-partitions the current task list so unfinished work remains first. */
  private moveCompletedTasks(): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const candidates: Array<{ node: ProseNode; pos: number }> = []
      view.state.doc.descendants((node, pos) => {
        if (!['bullet_list', 'ordered_list'].includes(node.type.name)) return
        const hasTasks = node.content.content.some((item) => item.attrs['checked'] != null)
        if (hasTasks) candidates.push({ node, pos })
      })
      const selection = view.state.selection.from
      const active = candidates.filter(({ node, pos }) => selection >= pos && selection <= pos + node.nodeSize).at(-1)
        ?? (candidates.length === 1 ? candidates[0] : undefined)
      if (active === undefined) return
      const items: ProseNode[] = []
      active.node.forEach((item) => items.push(item))
      const ordered = [
        ...items.filter((item) => item.attrs['checked'] !== true),
        ...items.filter((item) => item.attrs['checked'] === true),
      ]
      if (ordered.every((item, index) => item === items[index])) return
      const replacement = active.node.copy(Fragment.fromArray(ordered))
      const transaction = view.state.tr.replaceWith(
        active.pos,
        active.pos + active.node.nodeSize,
        replacement,
      )
      view.dispatch(transaction.setSelection(Selection.near(transaction.doc.resolve(active.pos + 2))))
      view.focus()
    })
  }

  /** Changes selected text without discarding the marks carried by each text node. */
  private transformSelectedText(mode: 'uppercase' | 'lowercase' | 'titleCase'): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { from, to, empty } = view.state.selection
      if (empty) return
      const replacements: Array<{ from: number; to: number; text: string; marks: ProseNode['marks'] }> = []
      let atWordStart = true
      let lastTextEnd = from
      view.state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText || node.text === undefined) return
        const start = Math.max(from, pos)
        const end = Math.min(to, pos + node.nodeSize)
        if (start >= end) return
        if (start > lastTextEnd) atWordStart = true
        const selected = node.text.slice(start - pos, end - pos)
        let text: string
        if (mode === 'uppercase') text = selected.toLocaleUpperCase()
        else if (mode === 'lowercase') text = selected.toLocaleLowerCase()
        else {
          text = [...selected].map((character) => {
            const isWord = /[\p{L}\p{N}]/u.test(character)
            const transformed = isWord
              ? (atWordStart ? character.toLocaleUpperCase() : character.toLocaleLowerCase())
              : character
            atWordStart = !isWord
            return transformed
          }).join('')
        }
        replacements.push({ from: start, to: end, text, marks: node.marks })
        lastTextEnd = end
      })
      if (replacements.length === 0) return
      const transaction = view.state.tr
      for (const replacement of replacements.reverse()) {
        transaction.replaceWith(
          replacement.from,
          replacement.to,
          view.state.schema.text(replacement.text, replacement.marks),
        )
      }
      const transformedTo = to + replacements.reduce(
        (delta, replacement) => delta + replacement.text.length - (replacement.to - replacement.from),
        0,
      )
      view.dispatch(transaction.setSelection(TextSelection.create(transaction.doc, from, transformedTo)).scrollIntoView())
      view.focus()
    })
  }

  /** Inserts local wall-clock text. The value is ordinary Markdown, never live metadata. */
  private insertLocalDate(format: 'numeric' | 'long' | 'dateTime'): void {
    const now = new Date()
    const year = String(now.getFullYear()).padStart(4, '0')
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const numeric = `${year}-${month}-${day}`
    const text = format === 'numeric'
      ? numeric
      : format === 'long'
        ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(now)
        : `${numeric} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.insertText(text).scrollIntoView())
      view.focus()
    })
  }

  /** Wraps the current top-level block in a GitHub-compatible callout, or rethemes an existing one. */
  private setCallout(calloutType: 'note' | 'tip' | 'important' | 'warning' | 'caution'): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { $from } = view.state.selection
      if ($from.depth < 1) return
      const node = $from.node(1)
      const from = $from.before(1)
      const type = calloutSchema.type(ctx)
      const replacement = node.type === type
        ? type.create({ ...node.attrs, calloutType }, node.content, node.marks)
        : type.create({ calloutType }, Fragment.from(node))
      const transaction = view.state.tr.replaceWith(from, from + node.nodeSize, replacement)
      view.dispatch(transaction.setSelection(Selection.near(transaction.doc.resolve(from + 2))))
      view.focus()
    })
  }

  /**
   * The document's headings, for the temporary contents popover (EDITOR-3).
   *
   * Read from the live ProseMirror document, not the DOM: a folded section's
   * headings are display-none but still part of the document, and the contents
   * list must be able to navigate to them.
   */
  outline(): ReadonlyArray<{ level: number; text: string; pos: number }> {
    return this.editor.action((ctx) => {
      const doc = ctx.get(editorViewCtx).state.doc
      const entries: Array<{ level: number; text: string; pos: number }> = []
      doc.forEach((child, offset) => {
        if (child.type.name === 'heading') {
          entries.push({
            level: child.attrs['level'] as number,
            text: child.textContent,
            pos: offset,
          })
        }
      })
      return entries
    })
  }

  /**
   * Moves the caret to a heading and scrolls it into view, unfolding whatever
   * hides it first — navigating to an invisible place is not navigation.
   */
  navigateToHeading(pos: number): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const heading = view.state.doc.nodeAt(pos)
      if (heading === null || heading.type.name !== 'heading') return
      view.dispatch(view.state.tr.setMeta(foldingKey, { reveal: pos }))
      view.dispatch(
        view.state.tr.setSelection(Selection.near(view.state.doc.resolve(pos + 1))).scrollIntoView(),
      )
      view.focus()
    })
  }

  /**
   * Sets or clears the in-document find query (EDITOR-7).
   *
   * Returns the resulting match count and active index so the overlay can
   * paint "2 of 14" without holding any document state of its own.
   */
  setFindQuery(query: string): { count: number; active: number } {
    return this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setMeta(findKey, { query }))
      const found = findKey.getState(view.state) as FindState
      if (found.active >= 0) this.revealAndScrollTo(found.matches[found.active]!.from)
      return { count: found.matches.length, active: found.active }
    })
  }

  /** Moves to the next or previous match, unfolding whatever hides it. */
  findStep(direction: 1 | -1): { count: number; active: number } {
    return this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setMeta(findKey, { step: direction }))
      const found = findKey.getState(view.state) as FindState
      if (found.active >= 0) this.revealAndScrollTo(found.matches[found.active]!.from)
      return { count: found.matches.length, active: found.active }
    })
  }

  /**
   * Scrolls a document position into view, revealing folds first — a match
   * inside a folded section must become visible, not be "navigated to" while
   * display:none (the same rule contents navigation follows).
   */
  private revealAndScrollTo(pos: number): void {
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setMeta(foldingKey, { reveal: pos }))
      const dom = view.domAtPos(Math.min(pos, view.state.doc.content.size)).node
      const element = dom instanceof HTMLElement ? dom : dom.parentElement
      element?.scrollIntoView({ block: 'center' })
    })
  }

  /**
   * Serialises the current document to Markdown through the bridge under test.
   *
   * This is the exact path the fidelity spike measures, which is why it is
   * product API rather than something the harness reimplements — a harness with
   * its own serialiser would prove nothing about the real one.
   */
  serialize(): string {
    return this.editor.action(getMarkdown())
  }

  /**
   * Delivers any edit the debounced change listener has not handed over yet.
   *
   * Milkdown's listener plugin debounces `markdownUpdated` by 200ms, so between
   * the last keystroke and that timer the session still holds the previous
   * document. Every path that turns the session into bytes — Save, autosave,
   * closing a note, switching notes — has to close that gap first, or it writes
   * the document as it was a moment ago and then reports success.
   *
   * Cheap to call when nothing is pending: the serialised document matches what
   * was last emitted, so no transaction is raised and the document stays clean.
   */
  flushPendingChanges(): void {
    this.emitMarkdown(this.editor.action(getMarkdown()))
  }

  /**
   * The current selection as Markdown — the whole containing block when the
   * caret is collapsed.
   *
   * Collapsed-means-block is deliberate: "Copy as Markdown" with the caret
   * resting in a table or a fence should give you that table or that fence,
   * which is the thing a reader means by "this". Requiring a manual selection
   * first would make the useful cases the fiddliest ones.
   */
  selectionMarkdown(): string {
    return this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const serializer = ctx.get(serializerCtx)
      const { state } = view
      const content = state.selection.empty
        ? blockAround(state.selection.$from)
        : state.doc.slice(state.selection.from, state.selection.to).content
      return serializer(state.schema.topNodeType.create(null, content)).trim()
    })
  }

  /**
   * Captures what a context-menu export means before WebKit starts tracking.
   *
   * macOS selects the word beneath a right-click while its native menu is
   * open. That visual selection must not turn "Copy Table" into "copy this
   * word", so an existing selection is kept when the click lands inside it;
   * otherwise the top-level block beneath the pointer is captured.
   */
  contextSelection(target: Node | null): { readonly markdown: string; readonly html: string } {
    return this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const serializer = ctx.get(serializerCtx)
      const { state } = view
      let content = state.selection.empty
        ? blockAround(state.selection.$from)
        : state.doc.slice(state.selection.from, state.selection.to).content

      if (target !== null && view.dom.contains(target)) {
        try {
          const pos = view.posAtDOM(target, 0)
          const insideExistingSelection =
            !state.selection.empty && pos >= state.selection.from && pos <= state.selection.to
          if (!insideExistingSelection) content = blockAround(state.doc.resolve(pos))
        } catch {
          // A transient NodeView may disappear between pointermove and this
          // capture. The current editor selection is still the honest fallback.
        }
      }

      const fragment = DOMSerializer.fromSchema(state.schema).serializeFragment(content)
      const host = document.createElement('div')
      host.append(fragment)
      return {
        markdown: serializer(state.schema.topNodeType.create(null, content)).trim(),
        html: host.innerHTML,
      }
    })
  }

  /**
   * Replaces the selection with literal text, deliberately unparsed.
   *
   * This is the whole point of Paste as Plain Text: the ordinary paste path
   * runs the §4.2 sniffers and the Markdown parser, and sometimes you want the
   * characters and nothing else. Newlines become hard breaks so a multi-line
   * paste stays one block rather than silently becoming several.
   */
  insertPlainText(text: string): void {
    if (text === '') return
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { schema } = view.state
      const parts = text.split('\n')
      const nodes: ProseNode[] = []
      parts.forEach((part, index) => {
        if (part !== '') nodes.push(schema.text(part))
        if (index < parts.length - 1 && schema.nodes['hardbreak'] !== undefined) {
          nodes.push(schema.nodes['hardbreak'].create())
        }
      })
      if (nodes.length === 0) return
      view.dispatch(
        view.state.tr.replaceSelectionWith(schema.nodes['paragraph']!.create(null, nodes), false)
          .scrollIntoView(),
      )
      view.focus()
    })
  }

  /** The same selection as rendered HTML, for hosts that accept rich text. */
  selectionHtml(): string {
    return this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { state } = view
      const content = state.selection.empty
        ? blockAround(state.selection.$from)
        : state.doc.slice(state.selection.from, state.selection.to).content
      const fragment = DOMSerializer.fromSchema(state.schema).serializeFragment(content)
      const host = document.createElement('div')
      host.append(fragment)
      return host.innerHTML
    })
  }

  async destroy(): Promise<void> {
    // The editor root is replaced when a reader opens another file. Table
    // controls deliberately live above that root so they can sit beside the
    // table; remove that one detached element with the editor itself.
    this.#tableControls?.remove()
    this.#tableControls = undefined
    this.#tableControlsOpen = false
    this.#activeTable = undefined
    this.#activeTableCell = undefined
    await this.editor.destroy()
  }
}


/** The top-level block a position sits inside, as a fragment. */
function blockAround($pos: ResolvedPos): Fragment {
  const node = $pos.node($pos.depth > 0 ? 1 : 0)
  return node.type.name === 'doc' ? node.content : Fragment.from(node)
}
