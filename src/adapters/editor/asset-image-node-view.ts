import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'

import type { NoteImageStore } from '../../application/index.js'
import { isRemoteImageSource } from '../../domain/index.js'

/**
 * A calm rendered image with two important differences from the stock `img`:
 * a broken relative reference is named instead of becoming a mysterious broken
 * glyph, and the portable Markdown alt text stays directly editable.
 */
export class AssetImageNodeView implements NodeView {
  readonly dom: HTMLElement
  #node: ProseNode
  readonly #image: HTMLImageElement
  readonly #fallback: HTMLElement
  readonly #editAlt: HTMLButtonElement
  #objectUrl: string | null = null
  #loadToken = 0

  constructor(
    node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly store?: NoteImageStore,
  ) {
    this.#node = node
    this.dom = document.createElement('span')
    this.dom.className = 'asset-image'
    this.dom.contentEditable = 'false'

    this.#image = document.createElement('img')
    this.#image.addEventListener('error', () => this.#setMissing(true))
    this.#image.addEventListener('load', () => this.#setMissing(false))

    this.#fallback = document.createElement('span')
    this.#fallback.className = 'asset-image-missing'
    this.#fallback.hidden = true

    this.#editAlt = document.createElement('button')
    this.#editAlt.type = 'button'
    this.#editAlt.className = 'asset-image-edit-alt'
    this.#editAlt.textContent = 'Edit alt text'
    this.#editAlt.addEventListener('click', (event) => {
      event.preventDefault()
      this.#editAlternativeText()
    })

    this.dom.append(this.#image, this.#fallback, this.#editAlt)
    this.#paint()
  }

  #paint(): void {
    const src = String(this.#node.attrs['src'] ?? '')
    const alt = String(this.#node.attrs['alt'] ?? '')
    this.#image.alt = alt
    this.#image.title = alt
    this.#fallback.textContent = `File unavailable: ${src}`
    this.#resolve(src)
  }

  /**
   * Three ways an image source becomes something the window will load.
   *
   * A remote or already-inline source is assigned as-is. A note-relative one
   * is assigned as-is too when no store is composed — that is the browser
   * shell, where the dev server resolves it and a miss shows the named
   * fallback. With a store, the bytes come back through the audited command
   * and render as a `blob:` URL, which the packaged app's policy admits and
   * a bare relative path does not (ADR-0008).
   */
  #resolve(src: string): void {
    this.#releaseObjectUrl()
    const token = (this.#loadToken += 1)

    if (this.store === undefined || src === '' || isRemoteImageSource(src) || /^[a-z][a-z0-9+.-]*:/i.test(src)) {
      this.#image.src = src
      return
    }

    void this.store
      .read(src)
      .then((loaded) => {
        if (token !== this.#loadToken) return
        if (loaded === null) {
          // Fall back to the plain reference: a miss must stay visible (§4.4).
          this.#image.src = src
          return
        }
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(loaded.bytes) as Uint8Array<ArrayBuffer>], { type: loaded.mediaType }),
        )
        this.#objectUrl = url
        this.#image.src = url
      })
      .catch(() => {
        if (token !== this.#loadToken) return
        this.#image.src = src
      })
  }

  #releaseObjectUrl(): void {
    if (this.#objectUrl === null) return
    URL.revokeObjectURL(this.#objectUrl)
    this.#objectUrl = null
  }

  destroy(): void {
    this.#loadToken += 1
    this.#releaseObjectUrl()
  }

  #setMissing(missing: boolean): void {
    this.dom.classList.toggle('is-missing', missing)
    this.#fallback.hidden = !missing
    this.#image.hidden = missing
  }

  #editAlternativeText(): void {
    const next = window.prompt('Image alternative text', String(this.#node.attrs['alt'] ?? ''))
    if (next === null) return
    const pos = this.getPos()
    if (pos === undefined) return
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.#node.attrs,
      alt: next,
    }).scrollIntoView())
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.#node.type) return false
    this.#node = node
    this.#setMissing(false)
    this.#paint()
    return true
  }

  stopEvent(event: Event): boolean {
    return event.target === this.#editAlt
  }

  ignoreMutation(): boolean {
    return true
  }
}
