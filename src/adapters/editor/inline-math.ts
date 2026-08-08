import { $nodeSchema } from '@milkdown/kit/utils'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'

import type { DiagramRenderer } from '../../application/index.js'

export const inlineMathSchema = $nodeSchema('inline_math', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  marks: '',
  attrs: { value: { default: 'x' } },
  parseDOM: [{
    tag: 'span[data-type="inline-math"]',
    getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset['source'] ?? 'x' }),
  }],
  toDOM: (node) => ['span', {
    'data-type': 'inline-math',
    'data-source': String(node.attrs['value'] ?? 'x'),
  }] as const,
  parseMarkdown: {
    match: (node) => node.type === 'inlineMath',
    runner: (state, node, type) => state.addNode(type, {
      value: String((node as unknown as { value?: string }).value ?? 'x'),
    }),
  },
  toMarkdown: {
    match: (node) => node.type.name === 'inline_math',
    runner: (state, node) => state.addNode('inlineMath' as never, undefined, undefined, {
      value: String(node.attrs['value'] ?? 'x'),
    } as never),
  },
}))

/** An atomic formula that keeps selection in the surrounding prose. */
export class InlineMathNodeView implements NodeView {
  readonly dom: HTMLElement
  #node: ProseNode
  #token = 0

  constructor(
    node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly renderer: DiagramRenderer,
  ) {
    this.#node = node
    this.dom = document.createElement('span')
    this.dom.className = 'inline-math'
    this.dom.contentEditable = 'false'
    this.dom.title = 'Double-click to edit formula'
    this.dom.addEventListener('dblclick', this.#edit)
    void this.#paint()
  }

  readonly #edit = (event: MouseEvent): void => {
    event.preventDefault()
    const next = window.prompt('Math', String(this.#node.attrs['value'] ?? 'x'))
    if (next === null || next.trim() === '') return
    const pos = this.getPos()
    if (pos === undefined) return
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { value: next }).scrollIntoView())
  }

  async #paint(): Promise<void> {
    const token = ++this.#token
    const result = await this.renderer.render('math-inline', String(this.#node.attrs['value'] ?? 'x'))
    if (token !== this.#token) return
    if (result.ok) {
      this.dom.innerHTML = result.markup
      this.dom.removeAttribute('data-error')
    } else {
      this.dom.textContent = String(this.#node.attrs['value'] ?? 'x')
      this.dom.dataset['error'] = result.message
    }
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.#node.type) return false
    this.#node = node
    void this.#paint()
    return true
  }

  stopEvent(event: Event): boolean { return event.type === 'dblclick' }
  ignoreMutation(): boolean { return true }
  destroy(): void {
    this.#token += 1
    this.dom.removeEventListener('dblclick', this.#edit)
  }
}
