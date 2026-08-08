import { parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { closeHistory } from '@milkdown/kit/prose/history'
import { DOMParser as ProseDOMParser, Slice } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

import {
  htmlCarriesDocumentStructure,
  isStandaloneBlockPaste,
  looksLikeAnsi,
  looksLikeDiff,
  looksLikeFileTree,
  looksLikeJson,
  looksLikeDot,
  looksLikeVegaLite,
  looksLikeMath,
  looksLikeMermaid,
  looksLikeStackTrace,
  looksLikeSvg,
  looksLikeTsv,
  stripMathDelimiters,
  svgInHtml,
  svgToCodeFenceHtml,
  tsvToMarkdownTable,
} from '../../domain/index.js'
import type { DiagramRenderer, NoteImageStore } from '../../application/index.js'
import { captureRemoteImages, remoteImageSources } from './image-capture.js'
import { looksLikeFullPagePaste } from './page-trim.js'
import { offerPageTrim } from './page-trim-offer.js'

/**
 * The DESIGN.md §4 paste pipeline.
 *
 * "The defining behavior: you paste raw Mermaid source or a raw `<svg>` tag with
 * no code fence, and it becomes a picture. No mode switch, no menu, no plugin
 * install."
 *
 * ```
 * ⌘V
 *  ├─ 1. Clipboard triage        collect {text, html}
 *  ├─ 2. Sniffer chain           svg-in-html · svg · mermaid
 *  │      first to MATCH, VALIDATE and pass the standalone-block test wins
 *  ├─ 3. No hit → Markdown path (§4.2 ruling: text/plain, not the HTML)
 *  └─ 4. Insert → NodeViews render; ⌘Z restores the raw pasted text
 * ```
 *
 * Validation is asynchronous — `mermaid.parse()` returns a promise — but
 * `handlePaste` must answer synchronously. So a signature hit claims the event
 * immediately and the real decision happens a tick later. That ordering is what
 * lets §4.4 hold: conversion still *requires* a successful parse, and a payload
 * that fails validation falls back to the ordinary Markdown path rather than
 * producing a broken block.
 */

export const pasteSnifferKey = new PluginKey('simplemark-paste-sniffers')

/** §4.2 fixed priority order. Image (5) arrives with attachment support. */
interface Sniffer {
  readonly id: string
  readonly priority: number
  /** Returns the diagram language and source to convert to, or null to decline. */
  claim(text: string, html: string): { language: string; source: string } | null
}

const SNIFFERS: readonly Sniffer[] = [
  {
    id: 'svg-in-html',
    priority: 30,
    claim: (_text: string, html: string) => {
      // A document that contains a chart is not a chart. Claiming it replaced
      // the whole paste with its one <svg> and threw the rest away — the same
      // fault BUG-5 fixed in the exhaust tier, which this sniffer never got.
      if (htmlCarriesDocumentStructure(html)) return null
      const svg = svgInHtml(html)
      return svg === null ? null : { language: 'svg', source: svg }
    },
  },
  {
    id: 'svg',
    priority: 20,
    claim: (text: string) => (looksLikeSvg(text) ? { language: 'svg', source: text.trim() } : null),
  },
  // Formal notation. DOT outranks Mermaid because `graph {` matches both
  // keywords and the brace is the more specific claim; math sits beside them
  // because `$$` collides with nothing else.
  {
    id: 'dot',
    priority: 11,
    claim: (text: string) => (looksLikeDot(text) ? { language: 'dot', source: text.trim() } : null),
  },
  {
    id: 'math',
    priority: 9,
    claim: (text: string) =>
      looksLikeMath(text) ? { language: 'math', source: stripMathDelimiters(text) } : null,
  },
  {
    id: 'mermaid',
    priority: 10,
    claim: (text: string) => (looksLikeMermaid(text) ? { language: 'mermaid', source: text.trim() } : null),
  },
  // The paste-exhaust tier: the output formats of AI and terminal work.
  // ANSI outranks diff because coloured git output carries both signatures,
  // and the escape codes are the more specific claim.
  {
    id: 'ansi',
    priority: 19,
    claim: (text: string) => (looksLikeAnsi(text) ? { language: 'ansi', source: text } : null),
  },
  {
    id: 'diff',
    priority: 18,
    claim: (text: string) => (looksLikeDiff(text) ? { language: 'diff', source: text } : null),
  },
  {
    id: 'file-tree',
    priority: 14,
    claim: (text: string) => (looksLikeFileTree(text) ? { language: 'tree', source: text } : null),
  },
  {
    id: 'stack-trace',
    priority: 12,
    claim: (text: string) =>
      looksLikeStackTrace(text) ? { language: 'stacktrace', source: text } : null,
  },
  // A chart spec is JSON that says so. It has to outrank the generic JSON
  // sniffer, or every pasted chart would land as a collapsible object dump.
  {
    id: 'vega-lite',
    priority: 8,
    claim: (text: string) =>
      looksLikeVegaLite(text) ? { language: 'vega-lite', source: text.trim() } : null,
  },
  // Last: anything both parseable as JSON and claimed by a more specific
  // sniffer should never reach here.
  {
    id: 'json',
    priority: 7,
    claim: (text: string) => (looksLikeJson(text) ? { language: 'json', source: text.trim() } : null),
  },
].sort((a, b) => b.priority - a.priority)

/**
 * §4.2 step 2: the first sniffer to claim the paste, in priority order.
 *
 * Exported so the ordering is testable on its own. The chain is the part that
 * decides between two sniffers that both match — which is where the wrong
 * answer would be silent rather than visible.
 */
export function claimPaste(
  text: string,
  html: string,
): { language: string; source: string } | null {
  return SNIFFERS.map((sniffer) => sniffer.claim(text, html)).find((result) => result !== null) ?? null
}

export interface PasteSnifferOptions {
  readonly renderer: DiagramRenderer
  /** Absent in hosts that cannot keep images beside the note. */
  readonly images?: NoteImageStore
}

export const pasteSniffers = (options: PasteSnifferOptions) =>
  $prose((ctx: Ctx) => {
    /**
     * Replaces the current selection with the block that stores this language.
     *
     * Math gets its own node, which serialises to `$$…$$` — the portable
     * interchange form. Everything else stores as a fenced code block.
     */
    const insertFence = (view: EditorView, language: string, source: string): void => {
      const { schema } = view.state
      const target = language === 'math' ? schema.nodes['math_block'] : schema.nodes['code_block']
      const codeBlock = target ?? schema.nodes['code_block']
      if (codeBlock === undefined) return

      // Two transactions on purpose (§4.3): the first inserts the raw pasted
      // text, the second converts it. `closeHistory` stops prosemirror-history
      // from grouping them, so one ⌘Z lands on the raw text rather than
      // undoing the paste entirely.
      const raw = view.state.tr.replaceSelectionWith(
        schema.nodes['paragraph']!.create(null, schema.text(source)),
      )
      view.dispatch(raw)

      const to = view.state.selection.from
      const from = to - source.length - 1
      const convert = view.state.tr.replaceWith(
        Math.max(0, from),
        to,
        codeBlock.create({ language }, schema.text(source)),
      )
      view.dispatch(closeHistory(convert))
    }

    /** §4.2 step 3: no sniffer claimed it, so the Markdown path runs on text/plain. */
    const insertMarkdown = (view: EditorView, text: string): void => {
      // Deliberately total, dispatch included: this is the §4.4 fallback of
      // last resort. The async rejection path runs it with the paste event
      // already claimed and nothing left to fall back to, and the sync
      // callers claim the event on return either way — a throw could only
      // trade a lost paste for an unhandled error on top of it.
      try {
        const parsed = ctx.get(parserCtx)(text)
        if (parsed === null || parsed === undefined) return
        view.dispatch(view.state.tr.replaceSelection(new Slice(parsed.content, 0, 0)).scrollIntoView())
      } catch {
        return
      }
    }

    /**
     * §4.2 step 3, HTML flavour: a paste that is a document keeps being one.
     *
     * The old ruling flattened every paste to text/plain, so a report pasted
     * from a browser arrived with no bold, no links, no lists and no tables.
     * ProseMirror's own parser produces all of them; nothing here reimplements
     * it. The one thing it has no rule for is `<svg>`, which is why the source
     * is rewritten to a fence first — that is what keeps a chart in place
     * instead of dropping it.
     *
     * Returns whether it dispatched. §4.4: never lose the source — a schema
     * parse that throws must not claim the paste while inserting nothing, so
     * the caller falls back to the text path instead of trusting this blindly.
     */
    const insertHtml = (view: EditorView, html: string): boolean => {
      try {
        const dom = new window.DOMParser().parseFromString(svgToCodeFenceHtml(html), 'text/html')
        // The code_block schema's own parseDOM reads a `<pre data-language>` —
        // the shape its toDOM writes back out. svgToCodeFenceHtml marks the
        // language on the nested `<code class="language-svg">` instead, the
        // HTML convention every other tool uses. Without this bridge the fence
        // parses back with no language at all, so the renderer never claims it
        // and the chart lands as inert text instead of the picture it was.
        dom.body.querySelectorAll('pre > code').forEach((code) => {
          const language = /(?:^|\s)language-(\S+)/.exec(code.className)?.[1]
          if (language !== undefined) code.parentElement?.setAttribute('data-language', language)
        })
        const slice = ProseDOMParser.fromSchema(view.state.schema).parseSlice(dom.body)

        const from = view.state.selection.from
        let tr = view.state.tr.replaceSelection(slice).scrollIntoView()
        // A whole web page keeps its faithful shape and is offered a trim
        // (§4.2). The offer rides on the paste transaction so it appears with
        // the content rather than a frame later.
        if (looksLikeFullPagePaste(html)) {
          tr = offerPageTrim(tr, { from, to: tr.selection.from, html })
        }
        view.dispatch(tr)

        // Pictures follow the paste (ADR-0008). Sources are collected from what
        // was inserted, and each rewrite finds its own node again by src.
        const sources = remoteImageSources(slice.content)
        if (options.images !== undefined && sources.length > 0) {
          void captureRemoteImages(view, options.images, sources)
        }
        return true
      } catch {
        return false
      }
    }

    return new Plugin({
      key: pasteSnifferKey,
      props: {
        handlePaste: (view: EditorView, event: ClipboardEvent): boolean => {
          const clipboard = event.clipboardData
          if (clipboard === null) return false

          const text = clipboard.getData('text/plain')
          const html = clipboard.getData('text/html')
          if (text.trim() === '' && html.trim() === '') return false

          // Inside a code block the clipboard is literal by definition.
          const { $from, empty } = view.state.selection
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            if ($from.node(depth).type.spec.code === true) return false
          }

          // §4.2 condition 1. A selection replacement still counts as a block
          // boundary when the whole block is selected; a caret mid-sentence
          // does not.
          const atBlockBoundary =
            (empty && $from.parent.content.size === 0) ||
            (empty && $from.parentOffset === 0) ||
            !empty
          const standalone = isStandaloneBlockPaste({ text, atBlockBoundary })

          const claimed = standalone
            ? claimPaste(text, html)
            : null

          if (claimed === null) {
            // The Excel/Sheets clipboard is TSV in text/plain. It becomes a
            // real GFM table — content, not a card — so it goes through the
            // Markdown path rather than a renderer.
            if (standalone && looksLikeTsv(text)) {
              insertMarkdown(view, tsvToMarkdownTable(text))
              return true
            }
            // §4.2, revised: HTML that carries document structure is a
            // document. Flattening it to text/plain was what lost every mark,
            // link, list and table in a paste from a browser. A parse that
            // throws is not a claim (§4.4) — it falls through to the text
            // path below instead of swallowing the paste with nothing to show.
            if (htmlCarriesDocumentStructure(html) && insertHtml(view, html)) {
              return true
            }
            if (text.trim() === '') return false
            // No structure to keep: text/plain, parsed as Markdown (BUG-1).
            insertMarkdown(view, text)
            return true
          }

          // §4.2 condition 3: convert only if it actually validates.
          void options.renderer.render(claimed.language, claimed.source).then((result) => {
            if (result.ok) {
              insertFence(view, claimed.language, claimed.source)
            } else {
              // Never guess silently wrong (§4.4) — fall back to the text path.
              insertMarkdown(view, text)
            }
          }).catch(() => {
            // A renderer that rejects outright gets the same answer as one
            // that reports failure. The event is already claimed by the
            // `return true` below, so dropping the payload here would lose
            // the source (§4.4) — the paste would simply vanish. This also
            // backstops a throwing insertFence; if that ever failed between
            // its two transactions the raw text can land twice — §4.4
            // prefers duplicated source to lost source.
            insertMarkdown(view, text)
          })
          return true
        },
      },
    })
  })
