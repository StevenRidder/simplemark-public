import { expect, test } from '@playwright/test'

const EDITOR = '.milkdown .ProseMirror'

/**
 * The converted federal report that exposed BUG-3 had 239 tables and about
 * 76,000 cells. This synthetic file has the same failure shape without making
 * a user download fixture part of the repository: 100 tables × 804 cells.
 */
function generatedReport(): string {
  const tables = Array.from({ length: 100 }, (_, tableIndex) => {
    const header = '| Quarter | Revenue | Costs | Margin |'
    const delimiter = '| --- | --- | --- | --- |'
    const rows = Array.from(
      { length: 200 },
      (_, row) => `| report-${tableIndex}-${row}-0 | report-${tableIndex}-${row}-1 | report-${tableIndex}-${row}-2 | report-${tableIndex}-${row}-3 |`,
    )
    return `## Table ${tableIndex + 1}\n\n${header}\n${delimiter}\n${rows.join('\n')}`
  })
  return `# Generated financial report\n\nThis report deliberately contains many wide data tables.\n\n${tables.join('\n\n')}\n\nClosing prose remains editable.\n`
}

const REPORT = generatedReport()

test('opens a table-heavy Markdown file promptly without losing its source', async ({ page }) => {
  test.setTimeout(15_000)
  await page.addInitScript((content: string) => {
    const file = new File([content], 'generated-financial-report.md', { type: 'text/markdown' })
    const handle = {
      name: 'generated-financial-report.md',
      getFile: async () => file,
      createWritable: async () => ({ write: async () => undefined, close: async () => undefined }),
    }
    window.showOpenFilePicker = async () => [handle as unknown as FileSystemFileHandle]
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.largeTableCopy = text
        },
      },
    })
  }, REPORT)

  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)

  const startedAt = Date.now()
  await page.getByRole('button', { name: 'Open file' }).click()
  await expect(page.locator('.filename-title')).toHaveText('generated-financial-report')
  await expect(page.locator(`${EDITOR} h1`)).toContainText('Generated financial report')
  await expect(page.locator('[data-deferred-table]')).toHaveCount(98)
  const firstVirtualTable = page.locator('[data-deferred-table]').first()
  await firstVirtualTable.scrollIntoViewIfNeeded()
  await expect(firstVirtualTable.locator('.virtual-markdown-table')).toHaveCount(1)
  expect(Date.now() - startedAt).toBeLessThan(8_000)

  // Two normal tables remain interactive; each virtual table owns only a
  // viewport-sized row window, never the full 80,000-cell document at once.
  const renderedCells = await page.locator(`${EDITOR} td, ${EDITOR} th`).count()
  expect(renderedCells).toBeGreaterThan(1_608)
  expect(renderedCells).toBeLessThan(2_100)

  // The full first deferred table is present to read, not replaced by a card:
  // scrolling its own viewport reveals its final source row without inflating
  // the other ninety-seven tables into the DOM.
  const firstViewport = firstVirtualTable.locator('.virtual-table-scroll')
  await firstViewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight
    element.dispatchEvent(new Event('scroll'))
  })
  await expect(firstVirtualTable).toContainText('report-2-199-0')

  await firstVirtualTable.getByRole('button', { name: 'Copy table Markdown' }).click()
  await expect(firstVirtualTable.getByRole('button')).toHaveText('Copied table Markdown')
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.largeTableCopy)).toContain(
    'report-2-199-0',
  )
  await expect
    .poll(() => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toBe(REPORT)

  // Scrolling through the report must not leave a row window mounted for
  // every table previously visited.  Only the reader's nearby tables may
  // own DOM cells at once.
  const lastVirtualTable = page.locator('[data-deferred-table]').last()
  await lastVirtualTable.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await expect(lastVirtualTable.locator('.virtual-markdown-table')).toHaveCount(1)
  await expect
    .poll(() => page.locator('.virtual-markdown-table').count())
    .toBeLessThan(8)
  await expect
    .poll(() => page.locator(`${EDITOR} td, ${EDITOR} th`).count())
    .toBeLessThan(2_200)

  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('A safe edit after opening.')
  await expect
    .poll(() => page.evaluate(() => window.simplemark!.session.snapshot().markdown))
    .toContain('A safe edit after opening.')
  const savedMarkdown = await page.evaluate(() => window.simplemark!.session.snapshot().markdown)

  // The table source is still carried by the application document rather than
  // being replaced by the safe-renderer marker on the next user transaction.
  expect(savedMarkdown).toContain('| report-99-199-0 | report-99-199-1 | report-99-199-2 | report-99-199-3 |')
  expect(savedMarkdown).not.toContain('simplemark-deferred-table-v1:')
})
