import { expect, test } from '@playwright/test'

/**
 * APP-1 acceptance: open, edit, render, and save one real Markdown file.
 *
 * The file lives in the Origin Private File System, so the handle handed to
 * BrowserFilePort is a genuine FileSystemFileHandle whose createWritable()
 * performs real writes — the only stub is the picker itself, which needs a
 * native dialog no automation can drive. Every byte read and written goes
 * through the exact adapter code the human path uses.
 */

const EDITOR = '.milkdown .ProseMirror'

/** A copy of a real note: prose, a table, a task, and a Mermaid fence. */
const REAL_NOTE = `# Renderer taxonomy — working copy

SimpleMark renders what you paste. The taxonomy below is the working list.

| Format | Renderer | Status |
| --- | --- | --- |
| Mermaid | mermaid.js | shipped |
| SVG | sanitised inline | shipped |

- [x] recognise on paste
- [ ] DOT and KaTeX

\`\`\`mermaid
flowchart LR
  IN[Paste] --> OUT[Rendered]
\`\`\`

![SimpleMark asset](assets/simplemark-asset.svg)

Closing prose line, kept verbatim.
`

/** Seeds OPFS with the note and stubs the picker to return its handle. */
async function installRealFile(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript((content: string) => {
    window.showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory()
      const handle = await root.getFileHandle('renderers-copy.md', { create: true })
      const file = await handle.getFile()
      if (file.size === 0) {
        const w = await handle.createWritable()
        await w.write(content)
        await w.close()
      }
      return [handle]
    }
  }, REAL_NOTE)
}

/** Reads the note's current on-"disk" bytes straight from OPFS. */
function diskContent(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle('renderers-copy.md')
    return (await handle.getFile()).text()
  })
}

async function openTheFile(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.getByRole('button', { name: 'Open file' }).click()
  await expect(page.locator('.filename-title')).toHaveText('renderers-copy')
}

test.beforeEach(async ({ page }) => {
  await installRealFile(page)
})

test('opens a real file: content renders, including the Mermaid diagram', async ({ page }) => {
  await openTheFile(page)

  await expect(page.locator(`${EDITOR} h1`)).toContainText('Renderer taxonomy')
  await expect(page.locator(`${EDITOR} table`)).toBeVisible()
  await expect(page.locator('.diagram .diagram-render svg')).toBeVisible()
  await expect
    .poll(() => page.locator(`${EDITOR} img[alt="SimpleMark asset"]`).evaluate(
      (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
    ))
    .toBe(true)
})

test('a portable image reference saves to a real file and survives reopen', async ({ page }) => {
  await openTheFile(page)

  // The toolbar chooser is exercised in asset-links.spec.ts. This test uses
  // the same application editor command but focuses on the real file handle:
  // selected browser files cannot provide a persistent local path, so only a
  // deliberate portable reference is saved.
  await page.evaluate(() => window.simplemark!.editor.insertAsset({
    kind: 'image', src: 'assets/architecture.png', label: 'Architecture diagram',
  }))

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().dirty))
    .toBe(true)
  await page.evaluate(() => window.simplemark!.save())

  const onDisk = await diskContent(page)
  expect(onDisk).toContain('![Architecture diagram](assets/architecture.png)')
  expect(onDisk).not.toMatch(/file:|blob:|data:|!\[\[/)

  await openTheFile(page)
  await expect(page.getByText('File unavailable: assets/architecture.png', { exact: true })).toBeVisible()
})

test('an edit is saved to the file and survives close-and-reopen', async ({ page }) => {
  await openTheFile(page)

  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('A sentence typed into the real file.')
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().dirty))
    .toBe(true)
  await page.evaluate(() => window.simplemark!.save())

  const onDisk = await diskContent(page)
  expect(onDisk).toContain('A sentence typed into the real file.')
  // The untouched opening survives portably — no escaping, no rewrites.
  expect(onDisk).toContain('# Renderer taxonomy — working copy')
  expect(onDisk).toContain('Closing prose line, kept verbatim.')

  // Close (full reload drops all in-memory state) and reopen the same file.
  await openTheFile(page)
  await expect(page.locator(EDITOR)).toContainText('A sentence typed into the real file.')
})

