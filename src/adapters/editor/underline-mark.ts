import { toggleMark } from '@milkdown/kit/prose/commands'
import { $command, $markSchema, $remark } from '@milkdown/kit/utils'
import type { Html, Parent, PhrasingContent, Root } from 'mdast'
import type { Plugin, Processor } from 'unified'

declare module 'mdast' {
  interface Underline extends Omit<Parent, 'children'> {
    type: 'underline'
    children: PhrasingContent[]
  }

  interface PhrasingContentMap {
    underline: Underline
  }
}

interface ToMarkdownState {
  enter(name: string): () => void
  containerPhrasing(node: unknown, info: unknown): string
}

/**
 * Underline has no CommonMark delimiter. Raw `<u>…</u>` is the portable form:
 * Markdown readers that allow inline HTML render it, and readers that do not
 * still preserve the source instead of receiving an application-only mark.
 */
const underlineTransform: Plugin<[], Root> = () => (tree: Root) => {
  const transform = (parent: Parent): void => {
    for (const child of parent.children) {
      if ('children' in child && Array.isArray(child.children)) transform(child as Parent)
    }

    for (let index = 0; index < parent.children.length; index += 1) {
      const open = parent.children[index]
      if (open?.type !== 'html' || !/^<u(?:\s[^>]*)?>$/iu.test((open as Html).value.trim())) continue
      const close = parent.children.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex > index && candidate.type === 'html' && /^<\/u\s*>$/iu.test((candidate as Html).value.trim()),
      )
      if (close < 0) continue
      const children = parent.children.slice(index + 1, close) as PhrasingContent[]
      parent.children.splice(index, close - index + 1, {
        type: 'underline',
        children,
      } as unknown as typeof open)
    }
  }
  transform(tree)
}

function serializeUnderline(node: Parent, _parent: unknown, state: ToMarkdownState, info: unknown): string {
  const exit = state.enter('underline')
  const value = `<u>${state.containerPhrasing(node, info)}</u>`
  exit()
  return value
}

function underlineRemarkPlugin(this: Processor): void {
  const data = this.data() as Record<string, unknown>
  const existing = data['toMarkdownExtensions']
  const extension = { handlers: { underline: serializeUnderline } }
  data['toMarkdownExtensions'] = Array.isArray(existing) ? [...existing, extension] : [extension]
  return underlineTransform.call(this as never) as never
}

export const underlineRemark = $remark('simplemarkUnderlineRemark', () => underlineRemarkPlugin as never)

export const underlineSchema = $markSchema('underline', () => ({
  parseDOM: [{ tag: 'u' }],
  toDOM: () => ['u', 0] as const,
  parseMarkdown: {
    match: (node) => node.type === 'underline',
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next((node as unknown as Parent).children as never)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'underline',
    runner: (state, mark) => {
      state.withMark(mark, 'underline' as never)
    },
  },
}))

export const toggleUnderlineCommand = $command('ToggleUnderline', (ctx) => () =>
  toggleMark(underlineSchema.type(ctx)),
)
