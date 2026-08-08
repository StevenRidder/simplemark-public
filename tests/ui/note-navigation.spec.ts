import { expect, test } from '@playwright/test'

import type { Page } from '@playwright/test'

/**
 * Moving between notes without the mouse: ⌘⌥↑/↓ walks the list, ⌘⌥←/→ retraces
 * where you have been.
 *
 * The two are deliberately different features and the tests keep them apart.
 * Walking is positional — it follows the order on screen. History is a stack
 * with a cursor, which is what makes it more than the Recent Notes list it
 * would be tempting to reuse: an order-of-visit record does not reshuffle
 * itself every time you arrive somewhere.
 */

const EDITOR = '.milkdown .ProseMirror'

const noteList = (page: Page) => page.getByRole('complementary', { name: 'Notes' })

/** The note ids in the order the list is actually painting them. */
const displayedOrder = (page: Page): Promise<string[]> =>
  noteList(page).locator('.note-select').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') ?? ''),
  )

const activeNote = (page: Page): Promise<string> =>
  noteList(page).locator('.note-select[aria-current="page"]')
    .first().getAttribute('aria-label').then((name) => name ?? '')

/**
 * Presses a navigation chord with focus inside the editor — the real situation,
 * since the editor holds focus for almost the whole life of the app, and the
 * one where a shortcut that fought macOS text navigation would show it.
 */
async function navigate(page: Page, key: string): Promise<void> {
  await page.locator(EDITOR).first().click()
  await page.keyboard.press(`ControlOrMeta+Alt+${key}`)
}

async function openNote(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click()
  await expect.poll(() => activeNote(page)).toBe(name)
}

async function pinNote(page: Page, name: string): Promise<void> {
  const pin = page.getByRole('button', { name: `Pin ${name}` })
  await pin.locator('..').hover()
  await pin.click()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=legacy')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
})

test('⌘⌥↓ and ⌘⌥↑ walk the note list in the order it is displayed, wrapping at both ends', async ({ page }) => {
  const order = await displayedOrder(page)
  expect(order.length).toBeGreaterThan(2)
  await expect.poll(() => activeNote(page)).toBe(order[0])

  for (const expected of [...order.slice(1), order[0]]) {
    await navigate(page, 'ArrowDown')
    await expect.poll(() => activeNote(page)).toBe(expected)
  }

  // Back up the same way, ending where a wrap upward from the top must land.
  for (const expected of [order.at(-1), ...[...order].reverse().slice(1)]) {
    await navigate(page, 'ArrowUp')
    await expect.poll(() => activeNote(page)).toBe(expected)
  }
})

test('a walk survives the list re-sorting under it', async ({ page }) => {
  // The native shell orders Recent Notes by recency and moves each opened note
  // to the front, so a walk that re-read the live list on every press stepped
  // to the second note, watched it become the first, and bounced back. Pinning
  // reorders the list here the same way without moving the selection, which is
  // the condition that broke it.
  const order = await displayedOrder(page)
  await navigate(page, 'ArrowDown')
  await expect.poll(() => activeNote(page)).toBe(order[1])

  await pinNote(page, order[1]!)
  await expect.poll(() => displayedOrder(page).then((now) => now[0])).toBe(order[1])

  await navigate(page, 'ArrowDown')
  await expect.poll(() => activeNote(page)).toBe(order[2])
})

test('⌘⌥← retraces the order notes were opened in rather than their recency', async ({ page }) => {
  const order = await displayedOrder(page)
  const [first, second, third] = order as [string, string, string]

  await openNote(page, second)
  await openNote(page, third)

  // Twice back must reach the first note. A most-recently-used list would have
  // reordered on each arrival and bounced between the last two instead.
  await navigate(page, 'ArrowLeft')
  await expect.poll(() => activeNote(page)).toBe(second)
  await navigate(page, 'ArrowLeft')
  await expect.poll(() => activeNote(page)).toBe(first)

  await navigate(page, 'ArrowRight')
  await expect.poll(() => activeNote(page)).toBe(second)
  await navigate(page, 'ArrowRight')
  await expect.poll(() => activeNote(page)).toBe(third)
})

