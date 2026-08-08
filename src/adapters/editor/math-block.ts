import { $nodeSchema, $remark } from '@milkdown/kit/utils'
import remarkMath from 'remark-math'
import type { Processor } from 'unified'

/**
 * Display math stored the portable way: `$$…$$` in the file.
 *
 * PR #28 first shipped this as a ` ```math ` fence, reusing the code-block
 * mechanism. That worked but diverged from the contract EDITOR-9 and the Bear
 * inventory both specify, and from what Obsidian and Notion users expect. The
 * fence is an implementation convenience; `$$` is the interchange format, so
 * `$$` wins.
 *
 * **`singleDollarTextMath: false` is the load-bearing option.** With
 * remark-math's default, `The licence costs $100 and renews for $250` parses
 * the span between the two dollars as inline math and silently mangles the
 * sentence. Requiring `$$` means prose with prices stays prose. It also keeps
 * this change inside its own scope: inline math is EDITOR-9's, and it needs an
 * inline node plus input rules rather than a block schema.
 *
 * The node is a leaf holding its source as `value`, not editable ProseMirror
 * text — identical in spirit to how the diagram fence is treated, so the same
 * NodeView renders it and edits its source.
 */

/**
 * remark-math is a unified *attacher*: it registers its extensions on the
 * processor it is called against. `$remark` wants that attacher, so the
 * options are bound by calling it with the processor as `this` rather than by
 * invoking it early — invoking it early yields a transformer and the processor
 * never gets its `data`.
 */
function mathAttacher(this: Processor): void {
  ;(remarkMath as unknown as (this: Processor, options: { singleDollarTextMath: boolean }) => void).call(
    this,
    { singleDollarTextMath: false },
  )
}

export const mathRemark = $remark('simplemarkMathRemark', () => mathAttacher as never)

export const mathBlockSchema = $nodeSchema('math_block', () => ({
  content: 'text*',
  group: 'block',
  marks: '',
  defining: true,
  code: true,
  attrs: { language: { default: 'math' } },
  parseDOM: [
    {
      tag: 'div[data-type="math-block"]',
      preserveWhitespace: 'full' as const,
    },
  ],
  toDOM: () => ['div', { 'data-type': 'math-block' }, 0] as const,
  parseMarkdown: {
    match: (node) => node.type === 'math',
    runner: (state, node, type) => {
      const value = typeof node['value'] === 'string' ? node['value'] : ''
      state.openNode(type, { language: 'math' })
      if (value !== '') state.addText(value)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'math_block',
    runner: (state, node) => {
      // mdast `math` serialises back to a `$$` block via remark-math's own
      // to-markdown extension, so the file never sees the fence again.
      state.addNode('math', undefined, node.textContent)
    },
  },
}))
