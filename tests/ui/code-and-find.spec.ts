import { expect, test } from '@playwright/test'

/**
 * EDITOR-7: syntax-highlighted code fences and in-document find.
 *
 * Both features are decoration-only, so the recurring assertion from EDITOR-3
 * holds here too: the serialised Markdown is byte-identical with either
 * feature in use.
 */

const editor = '.milkdown .ProseMirror'
const markdown = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.simplemark!.session.snapshot().markdown)

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=legacy')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
})

/** Types a fenced code block through the real editor. */
async function typeFence(page: import('@playwright/test').Page, language: string, code: string) {
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('```' + language + ' ')
  for (const line of code.split('\n')) {
    await page.keyboard.type(line)
    await page.keyboard.press('Enter')
  }
}

test.describe('syntax highlighting', () => {
  test('a JavaScript fence gets theme-following token colours', async ({ page }) => {
    await typeFence(page, 'js', 'const total = 41')
    const keyword = page.locator(`${editor} pre .hl-keyword`, { hasText: 'const' }).first()
    await expect(keyword).toBeVisible()
    await expect(page.locator(`${editor} pre .hl-number`, { hasText: '41' })).toBeVisible()

    // The colour is the reader theme's token colour, and switching the
    // background switches it — code follows White/Tan/Night like prose does.
    const colour = () => keyword.evaluate((el) => getComputedStyle(el).color)
    const onTan = await colour()
    await page.getByRole('button', { name: 'Text formatting' }).click()
    await page.getByRole('button', { name: 'night background' }).click()
    expect(await colour()).not.toBe(onTan)
  })

  test('an unknown language stays plain code, never an error', async ({ page }) => {
    await typeFence(page, 'foobarlang', 'wibble wobble 99')
    await expect(page.locator(`${editor} pre`, { hasText: 'wibble wobble 99' })).toBeVisible()
    await expect(page.locator(`${editor} pre [class*="hl-"]`)).toHaveCount(0)
    await expect(page.locator('.status')).not.toHaveAttribute('data-state', 'error')
  })

  test('highlighting never touches the source Markdown', async ({ page }) => {
    await typeFence(page, 'python', 'def greet():\n    return "hi"')
    await expect(page.locator(`${editor} pre .hl-keyword`).first()).toBeVisible()
    // The session hears about the edit through the (async) markdown listener;
    // take the baseline only after the fence has actually landed in it.
    await expect.poll(() => markdown(page)).toContain('```python')
    const before = await markdown(page)
    // Toggle themes and edit nothing: the fence must serialise unchanged.
    await page.getByRole('button', { name: 'Text formatting' }).click()
    await page.getByRole('button', { name: 'night background' }).click()
    expect(await markdown(page)).toBe(before)
    expect(before).toContain('def greet():')
    expect(before).toContain('```python')
  })
})

test.describe('in-document find', () => {
  test.beforeEach(async ({ page }) => {
    // Find needs real repeated words, a second heading to fold, and a phrase
    // that appears exactly once to step to — appended after the fixture note.
    await page.evaluate(() => window.simplemark!.editor.focusEnd())
    await page.keyboard.press('Enter')
    await page.keyboard.type('This document explains the notebook and the document flow around it.')
    await page.keyboard.press('Enter')
    await page.keyboard.type('## Second section')
    await page.keyboard.press('Enter')
    await page.keyboard.type('This part is under immediate control of the fold test.')
    await expect.poll(() => markdown(page)).toContain('## Second section')
  })

  test('Cmd+F opens the overlay, matches highlight, Enter steps through', async ({ page }) => {
    const before = await markdown(page)
    await page.locator(editor).click()
    await page.keyboard.press('ControlOrMeta+f')

    const bar = page.locator('.find-bar')
    await expect(bar).toBeVisible()
    await page.getByLabel('Find text').fill('document')
    await expect(page.locator(`${editor} .sm-find-match`).first()).toBeVisible()
    const total = await page.locator(`${editor} .sm-find-match`).count()
    expect(total).toBeGreaterThan(1)
    await expect(bar.locator('.find-count')).toHaveText(`1 of ${total}`)

    await page.keyboard.press('Enter')
    await expect(bar.locator('.find-count')).toHaveText(`2 of ${total}`)
    await page.keyboard.press('Shift+Enter')
    await expect(bar.locator('.find-count')).toHaveText(`1 of ${total}`)

    // Byte-safe: an active search changes nothing about the document.
    expect(await markdown(page)).toBe(before)
  })

  test('Escape dismisses the overlay and every match decoration', async ({ page }) => {
    await page.locator(editor).click()
    await page.keyboard.press('ControlOrMeta+f')
    await page.getByLabel('Find text').fill('the')
    await expect(page.locator(`${editor} .sm-find-match`).first()).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.locator('.find-bar')).toBeHidden()
    await expect(page.locator(`${editor} .sm-find-match`)).toHaveCount(0)
  })

  test('stepping to a match inside a folded section reveals it', async ({ page }) => {
    // Fold the H2 section that contains "immediate control".
    const heading = page.locator(`${editor} h2`, { hasText: 'Second section' })
    await heading.hover()
    await heading.locator('.sm-fold-chevron').click()
    const hidden = page.getByText('under immediate control', { exact: false })
    await expect(hidden).toBeHidden()

    await page.locator(editor).click()
    await page.keyboard.press('ControlOrMeta+f')
    await page.getByLabel('Find text').fill('immediate control')

    // The first (only) match is inside the fold: finding it must unfold it.
    await expect(hidden).toBeVisible()
    await expect(page.locator(`${editor} .sm-find-active`)).toBeVisible()
  })

  test('matches follow edits instead of drifting', async ({ page }) => {
    await page.locator(editor).click()
    await page.keyboard.press('ControlOrMeta+f')
    await page.getByLabel('Find text').fill('notebook')
    await expect(page.locator(`${editor} .sm-find-match`)).toHaveCount(1)

    // Add another occurrence at the end of the document; the count updates.
    await page.evaluate(() => window.simplemark!.editor.focusEnd())
    await page.keyboard.press('Enter')
    await page.keyboard.type('A second notebook mention.')
    await expect(page.locator(`${editor} .sm-find-match`)).toHaveCount(2)
  })
})
