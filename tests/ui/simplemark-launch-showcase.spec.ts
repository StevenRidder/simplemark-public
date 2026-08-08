import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const NAME = 'simplemark-1.0-launch-plan.md'
const NOTE = readFileSync(new URL('../../docs/showcase/simplemark-1.0-launch-plan.md', import.meta.url), 'utf8')

async function openLaunchPlan(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(({ name, markdown }: { name: string; markdown: string }) => {
    window.showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory()
      const handle = await root.getFileHandle(name, { create: true })
      const writable = await handle.createWritable()
      await writable.write(markdown)
      await writable.close()
      return [handle]
    }
  }, { name: NAME, markdown: NOTE })
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.getByRole('button', { name: 'Open file' }).click()
  await expect(page.locator('.filename-title')).toHaveText('simplemark-1.0-launch-plan')
  await expect(page.getByRole('heading', { name: 'SimpleMark 1.0' })).toBeVisible()
}

test('the exact 1.0 plan renders as an evidence-led launch document', async ({ page }) => {
  await openLaunchPlan(page)

  await expect(page.getByRole('heading', { name: 'SimpleMark 1.0' })).toBeVisible()
  await expect(page.locator('.diagram .diagram-render svg')).toHaveCount(1, { timeout: 30_000 })
  await expect(page.locator('.json-card')).toContainText('known_byte_loss_regressions')
  await expect(page.locator('.tree-card')).toContainText('RELEASE_NOTES.md')
  await expect(page.locator('.callout-warning')).toContainText('launch can slip')
  await expect(page.locator('.diagram-error:visible')).toHaveCount(0)
})

test('saving the untouched launch plan preserves every byte', async ({ page }) => {
  await openLaunchPlan(page)
  await page.evaluate(() => window.simplemark!.save())

  const saved = await page.evaluate(async (name: string) => {
    const root = await navigator.storage.getDirectory()
    return (await (await root.getFileHandle(name)).getFile()).text()
  }, NAME)
  expect(saved).toBe(NOTE)
})
