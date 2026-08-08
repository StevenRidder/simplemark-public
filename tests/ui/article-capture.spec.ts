import { expect, test } from '@playwright/test'

/**
 * ARTICLE-1 — DESIGN.md §4.2's two new rulings, in a real browser.
 *
 * The browser shell composes no image store, so images keep their remote URLs
 * here; that is the graceful decline, and it is asserted rather than assumed.
 * The download path itself is proven natively in `note_images.rs`.
 *
 * The last three tests below guard content-loss paths a reviewer found by
 * inspection during Task 10 — the boundary-bias fix, the "read live plugin
 * state at click time" fix, and the structural overlap guard in
 * `page-trim-offer.ts`. They are the highest-value tests in this file.
 *
 * One test from the original brief — the `SourceURL:` provenance line — is
 * deliberately absent here; see the comment in its place below for why.
 */
const editor = '.milkdown .ProseMirror'

const PROSE = 'This is a real paragraph of article prose that runs on for a while. '.repeat(6)

const FULL_PAGE = `<html><head><title>Gemini is Cooked</title></head><body>
  <nav><a href="/">Home</a><a href="/archive">Archive</a><a href="/about">About</a></nav>
  <article>
    <h1>Gemini is Cooked</h1>
    <p>${PROSE}</p>
    <table><thead><tr><th>Chip</th><th>Gen</th></tr></thead><tbody><tr><td>TPU</td><td>v7</td></tr></tbody></table>
    <p>${PROSE}</p>
    <div class="share"><a href="#">Share</a><a href="#">Comment</a><a href="#">Restack</a></div>
  </article>
  <footer><a href="/terms">Terms</a><a href="/privacy">Privacy</a></footer>
</body></html>`

const ORDINARY = `<div><p>${PROSE}</p><p>A second <strong>rich</strong> paragraph.</p></div>`

async function caretAtEnd(page: import('@playwright/test').Page) {
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
}

async function pasteAtEnd(page: import('@playwright/test').Page, text: string, html?: string) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.bringToFront()
  await caretAtEnd(page)
  await page.evaluate(
    async ({ t, h }) => {
      if (h === undefined) {
        await navigator.clipboard.writeText(t)
        return
      }
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([t], { type: 'text/plain' }),
          'text/html': new Blob([h], { type: 'text/html' }),
        }),
      ])
    },
    { t: text, h: html },
  )
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+v')
}

/**
 * Caret at the very start of the document.
 *
 * A pure DOM `Selection`/`Range` hack (no mouse, no scroll — set the native
 * selection directly and let ProseMirror "sync from it") was tried first and
 * had to be abandoned: it does not stick. ProseMirror keeps its own selection
 * in the editor state and treats the DOM as a projection of that state, not
 * the other way round. Setting `window.getSelection()` manually changes what
 * the browser shows for a moment, but the next `view.updateState` — and one
 * always follows shortly after a paste, from the heading-id sync alone —
 * calls `selectionToDOM` and overwrites the browser's selection back to
 * whatever ProseMirror's *model* still holds, silently discarding the manual
 * change. Confirmed directly: setting the range this way measured as correct
 * immediately afterward, but had reverted to the post-paste end-of-document
 * position before the next microtask ran, every single time it was tried —
 * not a flake, a guaranteed loss, because nothing in that approach ever tells
 * ProseMirror's own model to move.
 *
 * A real click does not have this problem: ProseMirror handles `mousedown`
 * itself and updates its internal selection synchronously as part of that
 * handling, so the DOM and the model can never disagree about where a click
 * landed. The click that flaked under the full suite used raw coordinates —
 * `boundingBox()` once, then `page.mouse.click(box.x, box.y)` — which goes
 * stale the moment anything scrolls between those two calls, and the paste's
 * own `scrollIntoView()` plus the heading-id sync and image machinery it
 * triggers are exactly that kind of thing, more likely to land in an
 * inconvenient order the busier the machine is. The fix is to let Playwright
 * own the coordinates instead of caching them: `locator.click()` re-verifies
 * the element is attached, visible and *stable* (unmoving across consecutive
 * frames) immediately before dispatching, and resolves `position` against
 * whatever box that check just measured — so a concurrent scroll makes the
 * click wait, not miss. `position` here is a fixed offset from the heading's
 * own top-left, computed from `boundingBox()` once purely to get a
 * scroll-independent vertical fraction (an element's own height does not
 * change when the page scrolls); the click itself still re-measures *where*
 * that offset lands.
 *
 * The target has to be the heading's own text, not just "click the heading":
 * an `x: 2` offset lands just past its left edge, ahead of any text — this
 * matters because the folding gutter (EDITOR-3) prepends a
 * `contenteditable="false"` chevron `<button>` widget before the heading's
 * text, and a click that missed past it would have landed in the button
 * instead of the text, the same silently-nowhere failure the DOM-selection
 * attempt above ran into a different way.
 */
