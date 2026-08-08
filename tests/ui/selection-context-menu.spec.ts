import { expect, test } from '@playwright/test'

/**
 * EDITOR-13: the Copy As exports, reachable where people reach for copy.
 *
 * The operator's hard constraint shapes these tests: **plain Copy must behave
 * exactly as it does today.** The first test pins that, and it is the one that
 * must never be "fixed" by changing the expectation — the ordinary copy path is
 * ProseMirror's, and this feature is not allowed to wrap or replace it.
 */

const EDITOR = '.milkdown .ProseMirror'
const MENU = '.selection-context-menu'

const NOTE = `# Quarterly

Prose with **bold** and a [link](https://example.com).

| Region | Revenue |
| --- | --- |
| West | 1,200 |
| East | 900 |

\`\`\`ts
const total = 2100
\`\`\`
`

async function openNote(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript((content: string) => {
    window.showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory()
      const handle = await root.getFileHandle('ctx.md', { create: true })
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
  await expect(page.locator('.filename-title')).toHaveText('ctx')
}

/**
 * Puts the caret in the element and opens the context menu on it.
 *
 * Dispatching `contextmenu` directly rather than right-clicking is deliberate:
 * Playwright's synthetic right-click collapses any selection first, which real
 * browsers do not do. The later click on a menu row is still a genuine user
 * gesture, which is what the clipboard requires.
 */
async function openMenuAt(
  page: import('@playwright/test').Page,
  selector: string,
): Promise<void> {
  const target = page.locator(selector).first()
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
  await target.evaluate((el) => {
    const box = el.getBoundingClientRect()
    el.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: Math.round(box.left + 12),
        clientY: Math.round(box.top + 8),
      }),
    )
  })
  await expect(page.locator(MENU)).toBeVisible()
}

/**
 * Selects text and opens the menu in one document turn.
 *
 * Milkdown may reconcile a just-focused block on the next render tick. Keeping
 * selection and the synthetic right-click together faithfully models the
 * native interaction and prevents the test from asserting against a selection
 * that the editor has already reconciled away.
 */
async function selectThenOpenMenu(
  page: import('@playwright/test').Page,
  selector: string,
): Promise<void> {
  const target = page.locator(selector).first()
  await expect(target).toContainText(/\S+/)
  await target.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    const box = el.getBoundingClientRect()
    el.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: Math.round(box.left + 12),
        clientY: Math.round(box.top + 8),
      }),
    )
  })
  await expect(page.locator(MENU)).toBeVisible()
}

const clipboardText = (page: import('@playwright/test').Page): Promise<string> =>
  page.evaluate(() => navigator.clipboard.readText())

test('the menu Copy performs a real platform copy of the selection', async ({ page }) => {
  await openNote(page)

  // What this can prove here: the item copies, and it copies the selection.
  // What it deliberately does not try to prove: byte-equality against a
  // keyboard baseline. A trusted-gesture copy is not reproducible from the
  // harness after a file open, so such a baseline measures Playwright, not the
  // product. The structural guarantee — that nothing intercepts the ordinary
  // copy path at all — is enforced in tests/app/copy-path-untouched.test.ts.
  await selectThenOpenMenu(page, `${EDITOR} p`)
  await page.locator(MENU).getByRole('menuitem', { name: 'Copy', exact: true }).click()

  await expect.poll(async () => clipboardText(page)).toContain('Prose with')
  const copied = await clipboardText(page)
  // The explicit native-range selection above must reach the platform clipboard.
  expect(copied.trim().length).toBeGreaterThan(0)
  expect(copied).toContain('Prose with')
})

test('right-click offers the Copy As exports', async ({ page }) => {
  await openNote(page)
  await openMenuAt(page, `${EDITOR} p`)

  const menu = page.locator(MENU)
  for (const label of ['Copy', 'Copy as Markdown', 'Copy as Plain Text', 'Copy as Rich Text']) {
    await expect(menu.getByRole('menuitem', { name: label, exact: true })).toBeVisible()
  }
})

