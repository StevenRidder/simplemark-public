import { expect, test } from '@playwright/test'

/**
 * EDITOR-10 acceptance: browser interaction proof for the export commands.
 *
 * These drive the real command router and the real clipboard port, then read
 * the platform clipboard back — so a passing test means the bytes a person
 * would paste into Excel or Gmail are the bytes asserted here.
 */

const EDITOR = '.milkdown .ProseMirror'

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
      const handle = await root.getFileHandle('quarterly.md', { create: true })
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
  await expect(page.locator('.filename-title')).toHaveText('quarterly')
}

const clipboardText = (page: import('@playwright/test').Page): Promise<string> =>
  page.evaluate(() => navigator.clipboard.readText())

/**
 * Shell clipboard commands intentionally start an asynchronous platform write.
 * Assert the bytes only after that write has settled; reading immediately can
 * observe the previous system clipboard contents on a loaded CI runner.
 */
async function expectClipboard(
  page: import('@playwright/test').Page,
  expected: string,
): Promise<void> {
  await expect.poll(async () => clipboardText(page)).toBe(expected)
}

/**
 * Puts the caret inside the element, waits for ProseMirror to actually own that
 * selection, then runs a registry command.
 *
 * The wait is load-bearing. A click and the selection update are not the same
 * tick, so running the command immediately reads whichever block the caret was
 * in *before* — every export then silently copies the wrong thing.
 */
async function caretInThenRun(
  page: import('@playwright/test').Page,
  selector: string,
  command: string,
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
  await page.evaluate((id) => window.simplemark!.run(id as never), command)
}

test('Copy Table as CSV gives a spreadsheet exactly what it expects', async ({ page }) => {
  await openNote(page)
  await caretInThenRun(page, `${EDITOR} table td`, 'copyTableAsCsv')

  await expectClipboard(page, 'Region,Revenue\nWest,"1,200"\nEast,900')
})

test('Copy Table as Markdown keeps the portable pipe table', async ({ page }) => {
  await openNote(page)
  await caretInThenRun(page, `${EDITOR} table td`, 'copyTableAsMarkdown')

  await expect.poll(async () => clipboardText(page)).toContain('| Region')
  const md = await clipboardText(page)
  expect(md).toContain('| Region')
  expect(md).toContain('| West')
})

test('Copy Code gives the fence body without the backticks', async ({ page }) => {
  await openNote(page)
  await caretInThenRun(page, `${EDITOR} pre`, 'copyCode')

  await expectClipboard(page, 'const total = 2100')
})

test('Copy as Plain Text strips Markdown punctuation but keeps the words', async ({ page }) => {
  await openNote(page)
  await caretInThenRun(page, `${EDITOR} p`, 'copyAsPlainText')

  await expect.poll(async () => clipboardText(page)).toContain('Prose with bold and a link')
  const text = await clipboardText(page)
  expect(text).toContain('Prose with bold and a link')
  expect(text).not.toContain('**')
  expect(text).not.toContain('https://example.com')
})

test('Copy as Markdown keeps the source form', async ({ page }) => {
  await openNote(page)
  await caretInThenRun(page, `${EDITOR} p`, 'copyAsMarkdown')

  await expect.poll(async () => clipboardText(page)).toContain('**bold**')
  const md = await clipboardText(page)
  expect(md).toContain('**bold**')
  expect(md).toContain('[link](https://example.com)')
})

test('Copy Code on a paragraph refuses visibly instead of copying nonsense', async ({ page }) => {
  await openNote(page)
  await caretInThenRun(page, `${EDITOR} p`, 'copyCode')

  await expect(page.locator('.status')).toHaveAttribute('data-state', 'error')
  await expect(page.locator('.status')).toContainText('needs a code block')
})

test('copying never modifies the document', async ({ page }) => {
  await openNote(page)
  const before = await page.evaluate(() => window.simplemark!.editor.serialize())

  await caretInThenRun(page, `${EDITOR} table td`, 'copyTableAsCsv')
  await caretInThenRun(page, `${EDITOR} pre`, 'copyCode')
  await caretInThenRun(page, `${EDITOR} p`, 'copyAsRichText')

  const after = await page.evaluate(() => window.simplemark!.editor.serialize())
  expect(after).toBe(before)
  await expect(page.locator('.status')).not.toHaveAttribute('data-state', 'dirty')
})

test('Paste as Plain Text inserts characters, not parsed Markdown', async ({ page }) => {
  await openNote(page)
  await page.evaluate(() => navigator.clipboard.writeText('# Not a heading **not bold**'))
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.evaluate(() => window.simplemark!.run('pasteAsPlainText' as never))

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.editor.serialize()))
    .toContain('Not a heading')

  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())
  // The literal characters survive; the syntax was escaped rather than parsed.
  expect(markdown).not.toMatch(/^# Not a heading/m)
})