test('a walk with ⌘⌥↓ is an ordinary visit that ⌘⌥← backs out of', async ({ page }) => {
  const order = await displayedOrder(page)
  await navigate(page, 'ArrowDown')
  await expect.poll(() => activeNote(page)).toBe(order[1])

  await navigate(page, 'ArrowLeft')
  await expect.poll(() => activeNote(page)).toBe(order[0])
})

test('opening a note after going back discards the branch ahead of it', async ({ page }) => {
  const order = await displayedOrder(page)
  const [first, second, third] = order as [string, string, string]

  await openNote(page, second)
  await openNote(page, third)
  await navigate(page, 'ArrowLeft')
  await expect.poll(() => activeNote(page)).toBe(second)

  // Forward exists right up until a new destination is chosen, and then it does
  // not: the path not taken is gone, exactly as a browser discards it.
  await expect.poll(() => forwardEnabled(page)).toBe(true)
  await openNote(page, first)
  await expect.poll(() => forwardEnabled(page)).toBe(false)

  await navigate(page, 'ArrowRight')
  await expect.poll(() => activeNote(page)).toBe(first)
})

const forwardEnabled = (page: Page): Promise<boolean> =>
  page.evaluate(() => window.simplemark!.commandState('historyForward').enabled)

const backEnabled = (page: Page): Promise<boolean> =>
  page.evaluate(() => window.simplemark!.commandState('historyBack').enabled)

test('the titlebar arrows are honest about where they lead, and lead there', async ({ page }) => {
  // They ship hidden, like Bear's. Revealing them goes through the same command
  // the View menu sends, so the test drives the shipped path rather than CSS.
  await page.evaluate(() => window.simplemark!.run('toggleHistoryNavigation'))

  const back = page.getByRole('button', { name: 'Back' })
  const forward = page.getByRole('button', { name: 'Forward' })
  await expect(back).toBeVisible()

  // Nothing has been visited but the note you launched into, so both arrows are
  // disabled. An enabled arrow that does nothing is the fake control the shell
  // refuses to ship — these two sat permanently disabled until there was a real
  // stack behind them.
  await expect(back).toBeDisabled()
  await expect(forward).toBeDisabled()
  expect(await backEnabled(page)).toBe(false)

  const order = await displayedOrder(page)
  await openNote(page, order[1]!)

  await expect(page.getByRole('button', { name: 'Back' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Forward' })).toBeDisabled()

  await page.getByRole('button', { name: 'Back' }).click()
  await expect.poll(() => activeNote(page)).toBe(order[0])
  await expect(page.getByRole('button', { name: 'Forward' })).toBeEnabled()

  await page.getByRole('button', { name: 'Forward' }).click()
  await expect.poll(() => activeNote(page)).toBe(order[1])
})

test('plain ⌘ arrows still belong to the document, not to note navigation', async ({ page }) => {
  // The reason the binding is ⌘⌥ rather than the ⌘ arrows it would be natural
  // to reach for: ⌘←/→ is macOS caret-to-line-start/end and ⌘↑/↓ is
  // caret-to-document-start/end, all four native to the contenteditable the app
  // is mostly made of. Taking them would mean calling preventDefault on real
  // text navigation, so this asserts they were left where macOS put them —
  // no note change, no edit.
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  const before = await page.evaluate(() => window.simplemark!.session.snapshot().markdown)
  const startingNote = await activeNote(page)

  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    await page.keyboard.press(`ControlOrMeta+${key}`)
  }

  // What this owns is that the keys were not taken: the note did not change and
  // the document did not change. Where exactly the caret landed is the browser
  // engine's business and differs between WebKit and Chromium, so asserting it
  // here would test the platform rather than the binding.
  expect(await activeNote(page)).toBe(startingNote)
  expect(await page.evaluate(() => window.simplemark!.session.snapshot().markdown)).toBe(before)
})
