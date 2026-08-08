import { expect, test } from '@playwright/test'

/**
 * A document may not stall the main thread because it contains a lot of table.
 *
 * The shape here is taken from a real failure: a 208-page Federal Reserve Z.1
 * release converted from PDF opened in 44.7 seconds and built 169,082 DOM
 * nodes. No single table was unusual — the largest held 770 cells, the median
 * 253 — but there were 239 of them, and ProseMirror's per-cell cost is
 * superlinear. An agent writing a long generated table into a watched file
 * reaches the same cliff, so this is a document-level guard, not a PDF one.
 */

const EDITOR = '.milkdown .ProseMirror'

/** 239 tables of ~330 cells: the measured shape of the document that stalled. */
function pathologicalDocument(): string {
  const parts = ['# Statistical release\n']
  for (let t = 0; t < 239; t += 1) {
    parts.push(`## Table ${t + 1}\n`)
    parts.push('| Year | Assets | Debt | Equity | Net |')
    parts.push('| --- | --- | --- | --- | --- |')
    for (let r = 0; r < 65; r += 1) {
      parts.push(`| ${1960 + r} | ${r * 7} | ${r * 3} | ${r * 11} | ${r * 2} |`)
    }
    parts.push('')
  }
  return parts.join('\n')
}

async function openGeneratedFile(page: import('@playwright/test').Page, body: string): Promise<void> {
  await page.addInitScript((content: string) => {
    window.showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory()
      const handle = await root.getFileHandle('statistical-release.md', { create: true })
      if ((await handle.getFile()).size === 0) {
        const writable = await handle.createWritable()
        await writable.write(content)
        await writable.close()
      }
      return [handle]
    }
  }, body)
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.getByRole('button', { name: 'Open file' }).click()
}

test('a table-heavy document opens without stalling the main thread', async ({ page }) => {
  const started = Date.now()
  await openGeneratedFile(page, pathologicalDocument())
  await expect(page.locator(`${EDITOR} h1`)).toContainText('Statistical release', { timeout: 15_000 })
  const elapsed = Date.now() - started

  // Before the guard this document took ~45s and rendered every one of its
  // ~78,000 cells. The ceiling is generous on purpose: it fails on a stall,
  // not on a slow CI machine.
  expect(elapsed).toBeLessThan(8_000)

  const cells = await page.locator(`${EDITOR} td, ${EDITOR} th`).count()
  expect(cells).toBeLessThan(3_000)
})

test('deferred tables are visible as placeholders rather than silently dropped', async ({ page }) => {
  await openGeneratedFile(page, pathologicalDocument())
  await expect(page.locator(`${EDITOR} h1`)).toContainText('Statistical release', { timeout: 15_000 })

  const deferred = page.locator('.deferred-table')
  expect(await deferred.count()).toBeGreaterThan(0)
  await expect(deferred.first()).toContainText('rows')
})

test('a deferred table saves back byte-identically', async ({ page }) => {
  const body = pathologicalDocument()
  await openGeneratedFile(page, body)
  await expect(page.locator(`${EDITOR} h1`)).toContainText('Statistical release', { timeout: 15_000 })

  const saved = await page.evaluate(() => window.simplemark!.session.snapshot().markdown)
  expect(saved).toBe(body)
})
