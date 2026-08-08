import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'

/**
 * Carry the fence info tail through the editor.
 *
 * Milkdown's code_block keeps only the language token: ```` ```svg width=320 ````
 * parses to `language: "svg"` and the tail is dropped on the next serialise —
 * a D7 violation for any fence carrying meta, and the reason chart layout
 * (width=, float=) could not persist. The remark `code` node already has a
 * `meta` field on both sides; this extension just stops losing it.
 */
export const codeBlockMetaSchema = codeBlockSchema.extendSchema((prev) => {
  return (ctx) => {
    const base = prev(ctx)
    return {
      ...base,
      attrs: { ...base.attrs, meta: { default: '', validate: 'string' } },
      parseMarkdown: {
        match: ({ type }) => type === 'code',
        runner: (state, node, type) => {
          state.openNode(type, {
            language: (node.lang as string | null) ?? '',
            meta: (node.meta as string | null) ?? '',
          })
          if (node.value) state.addText(node.value as string)
          state.closeNode()
        },
      },
      toMarkdown: {
        match: (node) => node.type.name === 'code_block',
        runner: (state, node) => {
          state.addNode('code', undefined, node.content.firstChild?.text ?? '', {
            lang: node.attrs['language'],
            meta: node.attrs['meta'] === '' ? undefined : node.attrs['meta'],
          })
        },
      },
    }
  }
})
