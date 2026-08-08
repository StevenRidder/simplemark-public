import { expect, test } from '@playwright/test'

/**
 * The DOM half of article extraction, exercised in the browser that actually
 * runs it. The judgement it delegates to is unit-tested in
 * `tests/domain/paste-page-analysis.test.ts`; what these prove is the mirror
 * into `PageNode`s and the application of the answer back to the tree.
 */
const trim = async (page: import('@playwright/test').Page, html: string) =>
  page.evaluate(async (source) => {
    const path = '/src/adapters/editor/page-trim.ts'
    const module = (await import(path)) as typeof import('../../src/adapters/editor/page-trim.js')
    return {
      isFullPage: module.looksLikeFullPagePaste(source),
      article: module.extractArticleHtml(source),
    }
  }, html)

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
})

const PROSE = 'This is a real paragraph of article prose. '.repeat(12)

const FULL_PAGE = `
  <html><head><title>Gemini is Cooked</title></head><body>
    <nav><a href="/">Home</a><a href="/archive">Archive</a><a href="/about">About</a></nav>
    <div class="subscribe"><button>Subscribe</button></div>
    <article>
      <h1>Gemini is Cooked</h1>
      <p>${PROSE}</p>
      <figure><img src="https://cdn.example/chart.png" alt="A chart"></figure>
      <table><tr><td>TPU</td><td>v7</td></tr></table>
      <p>${PROSE}<sup><a href="#fn-1">1</a></sup></p>
      <div class="share"><a href="#">Share</a><a href="#">Comment</a><a href="#">Restack</a></div>
    </article>
    <footer><a href="/terms">Terms</a><a href="/privacy">Privacy</a></footer>
  </body></html>`

test('recognises a page wrapped around an article', async ({ page }) => {
  expect((await trim(page, FULL_PAGE)).isFullPage).toBe(true)
})

test('leaves an ordinary rich paste alone', async ({ page }) => {
  const ordinary = `<div><p>${PROSE}</p><p>A second paragraph.</p></div>`
  expect((await trim(page, ordinary)).isFullPage).toBe(false)
})

test('does not throw on malformed input', async ({ page }) => {
  expect((await trim(page, '<div><p>unclosed')).isFullPage).toBe(false)
  expect((await trim(page, '')).isFullPage).toBe(false)
})

test('keeps the article and drops the page furniture', async ({ page }) => {
  const { article } = await trim(page, FULL_PAGE)
  expect(article).toContain('Gemini is Cooked')
  expect(article).toContain('<img')
  expect(article).toContain('<table')
  expect(article).not.toContain('Archive')
  expect(article).not.toContain('Subscribe')
  expect(article).not.toContain('Restack')
  expect(article).not.toContain('Privacy')
})

test('drops a footnote marker whose definition did not come along', async ({ page }) => {
  expect((await trim(page, FULL_PAGE)).article).not.toContain('#fn-1')
})

test('prepends the source line when the clipboard names one', async ({ page }) => {
  const { article } = await trim(page, `SourceURL:https://example.com/post\n${FULL_PAGE}`)
  expect(article).toContain(
    '<blockquote><p>Source: <a href="https://example.com/post">Gemini is Cooked</a></p></blockquote>',
  )
})

test('omits the source line when the clipboard does not name one', async ({ page }) => {
  expect((await trim(page, FULL_PAGE)).article).not.toContain('Source:')
})

test('returns null when there is nothing to trim', async ({ page }) => {
  expect((await trim(page, `<div><p>${PROSE}</p></div>`)).article).toBeNull()
})