test('a table edit saves and reopens as an ordinary GFM pipe table', async ({ page }) => {
  await openTheFile(page)

  const table = page.locator(`${EDITOR} table`)
  await table.locator('td').first().click()
  const controls = page.locator('.table-controls:not([hidden])')
  await expect(controls).toBeVisible()
  await controls.getByRole('button', { name: 'Table options' }).click()
  await controls.getByRole('button', { name: 'Row below' }).click()
  await controls.getByRole('button', { name: 'Table options' }).click()
  await controls.getByRole('button', { name: 'Column right', exact: true }).click()
  await table.locator('td').last().click()
  await page.keyboard.type('Saved cell')

  // The row/column operations already made the document dirty. Wait for this
  // final cell transaction specifically; merely observing dirty here lets a
  // loaded CI worker save before the typed text reaches Milkdown.
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('Saved cell')
  await page.evaluate(() => window.simplemark!.save())
  const onDisk = await diskContent(page)
  expect(onDisk).toContain('Saved cell')
  expect(onDisk).toContain('| Format')
  expect(onDisk).toMatch(/^\| [-:]+/m)
  expect(onDisk).not.toContain('colwidth')
  expect(onDisk).not.toContain('<table')

  await openTheFile(page)
  await expect(page.locator(`${EDITOR} table tr`)).toHaveCount(4)
  await expect(page.locator(`${EDITOR} table tr`).first().locator('th')).toHaveCount(4)
  await expect(page.locator(EDITOR)).toContainText('Saved cell')
  await expect(page.locator('.table-controls')).toHaveCount(1)
})

test('pasted Mermaid round-trips to the file as a portable fence', async ({ page }) => {
  await openTheFile(page)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.evaluate(() =>
    navigator.clipboard.writeText('flowchart TD\n  SAVE[Save] --> DISK[(Real file)]'),
  )
  await page.keyboard.press('ControlOrMeta+v')
  // The second rendered diagram is the readiness condition: the fence is in the
  // document. Waiting on `dirty` instead would prove nothing — the Enter above
  // already dirtied it — and it was that false gate which let this test save
  // before the paste reached the session and fail once in CI.
  await expect(page.locator('.diagram .diagram-render svg')).toHaveCount(2)

  await page.evaluate(() => window.simplemark!.save())
  const onDisk = await diskContent(page)
  expect(onDisk).toContain('```mermaid')
  expect(onDisk).toContain('SAVE[Save] --> DISK[(Real file)]')
})

test('a save issued straight after an edit writes that edit, not the one before it', async ({ page }) => {
  await openTheFile(page)

  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('Typed and saved in the same breath.')

  // Deliberately no wait for `dirty` or for the session markdown. Milkdown's
  // change listener is debounced, so a save arriving inside that window is the
  // ordinary case — Cmd+S on the last word typed, or a note switch that saves
  // on the way out. The save has to carry the editor's current document.
  await page.evaluate(() => window.simplemark!.save())

  expect(await diskContent(page)).toContain('Typed and saved in the same breath.')
})

test('cancelling the picker leaves the current document untouched', async ({ page }) => {
  await page.addInitScript(() => {
    window.showOpenFilePicker = async () => {
      throw new DOMException('The user aborted a request.', 'AbortError')
    }
  })
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)

  await page.getByRole('button', { name: 'Open file' }).click()
  await expect(page.locator('.filename-title')).toHaveText('architecture')
  await expect(page.locator(`${EDITOR} h1`)).toContainText('Fixture heading')
})

test('a browser without the native API offers the Safari-compatible open fallback', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined })
  })
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)

  const button = page.getByRole('button', { name: 'Open file' })
  await expect(button).toBeEnabled()
  await expect(button).toHaveAttribute('title', 'Open a Markdown file')
})

test('the Safari fallback opens a file and saves an explicitly downloaded replacement', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined })
  })
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open file' }).click()
  await (await chooser).setFiles({
    name: 'safari-note.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Safari document\n\nOpened without a native file handle.\n'),
  })
  await expect(page.locator('.filename-title')).toHaveText('safari-note')
  await expect(page.locator('.filename')).toContainText('Save downloads a replacement')
  await expect(page.locator(`${EDITOR} h1`)).toContainText('Safari document')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save file' }).click()
  expect((await download).suggestedFilename()).toBe('safari-note.md')
  await expect(page.locator('.status')).toContainText('Downloaded safari-note.md')
})

test('the middle-panel Open Note control uses the real file-open path', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined })
  })
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open note' }).click()
  await (await chooser).setFiles({
    name: 'middle-panel-open.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Opened from the middle panel\n\nThe same portable file path is reused.\n'),
  })

  await expect(page.locator('.filename-title')).toHaveText('middle-panel-open')
  await expect(page.locator(`${EDITOR} h1`)).toContainText('Opened from the middle panel')
})