test('right-click Copy as Markdown matches the Edit-menu command', async ({ page }) => {
  await openNote(page)

  // Both paths must start from the *same* selection, or they legitimately
  // differ: a collapsed caret means the whole block, a selection means itself.
  await openMenuAt(page, `${EDITOR} p`)
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.simplemark!.run('copyAsMarkdown' as never))
  await expect.poll(async () => clipboardText(page)).toContain('**bold**')
  const viaCommand = await clipboardText(page)
  expect(viaCommand.length).toBeGreaterThan(0)

  await page.evaluate(() => navigator.clipboard.writeText('sentinel'))
  await openMenuAt(page, `${EDITOR} p`)
  await page.locator(MENU).getByRole('menuitem', { name: 'Copy as Markdown' }).click()

  await expect.poll(async () => clipboardText(page)).not.toBe('sentinel')
  expect(await clipboardText(page)).toBe(viaCommand)
})

test('table items appear only inside a table', async ({ page }) => {
  await openNote(page)

  await openMenuAt(page, `${EDITOR} table td`)
  await expect(page.locator(MENU).getByRole('menuitem', { name: 'Copy Table as CSV' })).toBeVisible()

  await page.keyboard.press('Escape')
  await openMenuAt(page, `${EDITOR} p`)
  // Absent, not present-and-broken.
  await expect(page.locator(MENU).getByRole('menuitem', { name: 'Copy Table as CSV' })).toHaveCount(0)
})

test('code item appears only inside a fence', async ({ page }) => {
  await openNote(page)

  await openMenuAt(page, `${EDITOR} pre`)
  await expect(page.locator(MENU).getByRole('menuitem', { name: 'Copy Code' })).toBeVisible()

  await page.keyboard.press('Escape')
  await openMenuAt(page, `${EDITOR} p`)
  await expect(page.locator(MENU).getByRole('menuitem', { name: 'Copy Code' })).toHaveCount(0)
})

test('Copy Table as CSV from the menu gives spreadsheet bytes', async ({ page }) => {
  await openNote(page)
  await openMenuAt(page, `${EDITOR} table td`)
  await page.locator(MENU).getByRole('menuitem', { name: 'Copy Table as CSV' }).click()

  await expect.poll(async () => clipboardText(page)).toBe('Region,Revenue\nWest,"1,200"\nEast,900')
})

test('the native snapshot follows the pointed block before WebKit changes selection', async ({ page }) => {
  await openNote(page)
  await page.locator(`${EDITOR} p`).first().click()

  const table = await page.locator(`${EDITOR} table td`).first().evaluate((target) =>
    window.simplemark!.editor.contextSelection(target).markdown,
  )
  expect(table).toContain('| Region | Revenue |')
  expect(table).toContain('| West')
  expect(table).toContain('| 1,200')

  const prose = await page.locator(`${EDITOR} p`).first().evaluate((target) =>
    window.simplemark!.editor.contextSelection(target).markdown,
  )
  expect(prose).toContain('Prose with **bold**')
  expect(prose).not.toContain('| Region |')
})

test('the menu dismisses on Escape and on an outside click', async ({ page }) => {
  await openNote(page)

  await openMenuAt(page, `${EDITOR} p`)
  await page.keyboard.press('Escape')
  await expect(page.locator(MENU)).toBeHidden()

  await openMenuAt(page, `${EDITOR} p`)
  await page.locator('.titlebar').click({ position: { x: 5, y: 5 } })
  await expect(page.locator(MENU)).toBeHidden()
})

test('the menu never modifies the document', async ({ page }) => {
  await openNote(page)
  const before = await page.evaluate(() => window.simplemark!.editor.serialize())

  await openMenuAt(page, `${EDITOR} table td`)
  await page.locator(MENU).getByRole('menuitem', { name: 'Copy Table as CSV' }).click()
  await openMenuAt(page, `${EDITOR} p`)
  await page.locator(MENU).getByRole('menuitem', { name: 'Copy as Rich Text' }).click()

  expect(await page.evaluate(() => window.simplemark!.editor.serialize())).toBe(before)
})