async function caretAtStart(page: import('@playwright/test').Page) {
  const heading = page.locator(`${editor} h1`).first()
  const box = await heading.boundingBox()
  if (box === null) throw new Error('heading bounding box unavailable')
  await heading.click({ position: { x: 2, y: box.height / 2 } })
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.anchorOffset ?? -1))
    .toBe(0)
}

const serialize = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.simplemark!.editor.serialize())

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
})

test('a pasted web page offers to trim its chrome', async ({ page }) => {
  await pasteAtEnd(page, 'Gemini is Cooked', FULL_PAGE)
  await expect(page.locator('.page-trim-offer')).toBeVisible()
})

test('an ordinary rich paste raises no offer', async ({ page }) => {
  await pasteAtEnd(page, 'plain', ORDINARY)
  await expect(page.locator(editor)).toContainText('A second rich paragraph.')
  await expect(page.locator('.page-trim-offer')).toHaveCount(0)
})

test('the faithful paste lands before anything is offered', async ({ page }) => {
  await pasteAtEnd(page, 'Gemini is Cooked', FULL_PAGE)
  const markdown = await serialize(page)
  expect(markdown).toContain('# Gemini is Cooked')
  // Nothing was removed without being asked.
  expect(markdown).toContain('Archive')
})

test('dismissing leaves the faithful paste exactly as it was', async ({ page }) => {
  await pasteAtEnd(page, 'Gemini is Cooked', FULL_PAGE)
  const before = await serialize(page)
  await page.locator('.page-trim-offer-dismiss').click()
  await expect(page.locator('.page-trim-offer')).toHaveCount(0)
  expect(await serialize(page)).toBe(before)
})

test('Escape dismisses the offer', async ({ page }) => {
  await pasteAtEnd(page, 'Gemini is Cooked', FULL_PAGE)
  await page.keyboard.press('Escape')
  await expect(page.locator('.page-trim-offer')).toHaveCount(0)
})

test('trimming removes the page furniture', async ({ page }) => {
  await pasteAtEnd(page, 'Gemini is Cooked', FULL_PAGE)
  await page.locator('.page-trim-offer-accept').click()
  const markdown = await serialize(page)
  expect(markdown).not.toContain('Archive')
  expect(markdown).not.toContain('Restack')
  expect(markdown).not.toContain('Privacy')
})

test('trimming keeps the heading, the prose and the table', async ({ page }) => {
  await pasteAtEnd(page, 'Gemini is Cooked', FULL_PAGE)
  await page.locator('.page-trim-offer-accept').click()
  const markdown = await serialize(page)
  expect(markdown).toContain('# Gemini is Cooked')
  expect(markdown).toContain('| Chip | Gen |')
  expect(markdown).toContain('TPU')
})

// No browser-level test for the `SourceURL:` provenance line here on purpose.
// `navigator.clipboard.write` cannot reproduce a genuine CF_HTML clipboard
// payload: a real one is line-delimited, but Chrome's synthetic paste
// pipeline reflows a `SourceURL:...\n<html>...` string so `<body>` sits
// immediately after it with no newline, which `provenance.ts`'s
// line-anchored regex correctly declines to match — that is the parser
// being conservative, not a bug, and loosening it to satisfy a harness
// artifact is exactly the kind of guess DESIGN.md forbids. The provenance
// line is covered directly against the raw clipboard string instead, in
// `tests/ui/page-trim.spec.ts`'s "prepends the source line when the
// clipboard names one", which passes.

