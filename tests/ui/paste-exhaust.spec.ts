import { expect, test } from '@playwright/test'

/**
 * The paste-exhaust tier end to end: real clipboard, real ⌘V, real renderers.
 * Each test starts on a fresh page so the paste lands at a clean block
 * boundary (and to stay clear of the BUG-2 trailing-block trap).
 */

const EDITOR = '.milkdown .ProseMirror'

async function paste(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.evaluate((t) => navigator.clipboard.writeText(t), text)
  await page.keyboard.press('ControlOrMeta+v')
}

test('a pasted Excel/Sheets grid becomes a real table, not text with tabs', async ({ page }) => {
  await paste(page, 'Region\tRevenue\nWest\t1200\nEast\t900')

  const table = page.locator(`${EDITOR} table`).last()
  await expect(table).toContainText('Region')
  await expect(table).toContainText('1200')
  // And it serializes as GFM, portable anywhere. Cell padding is the
  // serializer's own normalisation (FIDELITY-1), so match with whitespace.
  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())
  expect(markdown).toMatch(/\| West\s*\| 1200\s*\|/)
})

test('a pasted unified diff renders as a coloured review view', async ({ page }) => {
  await paste(page, 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n-const a = 1\n+const a = 2')

  await expect(page.locator('.diff-card .diff-add')).toContainText('const a = 2')
  await expect(page.locator('.diff-card .diff-del')).toContainText('const a = 1')
})

test('a pasted ANSI capture renders coloured, not as escape soup', async ({ page }) => {
  await paste(page, '[32m✓ 56 passed[0m\n[31m✗ 1 failed[0m')

  // The 16 base colours resolve to theme variables, not fixed classes, so a
  // terminal green stays legible on both reader grounds (RENDERERS.md rule 3).
  await expect(page.locator('.ansi-card span[style*="--ansi-2"]')).toContainText('✓ 56 passed')
  await expect(page.locator('.ansi-card span[style*="--ansi-1"]')).toContainText('✗ 1 failed')
})

test('pasted JSON becomes a collapsible tree', async ({ page }) => {
  await paste(page, '{"service": "simplemark", "checks": [{"name": "gate", "ok": true}]}')

  const card = page.locator('.json-card')
  await expect(card.locator('summary').first()).toBeVisible()
  await expect(card).toContainText('"service"')
  await expect(card).toContainText('"gate"')
})

test('a pasted file tree keeps its box-drawing alignment in a card', async ({ page }) => {
  await paste(page, 'src\n├── app\n│   └── browser.ts\n└── domain\n    └── index.ts')

  await expect(page.locator('.tree-card')).toContainText('├── app')
})

test('a pasted stack trace collapses behind its first line', async ({ page }) => {
  await paste(page, 'Error: save failed\n    at save (document-session.ts:41:11)\n    at autosave (bootstrap.ts:80:9)')

  const card = page.locator('.stack-card')
  await expect(card.locator('summary')).toContainText('Error: save failed')
  // Frames exist but are folded until asked for.
  await expect(card.locator('pre')).toContainText('document-session.ts:41:11')
  await card.locator('summary').click()
})

test('prose is never claimed by the exhaust tier', async ({ page }) => {
  await paste(page, 'The error at hand is boring - a plain sentence with a dash.')

  await expect(page.locator('.text-card')).toHaveCount(0)
  await expect(page.locator(EDITOR)).toContainText('a plain sentence with a dash')
})

test('undo restores the raw pasted text (§4.3), exhaust tier included', async ({ page }) => {
  await paste(page, 'diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b')
  await expect(page.locator('.diff-card')).toBeVisible()

  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.diff-card')).toHaveCount(0)
  await expect(page.locator(EDITOR)).toContainText('diff --git a/x b/x')
})
