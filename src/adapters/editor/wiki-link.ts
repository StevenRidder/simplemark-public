import { $nodeSchema, $remark } from '@milkdown/kit/utils'
import type { Parent, PhrasingContent, Root, Text } from 'mdast'
import type { Plugin, Processor } from 'unified'

interface WikiLinkNode {
  type: 'wikiLink'
  target: string
  label: string
}

declare module 'mdast' {
  interface PhrasingContentMap {
    wikiLink: WikiLinkNode
  }
}

const WIKI_LINK = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/gu

const wikiTransform: Plugin<[], Root> = () => (tree: Root) => {
  const transform = (parent: Parent): void => {
    for (let index = 0; index < parent.children.length; index += 1) {
      const child = parent.children[index]
      if (child === undefined) continue
      if ('children' in child && Array.isArray(child.children)) transform(child as Parent)
      if (child.type !== 'text') continue

      const value = (child as Text).value
      const replacements: PhrasingContent[] = []
      let cursor = 0
      for (const match of value.matchAll(WIKI_LINK)) {
        const start = match.index
        if (start > cursor) replacements.push({ type: 'text', value: value.slice(cursor, start) })
        const target = (match[1] ?? '').trim()
        replacements.push({ type: 'wikiLink', target, label: (match[2] ?? target).trim() } as WikiLinkNode)
        cursor = start + match[0].length
      }
      if (replacements.length === 0) continue
      if (cursor < value.length) replacements.push({ type: 'text', value: value.slice(cursor) })
      parent.children.splice(index, 1, ...(replacements as unknown as typeof parent.children))
      index += replacements.length - 1
    }
  }
  transform(tree)
}

function serializeWikiLink(node: WikiLinkNode): string {
  return node.label === node.target ? `[[${node.target}]]` : `[[${node.target}|${node.label}]]`
}

function wikiRemarkPlugin(this: Processor): void {
  const data = this.data() as Record<string, unknown>
  const existing = data['toMarkdownExtensions']
  const extension = { handlers: { wikiLink: serializeWikiLink } }
  data['toMarkdownExtensions'] = Array.isArray(existing) ? [...existing, extension] : [extension]
  return wikiTransform.call(this as never) as never
}

export const wikiRemark = $remark('simplemarkWikiRemark', () => wikiRemarkPlugin as never)

export const wikiLinkSchema = $nodeSchema('wiki_link', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  attrs: {
    target: { default: 'New Note' },
    label: { default: 'New Note' },
  },
  parseDOM: [{
    tag: 'a[data-wiki-link]',
    getAttrs: (dom) => ({
      target: (dom as HTMLElement).dataset['wikiLink'] ?? 'New Note',
      label: dom.textContent ?? 'New Note',
    }),
  }],
  toDOM: (node) => ['a', {
    'data-wiki-link': String(node.attrs['target'] ?? 'New Note'),
    href: `${String(node.attrs['target'] ?? 'New Note').replace(/\.md$/iu, '')}.md`,
    class: 'wiki-link',
  }, String(node.attrs['label'] ?? node.attrs['target'] ?? 'New Note')] as const,
  parseMarkdown: {
    match: (node) => node.type === 'wikiLink',
    runner: (state, node, type) => {
      const link = node as unknown as WikiLinkNode
      state.addNode(type, { target: link.target, label: link.label })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'wiki_link',
    runner: (state, node) => state.addNode('wikiLink' as never, undefined, undefined, {
      target: String(node.attrs['target'] ?? 'New Note'),
      label: String(node.attrs['label'] ?? node.attrs['target'] ?? 'New Note'),
    } as never),
  },
}))
