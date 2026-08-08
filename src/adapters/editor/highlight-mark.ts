import { markRule } from '@milkdown/kit/prose'
import { toggleMark } from '@milkdown/kit/prose/commands'
import { $command, $inputRule, $markSchema, $remark } from '@milkdown/kit/utils'
import { splice } from 'micromark-util-chunked'
import { classifyCharacter } from 'micromark-util-classify-character'
import { resolveAll } from 'micromark-util-resolve-all'
import { codes, constants, types } from 'micromark-util-symbol'
import type {
  Code,
  Effects,
  Event,
  Extension,
  State,
  Token,
  TokenizeContext,
} from 'micromark-util-types'
import type { ConstructName, Info, State as MarkdownState } from 'mdast-util-to-markdown'
import type {
  CompileContext,
  Extension as FromMarkdownExtension,
} from 'mdast-util-from-markdown'
import type { Parent, PhrasingContent } from 'mdast'
import type { Processor } from 'unified'
import { visit } from 'unist-util-visit'

export const HIGHLIGHT_COLOURS = ['default', 'green', 'red', 'blue', 'yellow', 'purple'] as const
export type HighlightColour = (typeof HIGHLIGHT_COLOURS)[number]

declare module 'mdast' {
  interface Highlight extends Omit<Parent, 'children'> {
    type: 'highlight'
    color?: HighlightColour
    children: PhrasingContent[]
  }

  interface PhrasingContentMap {
    highlight: Highlight
  }
}

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    highlight: 'highlight'
    highlightSequence: 'highlightSequence'
    highlightSequenceTemporary: 'highlightSequenceTemporary'
    highlightText: 'highlightText'
  }
}

const temporarySequence = 'highlightSequenceTemporary'
const sequence = 'highlightSequence'
const highlight = 'highlight'
const highlightText = 'highlightText'

/**
 * Portable `==highlight==` support.
 *
 * CommonMark does not define highlight, but this tiny extension uses the
 * broadly understood `==text==` convention and preserves it as plain text in
 * readers that do not render it. Keeping the parser and serializer together is
 * important: a toolbar mark that disappears after reopen is worse than no mark.
 */
function highlightSyntax(): Extension {
  const tokenizer = { tokenize: tokenizeHighlight, resolveAll: resolveAllHighlight }
  return {
    text: { [codes.equalsTo]: tokenizer },
    insideSpan: { null: [tokenizer] },
    attentionMarkers: { null: [codes.equalsTo] },
  }
}

function resolveAllHighlight(events: Event[], context: TokenizeContext): Event[] {
  for (let index = 0; index < events.length; index += 1) {
    const current = events[index]!
    if (current[0] !== 'enter' || current[1].type !== temporarySequence || !current[1]._close) continue

    for (let open = index - 1; open >= 0; open -= 1) {
      const candidate = events[open]!
      if (
        candidate[0] !== 'exit' ||
        candidate[1].type !== temporarySequence ||
        !candidate[1]._open ||
        current[1].end.offset - current[1].start.offset !==
          candidate[1].end.offset - candidate[1].start.offset
      ) {
        continue
      }

      current[1].type = sequence
      candidate[1].type = sequence
      const mark: Token = {
        type: highlight,
        start: { ...candidate[1].start },
        end: { ...current[1].end },
      }
      const content: Token = {
        type: highlightText,
        start: { ...candidate[1].end },
        end: { ...current[1].start },
      }
      const replacement: Event[] = [
        ['enter', mark, context],
        ['enter', candidate[1], context],
        ['exit', candidate[1], context],
        ['enter', content, context],
      ]
      const insideSpan = context.parser.constructs.insideSpan.null
      if (insideSpan !== undefined) {
        splice(replacement, replacement.length, 0, resolveAll(insideSpan, events.slice(open + 1, index), context))
      }
      splice(replacement, replacement.length, 0, [
        ['exit', content, context],
        ['enter', current[1], context],
        ['exit', current[1], context],
        ['exit', mark, context],
      ])
      splice(events, open - 1, index - open + 3, replacement)
      index = open + replacement.length - 2
      break
    }
  }

  for (const event of events) {
    if (event[1].type === temporarySequence) event[1].type = types.data
  }
  return events
}

