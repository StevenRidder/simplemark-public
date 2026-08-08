/**
 * DESIGN.md §4.2: a clipboard that is a whole web page wrapped around an
 * article. The offer is explicit, so this file's job is to be *conservative*,
 * not clever — it decides whether a trim is worth offering, and which nodes it
 * is confident are page furniture. Everything it is unsure about is kept.
 *
 * Pure by construction: the adapter mirrors the parsed clipboard into
 * `PageNode`s and applies the answer back to the DOM. ADR-0001 keeps the
 * judgement here and the DOM there.
 */

/** A DOM-free mirror of one pasted element, built by the editor adapter. */
export interface PageNode {
  readonly id: number
  readonly tag: string
  readonly role?: string
  readonly domId?: string
  readonly href?: string
  /** All text in this subtree. */
  readonly text: string
  /** The part of `text` that sits inside a link. */
  readonly linkText: string
  readonly children: readonly PageNode[]
}

export interface PageAnalysis {
  readonly isFullPage: boolean
  readonly coreId?: number
  readonly pruned: ReadonlySet<number>
}

const CHROME_TAGS = new Set([
  'nav', 'footer', 'header', 'aside', 'form', 'button', 'script', 'style', 'noscript', 'iframe',
])
const CHROME_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'complementary', 'search'])
/**
 * Tags whose presence anywhere in a subtree marks it as unambiguous article
 * content — a heading, a table, an image, a long paragraph. Shared by both
 * `hasProtectedContent` and the narrower `hasArticleContent` below.
 */
const ARTICLE_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'img', 'figure', 'figcaption', 'blockquote', 'pre', 'code'])
const PROTECTED_TAGS = new Set([
  ...ARTICLE_TAGS,
  // `sup` carries the specific footnote-marker judgement in isStrandedFootnote
  // below; once that call has cleared a marker as not-stranded it must not be
  // re-judged (and dropped) by the generic density check that follows. `li`
  // (and, transitively via hasProtectedContent's subtree walk, `ul`/`ol`)
  // keeps a real list structure — a table of contents, an API index — from
  // reading the same as a flat row of share/subscribe buttons. This is used
  // only by `prune`, which is conservative about *removing* content: being
  // wrong here loses the user's article, so a link-heavy list survives even
  // if it's actually a share bar that happened to be authored as a list.
  'sup', 'ul', 'ol', 'li',
])
const CORE_TAGS = new Set(['article', 'main'])

/** A core must carry a real article's worth of text before anything is dropped. */
const MIN_CORE_TEXT = 400
/** Above this share of linked text, a block with nothing protected in it is furniture. */
const LINK_DENSITY_LIMIT = 0.5
/** A paragraph this long is content even if it is mostly a link. */
const LONG_PARAGRAPH = 120
/** Fewer links than this outside the core is not a page's worth of chrome. */
const MIN_CHROME_LINKS = 12

function walk(node: PageNode, visit: (node: PageNode) => void): void {
  visit(node)
  for (const child of node.children) walk(child, visit)
}

function isChrome(node: PageNode): boolean {
  return CHROME_TAGS.has(node.tag) || (node.role !== undefined && CHROME_ROLES.has(node.role))
}

function hasContentMatching(node: PageNode, tags: ReadonlySet<string>): boolean {
  let matched = false
  walk(node, (candidate) => {
    if (tags.has(candidate.tag)) matched = true
    if (candidate.tag === 'p' && candidate.text.trim().length > LONG_PARAGRAPH) matched = true
  })
  return matched
}

/** Used by `prune`: is this subtree confidently content, including a list? */
function hasProtectedContent(node: PageNode): boolean {
  return hasContentMatching(node, PROTECTED_TAGS)
}

/**
 * Used only by the `outside` evidence walk below, which asks a different
 * question than `prune` does. `prune` asks "am I confident this is
 * furniture?" — being wrong there loses the user's content, so it protects
 * list tags: a link-heavy list *inside* the core is plausibly a table of
 * contents. `outside` asks "does this look like a whole page?" — being wrong
 * there only costs a wasted offer the user can dismiss. A nav menu or footer
 * sitemap authored as `<div><ul><li><a>` (no `nav` tag, no ARIA role — common
 * in WordPress-style themes) must still register as chrome here, so this
 * predicate deliberately excludes `ul`/`ol`/`li`/`sup` and only recognises
 * unambiguous article content: headings, tables, images, figures,
 * blockquotes, code, or a long paragraph.
 */
