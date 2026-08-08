import { describe, expect, it } from 'vitest'

import { analysePastedPage, type PageNode } from '../../src/domain/index.js'

/**
 * The trim heuristic, as pure data. It only ever *removes* what it is
 * confident about: the cost of keeping chrome is a wasted offer, and the cost
 * of dropping content is the paste losing something the person wanted.
 */
let nextId = 0
function node(tag: string, parts: Partial<PageNode> & { children?: PageNode[] } = {}): PageNode {
  const children = parts.children ?? []
  const ownText = parts.text ?? ''
  const text = ownText + children.map((child) => child.text).join(' ')
  const linkText =
    (tag === 'a' ? text : parts.linkText ?? '') +
    children.map((child) => (tag === 'a' ? '' : child.linkText)).join(' ')
  return {
    id: (nextId += 1),
    tag,
    text,
    linkText: tag === 'a' ? text : linkText,
    children,
    ...(parts.role === undefined ? {} : { role: parts.role }),
    ...(parts.domId === undefined ? {} : { domId: parts.domId }),
    ...(parts.href === undefined ? {} : { href: parts.href }),
  }
}

const PROSE = 'x'.repeat(500)

function article(...extra: PageNode[]): PageNode {
  return node('article', { children: [node('h1', { text: 'Title' }), node('p', { text: PROSE }), ...extra] })
}

describe('analysePastedPage', () => {
  it('offers a trim when the paste carries a nav element', () => {
    const root = node('div', { children: [node('nav', { children: [node('a', { text: 'Home' })] }), article()] })
    expect(analysePastedPage(root).isFullPage).toBe(true)
  })

  it('offers a trim on link density alone, with no semantic chrome tags', () => {
    // Substack builds its chrome from divs: zero nav/footer/header elements.
    const links = Array.from({ length: 14 }, (_, index) => node('a', { text: `Link ${index}` }))
    const root = node('div', { children: [node('div', { children: links }), article()] })
    expect(analysePastedPage(root).isFullPage).toBe(true)
  })

  it('offers a trim when chrome is authored as a list, with no semantic tags or roles', () => {
    // A WordPress-style nav/footer sitemap: <div><ul><li><a>…</a></li></ul></div>.
    // `prune` protects list tags conservatively (a link-heavy list *inside*
    // the core might be a table of contents), but that protection must not
    // blind this "is this a page" signal to list-shaped chrome sitting
    // outside the core — `outside` uses a narrower predicate that does not
    // exempt lists.
    const items = Array.from({ length: 14 }, (_, index) =>
      node('li', { children: [node('a', { text: `Item ${index}` })] }),
    )
    const root = node('div', { children: [node('div', { children: [node('ul', { children: items })] }), article()] })
    expect(analysePastedPage(root).isFullPage).toBe(true)
  })

  it('does not offer a trim for an ordinary rich paste', () => {
    const root = node('div', {
      children: [node('p', { text: PROSE }), node('p', { text: 'A second paragraph.' })],
    })
    expect(analysePastedPage(root).isFullPage).toBe(false)
  })

  it('does not offer a trim when no content core can be identified', () => {
    const root = node('div', { children: [node('nav', { children: [node('a', { text: 'Home' })] })] })
    const analysis = analysePastedPage(root)
    expect(analysis.coreId).toBeUndefined()
    expect(analysis.isFullPage).toBe(false)
  })

  it('picks the densest prose container when there is no article element', () => {
    const core = node('div', { children: [node('p', { text: PROSE })] })
    const root = node('div', { children: [node('div', { children: [node('p', { text: 'short' })] }), core] })
    expect(analysePastedPage(root).coreId).toBe(core.id)
  })

  it('prunes chrome by tag and by ARIA role inside the core', () => {
    const footer = node('footer', { children: [node('a', { text: 'Terms' })] })
    const banner = node('div', { role: 'banner', children: [node('a', { text: 'Logo' })] })
    const analysis = analysePastedPage(node('div', { children: [article(footer, banner)] }))
    expect(analysis.pruned.has(footer.id)).toBe(true)
    expect(analysis.pruned.has(banner.id)).toBe(true)
  })

  it('prunes a link farm but never a heading, table, image or long paragraph', () => {
    const farm = node('div', {
      children: [node('a', { text: 'Share' }), node('a', { text: 'Comment' }), node('a', { text: 'Subscribe' })],
    })
    const heading = node('h2', { text: 'A linked section', children: [node('a', { text: 'Anchor' })] })
    const table = node('table', { children: [node('a', { text: 'ref' })] })
    const image = node('img')
    const paragraph = node('p', { text: PROSE, children: [node('a', { text: 'a source' })] })
    const analysis = analysePastedPage(node('div', { children: [article(farm, heading, table, image, paragraph)] }))
    expect(analysis.pruned.has(farm.id)).toBe(true)
    expect(analysis.pruned.has(heading.id)).toBe(false)
    expect(analysis.pruned.has(table.id)).toBe(false)
    expect(analysis.pruned.has(image.id)).toBe(false)
    expect(analysis.pruned.has(paragraph.id)).toBe(false)
  })

  it('prunes a footnote superscript whose definition did not come along', () => {
    const stranded = node('sup', { children: [node('a', { text: '1', href: '#fn-1' })] })
    const analysis = analysePastedPage(node('div', { children: [article(stranded)] }))
    expect(analysis.pruned.has(stranded.id)).toBe(true)
  })

  it('keeps a footnote superscript whose definition is in the paste', () => {
    const kept = node('sup', { children: [node('a', { text: '1', href: '#fn-1' })] })
    const definition = node('div', { domId: 'fn-1', text: 'The definition.' })
    const analysis = analysePastedPage(node('div', { children: [article(kept, definition)] }))
    expect(analysis.pruned.has(kept.id)).toBe(false)
  })

  it('keeps a documentation core that is legitimately link-heavy', () => {
    const core = node('article', {
      children: [
        node('h1', { text: 'API index' }),
        node('p', { text: PROSE }),
        node('ul', {
          children: Array.from({ length: 20 }, (_, index) => node('li', { children: [node('a', { text: `method${index}` })] })),
        }),
      ],
    })
    const analysis = analysePastedPage(node('div', { children: [core] }))
    expect(analysis.coreId).toBe(core.id)
    // The list is inside the core and carries no chrome role, so the trim
    // leaves it alone: an index page is still the article.
    expect([...analysis.pruned]).toEqual([])
  })
})