function tokenizeHighlight(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  const previous = this.previous
  const events = this.events
  let size = 0

  return start

  function start(code: Code): State {
    if (code !== codes.equalsTo || (previous === codes.equalsTo && events.at(-1)?.[1].type !== types.characterEscape)) {
      return nok(code)!
    }
    effects.enter(temporarySequence)
    return more(code)
  }

  function more(code: Code): State {
    const before = classifyCharacter(previous)
    if (code === codes.equalsTo) {
      if (size > 1) return nok(code)!
      effects.consume(code)
      size += 1
      return more
    }
    if (size < 2) return nok(code)!
    const token = effects.exit(temporarySequence)
    const after = classifyCharacter(code)
    token._open = !after || (after === constants.attentionSideAfter && Boolean(before))
    token._close = !before || (before === constants.attentionSideAfter && Boolean(after))
    return ok(code)!
  }
}

const fromMarkdown: FromMarkdownExtension = {
  canContainEols: [highlight as never],
  enter: {
    [highlight](this: CompileContext, token: Token) {
      this.enter({ type: highlight, children: [] } as never, token)
    },
  },
  exit: {
    [highlight](this: CompileContext, token: Token) {
      this.exit(token)
    },
  },
}

const withoutHighlight: ConstructName[] = [
  'autolink',
  'destinationLiteral',
  'destinationRaw',
  'reference',
  'titleQuote',
  'titleApostrophe',
]

function serializeHighlight(
  node: { children: unknown[]; color?: HighlightColour },
  _: Parent,
  state: MarkdownState,
  info: Info,
): string {
  const tracker = state.createTracker(info)
  const exit = state.enter(highlight as never)
  const color = HIGHLIGHT_COLOURS.includes(node.color ?? 'default') ? (node.color ?? 'default') : 'default'
  let value = tracker.move(color === 'default' ? '==' : `=={${color}}`)
  value += tracker.move(
    state.containerPhrasing(node as never, {
      before: value,
      after: '=',
      ...tracker.current(),
    }),
  )
  value += tracker.move('==')
  exit()
  return value
}

function highlightRemarkPlugin(this: Processor): ((tree: Parent) => void) {
  const data = this.data() as Record<string, unknown>
  const add = (field: string, value: unknown): void => {
    const existing = data[field]
    data[field] = Array.isArray(existing) ? [...existing, value] : [value]
  }
  add('micromarkExtensions', highlightSyntax())
  add('fromMarkdownExtensions', fromMarkdown)
  add('toMarkdownExtensions', {
    unsafe: [{ character: '=', inConstruct: 'phrasing', notInConstruct: withoutHighlight }],
    handlers: { [highlight]: serializeHighlight } as never,
  })
  return (tree) => {
    visit(tree, highlight, (node: { children?: PhrasingContent[]; color?: HighlightColour }) => {
      const first = node.children?.[0]
      if (first?.type !== 'text') return
      const match = /^\{(green|red|blue|yellow|purple)\}/.exec(first.value)
      if (match === null) return
      node.color = match[1] as HighlightColour
      first.value = first.value.slice(match[0].length)
      if (first.value === '') node.children?.shift()
    })
  }
}

export const highlightRemark = $remark('simplemarkHighlightRemark', () => highlightRemarkPlugin)

export const highlightSchema = $markSchema('highlight', () => ({
  attrs: { color: { default: 'default' } },
  parseDOM: [{
    tag: 'mark',
    getAttrs: (dom) => ({ color: (dom as HTMLElement).dataset['highlightColor'] ?? 'default' }),
  }],
  toDOM: (mark) => ['mark', { 'data-highlight-color': mark.attrs['color'] ?? 'default' }, 0],
  parseMarkdown: {
    match: (node) => node.type === highlight,
    runner: (state, node, markType) => {
      state.openMark(markType, { color: (node as { color?: HighlightColour }).color ?? 'default' })
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === highlight,
    runner: (state, mark) => {
      state.withMark(mark, highlight, undefined, { color: mark.attrs['color'] ?? 'default' })
    },
  },
}))

export const toggleHighlightCommand = $command('ToggleHighlight', (ctx) => () =>
  toggleMark(highlightSchema.type(ctx)),
)

export const highlightInputRule = $inputRule((ctx) =>
  markRule(/(?<![\w])==(.+?)==$/, highlightSchema.type(ctx)),
)
