import { expect, test } from '@playwright/test'

/**
 * Command refusals share one status slot with save state, and save state used
 * to win: autosave painted "Saved" over the red reason about a second after a
 * command declined, so the person was left with no trace of the refusal and no
 * reason. These drive the real command router and the real autosave.
 */

const EDITOR = '.milkdown .ProseMirror'
const STATUS = '.status'
const NO_TABLE = 'Copy Table needs a table — put the caret inside one'
const NO_CODE = 'Copy Code needs a code block — put the caret inside one'

/**
 * Longer than the 900ms autosave debounce, shorter than the refusal's hold.
 * A refusal still standing at this point survived the save that used to erase
 * it — that is the whole regression.
 */
const PAST_AUTOSAVE_MS = 1800

const NOTE = `# Quarterly

Prose with no table and no code fence in it.
`

async function openNote(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript((content: string) => {
    window.showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory()
      const handle = await root.getFileHandle('refusals.md', { create: true })
      if ((await handle.getFile()).size === 0) {
        const w = await handle.createWritable()
        await w.write(content)
        await w.close()
      }
      return [handle]
    }
  }, NOTE)
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Open file' }).click()
  await expect(page.locator('.filename-title')).toHaveText('refusals')
}

/** Caret in the prose, where neither Copy Table nor Copy Code has anything to copy. */
async function caretInProse(page: import('@playwright/test').Page): Promise<void> {
  const target = page.locator(`${EDITOR} p`).first()
  await target.click()
  await expect
    .poll(async () =>
      target.evaluate((el) => {
        const anchor = window.getSelection()?.anchorNode
        const node = anchor instanceof Element ? anchor : anchor?.parentElement
        return node !== null && node !== undefined && el.contains(node)
      }),
    )
    .toBe(true)
}

const run = (page: import('@playwright/test').Page, command: string): Promise<void> =>
  page.evaluate((id) => window.simplemark!.run(id as never), command)

test('a refusal outlives the save that used to erase it', async ({ page }) => {
  await openNote(page)
  await caretInProse(page)
  await run(page, 'copyTableAsCsv')

  const status = page.locator(STATUS)
  await expect(status).toHaveAttribute('data-state', 'error')
  await expect(status).toHaveText(NO_TABLE)

  // Type after the refusal: that marks the document dirty and schedules an
  // autosave, so a 'dirty' and a 'saved' both arrive inside the hold. Neither
  // may take the slot.
  await page.keyboard.type(' and more prose')
  await page.waitForTimeout(PAST_AUTOSAVE_MS)
  await expect(status).toHaveAttribute('data-state', 'error')
  await expect(status).toHaveText(NO_TABLE)

  // The slot still ends on the truth, just late — the deferred save is painted
  // once the refusal has had its moment, rather than being dropped.
  await expect(status).toHaveAttribute('data-state', 'saved', { timeout: 6000 })
  await expect(status).toHaveText('Saved')
})

test('a newer refusal replaces an older one at once', async ({ page }) => {
  await openNote(page)
  await caretInProse(page)
  await run(page, 'copyTableAsCsv')

  const status = page.locator(STATUS)
  await expect(status).toHaveText(NO_TABLE)

  await run(page, 'copyCode')
  await expect(status).toHaveText(NO_CODE)
  await expect(status).toHaveAttribute('data-state', 'error')
})

test('the reason is readable rather than clipped to its first few words', async ({ page }) => {
  await openNote(page)
  await caretInProse(page)
  await run(page, 'copyTableAsCsv')

  const status = page.locator(STATUS)
  await expect(status).toHaveText(NO_TABLE)

  // Nothing ellipsised: the element is at least as wide as the text in it.
  const clipped = await status.evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(clipped).toBe(false)
  // And the full sentence is reachable on hover and in the accessibility tree.
  await expect(status).toHaveAttribute('title', NO_TABLE)
})

test('widening for a refusal does not move the styles bar', async ({ page }) => {
  await openNote(page)
  const formatting = page.getByLabel('Styles bar')
  const before = await formatting.boundingBox()
  expect(before).not.toBeNull()

  await caretInProse(page)
  await run(page, 'copyTableAsCsv')
  await expect(page.locator(STATUS)).toHaveText(NO_TABLE)

  const after = await formatting.boundingBox()
  expect(after).not.toBeNull()
  expect(after!.x).toBe(before!.x)
})

test('save wording keeps the fixed slot that stops the controls shifting', async ({ page }) => {
  await openNote(page)
  const status = page.locator(STATUS)
  const width = (): Promise<string> => status.evaluate((el) => getComputedStyle(el).inlineSize)

  await expect(status).toHaveAttribute('data-state', 'saved')
  expect(await width()).toBe('118px')

  await caretInProse(page)
  await page.keyboard.type(' edited')
  await expect(status).toHaveAttribute('data-state', 'dirty')
  expect(await width()).toBe('118px')
})
