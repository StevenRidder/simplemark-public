import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const NOTE_NAME = 'project-tanoa.md'
const NOTE = readFileSync(new URL('../../docs/showcase/project-tanoa.md', import.meta.url), 'utf8')
const JSON_FLOOR = '"reserve_floor": 0.42'

async function installFile(
  page: import('@playwright/test').Page,
  content = NOTE,
): Promise<void> {
  await page.addInitScript(({ name, markdown }: { name: string; markdown: string }) => {
    window.showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory()
      const handle = await root.getFileHandle(name, { create: true })
      const writable = await handle.createWritable()
      await writable.write(markdown)
      await writable.close()
      return [handle]
    }
  }, { name: NOTE_NAME, markdown: content })
}

async function openFile(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.getByRole('button', { name: 'Open file' }).click()
  await expect(page.locator('.filename-title')).toHaveText('project-tanoa')
}

function diskContent(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(async (name: string) => {
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle(name)
    return (await handle.getFile()).text()
  }, NOTE_NAME)
}

test('the exact Project Tanoa report renders every decision artifact without an error', async ({
  page,
}) => {
  await installFile(page)
  await openFile(page)

  await expect(page.getByRole('heading', { name: 'Holding the island through the storm' })).toBeVisible()
  await expect(page.locator('.diagram .diagram-render svg')).toHaveCount(4, { timeout: 30_000 })
  await expect(page.locator('.math-block .katex')).toHaveCount(3)
  await expect(page.locator('.ansi-card')).toContainText('SHORT BY 1.8 h')
  await expect(page.locator('.json-card')).toContainText('0.42')
  await expect(page.locator('.callout-warning')).toContainText('wrong promise')
  await expect(page.locator('.callout-tip')).toContainText('island is holding')
  await expect(page.getByText('simplemark-showcase:', { exact: false })).toHaveCount(0)
  await expect(page.locator('.diagram-error:visible')).toHaveCount(0)
})

test('saving the untouched Project Tanoa report preserves its exact bytes', async ({ page }) => {
  await installFile(page)
  await openFile(page)

  await page.evaluate(() => window.simplemark!.save())

  expect(await diskContent(page)).toBe(NOTE)
})

test('the recorder correction changes only the JSON floor and persists through save', async ({
  page,
}) => {
  expect(NOTE.match(new RegExp(JSON_FLOOR.replace('.', '\\.'), 'g'))).toHaveLength(1)
  const beforeCorrection = NOTE.replace(JSON_FLOOR, '"reserve_floor": 0.35')
  await installFile(page, beforeCorrection)
  await openFile(page)

  const json = page.locator('.diagram').filter({ has: page.locator('.diagram-label', { hasText: 'json' }) })
  await json.locator('.diagram-render').click()
  await json.getByRole('button', { name: 'Edit source' }).click()
  const source = page.locator('.diagram-source-sheet:not([hidden]) .diagram-source')
  await expect(source).toHaveValue(/"reserve_floor": 0\.35/u)
  await source.fill((await source.inputValue()).replace('"reserve_floor": 0.35', JSON_FLOOR))
  await page.getByRole('button', { name: 'Close source editor' }).click()

  await expect(json.locator('.json-card')).toContainText('0.42')
  await page.evaluate(() => window.simplemark!.save())
  const saved = await diskContent(page)
  expect(saved).toContain(JSON_FLOOR)
  expect(saved).toContain('reserve_floor .............. 0.35')
})