test('one undo restores the faithful paste after a trim', async ({ page }) => {
  await pasteAtEnd(page, 'Gemini is Cooked', FULL_PAGE)
  const faithful = await serialize(page)
  await page.locator('.page-trim-offer-accept').click()
  expect(await serialize(page)).not.toBe(faithful)

  await caretAtEnd(page)
  await page.keyboard.press('ControlOrMeta+z')
  expect(await serialize(page)).toBe(faithful)
})

test('a remote image survives a paste unchanged where no store is composed', async ({ page }) => {
  await pasteAtEnd(
    page,
    'picture',
    `<div><p>${PROSE}</p><p><img src="https://example.com/chart.png" alt="A chart"></p></div>`,
  )
  // Milkdown's commonmark image parseDOM falls back to `alt` for `title` when
  // the pasted <img> carries no title of its own (@milkdown/preset-commonmark),
  // which is why the serialized form carries a quoted title alongside the alt
  // text. What this test actually guards — the URL landing unrewritten, with
  // no local asset path substituted in — is unaffected by that title default.
  expect(await serialize(page)).toContain('![A chart](https://example.com/chart.png "A chart")')
})

// The three tests below were not in the original brief. They cover
// content-loss paths a reviewer found by inspection during Task 10.

/**
 * Guards the boundary-bias fix in page-trim-offer.ts's `apply`: `to` biases
 * backward (assoc -1), so an insertion exactly at the tracked range's end —
 * where the caret sits the instant after a paste — lands outside the range
 * rather than being pulled into it and discarded by a later Trim.
 *
 * The marker is one space-free token rather than a sentence: the caret lands
 * inside the footer anchor's inclusive link mark, and Chrome normalises the
 * whitespace it types there to U+00A0 (non-breaking), not U+0020 — an
 * assertion built from an ordinary sentence with literal ASCII spaces could
 * never match regardless of whether the underlying property held.
 */
test('typing right after a paste is not swallowed by an accepted trim', async ({ page }) => {
  await pasteAtEnd(page, 'Gemini is Cooked', FULL_PAGE)
  await page.keyboard.type('TYPEDAFTERPASTE')

  await page.locator('.page-trim-offer-accept').click()
  expect(await serialize(page)).toContain('TYPEDAFTERPASTE')
})

/**
 * Guards `accept` reading the offer out of plugin state at click time rather
 * than a closure captured when the widget was built. Editing far above the
 * pasted range shifts every position downstream of it; with a stale closure,
 * Trim would act on the original coordinates, deleting the new paragraph and
 * leaving the chrome behind instead of the reverse.
 */
test('an edit above a full-page paste survives a trim, and the chrome is still removed', async ({ page }) => {
  await pasteAtEnd(page, 'Gemini is Cooked', FULL_PAGE)
  await caretAtStart(page)
  await page.keyboard.type('A paragraph written before any of this was pasted.')

  // The keystrokes have to actually land before the trim assertions below can
  // mean anything — a caret placed on the wrong element eats every character
  // silently, and the test would still "pass" if the trim assertions were
  // weak enough to be true either way.
  expect(await serialize(page)).toContain('A paragraph written before any of this was pasted.')

  await page.locator('.page-trim-offer-accept').click()
  const markdown = await serialize(page)
  expect(markdown).toContain('A paragraph written before any of this was pasted.')
  expect(markdown).not.toContain('Archive')
})

/**
 * Guards the structural overlap guard in `apply`: selecting the whole
 * document and typing over it is one step whose old span exactly covers the
 * tracked range, which must drop the offer even though mapped `from`/`to`
 * numbers alone would still look valid. Without the guard the bar would
 * survive over content it no longer describes, and clicking it would destroy
 * the replacement.
 */
test('replacing the whole document drops a stale trim offer', async ({ page }) => {
  await pasteAtEnd(page, 'Gemini is Cooked', FULL_PAGE)
  await expect(page.locator('.page-trim-offer')).toBeVisible()

  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Replaced entirely.')
  await expect(page.locator('.page-trim-offer')).toHaveCount(0)
})
