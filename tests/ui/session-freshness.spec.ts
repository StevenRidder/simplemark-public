import { expect, test } from '@playwright/test'

/**
 * The session must be able to answer for the document on screen, on demand.
 *
 * Milkdown's listener plugin debounces `markdownUpdated` by 200ms, so for a
 * moment after every keystroke `session.snapshot()` still describes the previous
 * document. That is fine for the things a debounce exists for — autosave, the
 * word count — and dangerous for anything that reads the session to make an
 * irreversible decision. The native shell has two of those: whether a new note
 * is untouched enough to throw away without asking, and what a draft puts on the
 * clipboard. Both call `flushPendingChanges` first, and this is the contract
 * they are relying on.
 *
 * The shell that owns those two decisions is a composition root that self-starts
 * on import and talks to AppKit, so it cannot be driven from a test. The
 * composition it drives can be, and it is the same one — `window.simplemark` is
 * the object both entrypoints build.
 */

const EDITOR = '.milkdown .ProseMirror'

const sessionMarkdown = (page: import('@playwright/test').Page): Promise<string> =>
  page.evaluate(() => window.simplemark!.session.snapshot().markdown)

test('a flush hands the last keystroke over immediately', async ({ page }) => {
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)

  await page.locator(EDITOR).first().click()
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('Typed a moment ago.')

  // The debounce is still running. Without the flush the session answers with
  // the document as it was before this sentence — which is the whole bug.
  expect(await sessionMarkdown(page)).not.toContain('Typed a moment ago.')

  await page.evaluate(() => window.simplemark!.flushPendingChanges())
  expect(await sessionMarkdown(page)).toContain('Typed a moment ago.')
})

test('a flush of an untouched document reports no edit', async ({ page }) => {
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)

  const before = await sessionMarkdown(page)
  await page.evaluate(() => window.simplemark!.flushPendingChanges())

  // Parsing and re-serialising normalises some Markdown, so a flush that
  // compared against the bytes on disk would report an edit nobody made. That
  // would be worse than the bug it fixes: every untouched new note would then
  // raise a destination panel on the way out, which is exactly the trap the
  // draft check exists to avoid.
  expect(await sessionMarkdown(page)).toBe(before)
  expect(await page.evaluate(() => window.simplemark!.session.snapshot().dirty)).toBe(false)
})

test('a flush after the debounce has already fired does not re-dirty the document', async ({ page }) => {
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)

  await page.locator(EDITOR).first().click()
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('Saved, then flushed again.')

  await page.evaluate(() => window.simplemark!.save())
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().dirty))
    .toBe(false)

  // The debounce timer armed by the typing is still pending when the save
  // flushes. When it fires it must recognise that it has nothing new to say, or
  // the document goes dirty again the instant after it was saved.
  await page.evaluate(() => window.simplemark!.flushPendingChanges())
  expect(await page.evaluate(() => window.simplemark!.session.snapshot().dirty)).toBe(false)
})