function hasArticleContent(node: PageNode): boolean {
  return hasContentMatching(node, ARTICLE_TAGS)
}

function linkDensity(node: PageNode): number {
  const text = node.text.trim().length
  if (text === 0) return node.linkText.trim().length > 0 ? 1 : 0
  return node.linkText.trim().length / text
}

/** Total text held in `p` descendants — prose, as opposed to menu labels. */
function proseLength(node: PageNode): number {
  let total = 0
  walk(node, (candidate) => {
    if (candidate.tag === 'p') total += candidate.text.trim().length
  })
  return total
}

function findCore(root: PageNode): PageNode | undefined {
  let semantic: PageNode | undefined
  walk(root, (candidate) => {
    if (semantic !== undefined) return
    const isSemantic = CORE_TAGS.has(candidate.tag) || candidate.role === 'main'
    if (isSemantic && candidate.text.trim().length >= MIN_CORE_TEXT) semantic = candidate
  })
  if (semantic !== undefined) return semantic

  let best: PageNode | undefined
  let bestProse = Infinity
  walk(root, (candidate) => {
    if (candidate.tag === 'a' || isChrome(candidate)) return
    const prose = proseLength(candidate)
    if (prose < MIN_CORE_TEXT) return
    // Rank by prose itself, not total text — a candidate's non-prose content
    // (a list, a sidebar of links) would otherwise inflate its text length
    // and tip the choice away from the tightest container that actually
    // holds the qualifying prose. Strictly smaller keeps the *innermost*
    // container that still clears the threshold on its own, rather than a
    // larger ancestor padded out with unrelated prose from a sibling. A tie
    // (an ancestor whose qualifying prose is identical to a child's, i.e. it
    // adds nothing) is left on the ancestor, since walk visits it first.
    if (prose < bestProse) {
      best = candidate
      bestProse = prose
    }
  })
  return best
}

/** Fragment targets that actually arrived in the paste. */
function definedAnchors(root: PageNode): ReadonlySet<string> {
  const anchors = new Set<string>()
  walk(root, (candidate) => {
    if (candidate.domId !== undefined && candidate.domId !== '') anchors.add(candidate.domId)
  })
  return anchors
}

/** A `sup` that is only a link, pointing at a definition that did not come along. */
function isStrandedFootnote(node: PageNode, anchors: ReadonlySet<string>): boolean {
  if (node.tag !== 'sup') return false
  const links = node.children.filter((child) => child.tag === 'a')
  if (links.length === 0 || links.length !== node.children.length) return false
  return links.every((link) => {
    const href = link.href ?? ''
    return !href.startsWith('#') || !anchors.has(href.slice(1))
  })
}

export function analysePastedPage(root: PageNode): PageAnalysis {
  const core = findCore(root)
  const pruned = new Set<number>()

  if (core === undefined) return { isFullPage: false, pruned }

  const anchors = definedAnchors(root)
  const prune = (node: PageNode): void => {
    if (isChrome(node) || isStrandedFootnote(node, anchors)) {
      pruned.add(node.id)
      return
    }
    // A bare `a` always has 100% link density by construction, so this check
    // — meant for *blocks of* links — must skip individual anchors the same
    // way `outside` already does below, or every citation link inside
    // otherwise-kept content (a protected paragraph, a list item) would be
    // pruned on its own once its container survives and recursion reaches it.
    if (node.tag !== 'a' && node.id !== core.id && !hasProtectedContent(node) && linkDensity(node) > LINK_DENSITY_LIMIT) {
      pruned.add(node.id)
      return
    }
    for (const child of node.children) prune(child)
  }
  prune(core)

  // Evidence that this is a page and not just a rich paste.
  let roleEvidence = false
  let outsideLinks = 0
  let denseBlockOutside = false
  const outside = (node: PageNode): void => {
    if (node.id === core.id) return
    if (isChrome(node)) roleEvidence = true
    if (node.tag === 'a') outsideLinks += 1
    if (node.tag !== 'a' && !hasArticleContent(node) && linkDensity(node) > LINK_DENSITY_LIMIT) {
      denseBlockOutside = true
    }
    for (const child of node.children) outside(child)
  }
  outside(root)

  const densityEvidence = outsideLinks >= MIN_CHROME_LINKS && denseBlockOutside
  return { isFullPage: roleEvidence || densityEvidence, coreId: core.id, pruned }
}
