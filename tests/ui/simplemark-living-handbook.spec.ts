import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const WELCOME_SOURCE = readFileSync(
  new URL('../../docs/showcase/welcome-to-simplemark.md', import.meta.url),
  'utf8',
)
const TANOA_SOURCE = readFileSync(
  new URL('../../docs/showcase/project-tanoa-storm-atlas.md', import.meta.url),
  'utf8',
)

const WELCOME = 'Welcome to SimpleMark'
const TANOA = 'Project Tanoa: Storm Atlas'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
})

test('the default Samples catalogue opens both canonical documents', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Note list options' })).toContainText('Samples')
  await expect(page.locator('.workspace-notes .note-item')).toHaveCount(2)
  await expect(page.getByRole('heading', { name: WELCOME })).toBeVisible()

  await page.getByRole('button', { name: TANOA, exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Project Tanoa: the storm atlas' })).toBeVisible()
})

test('the handbook renders every promised technical form without a blank', async ({ page }) => {
  for (const language of ['svg', 'mermaid', 'dot']) {
    const block = page.locator('.diagram').filter({
      has: page.locator('.diagram-label', { hasText: language }),
    })
    await expect(block).toHaveCount(1)
    await expect(block.locator('.diagram-render svg')).toBeVisible({ timeout: 30_000 })
  }
  const charts = page.locator('.diagram').filter({
    has: page.locator('.diagram-label', { hasText: 'vega-lite' }),
  })
  await expect(charts).toHaveCount(2)
  await expect(charts.nth(0).locator('.diagram-render svg').first()).toBeVisible({ timeout: 30_000 })
  await expect(charts.nth(1).locator('.diagram-render svg').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.math-block .katex')).toBeVisible()
  for (const selector of ['.ansi-card', '.diff-card', '.json-card', '.tree-card', '.stack-card']) {
    await expect(page.locator(selector)).toBeVisible()
  }
  await expect(page.locator('.diagram-error:visible')).toHaveCount(0)
})

async function replaceSource(
  page: import('@playwright/test').Page,
  block: import('@playwright/test').Locator,
  before: string,
  after: string,
): Promise<void> {
  // §2 of the chip-chrome spec: Edit source lives on the selection-triggered
  // chip toolbar, not always in the DOM — select the block first, the same
  // way diagram-frame.spec.ts and project-tanoa-showcase.spec.ts already do.
  await block.locator('.diagram-render').click()
  await block.getByRole('button', { name: 'Edit source' }).click()
  const source = page.locator('.diagram-source-sheet:not([hidden]) .diagram-source')
  await source.fill((await source.inputValue()).replace(before, after))
  await page.getByRole('button', { name: 'Close source editor' }).click()
}

test('the four guided corrections visibly redraw their blocks', async ({ page }) => {
  const mermaid = page.locator('.diagram').filter({
    has: page.locator('.diagram-label', { hasText: 'mermaid' }),
  })
  await replaceSource(page, mermaid, 'Read & judge', 'Read, judge & decide')
  await expect(mermaid.locator('.diagram-render')).toContainText('Read, judge & decide')

  const charts = page.locator('.diagram').filter({
    has: page.locator('.diagram-label', { hasText: 'vega-lite' }),
  })
  const chartBefore = await charts.first().locator('svg').innerHTML()
  await replaceSource(
    page,
    charts.first(),
    '"category":"Evidence","value":18',
    '"category":"Evidence","value":24',
  )
  await expect.poll(() => charts.first().locator('svg').innerHTML()).not.toBe(chartBefore)

  const svg = page.locator('.diagram').filter({
    has: page.locator('.diagram-label', { hasText: 'svg' }),
  })
  await replaceSource(page, svg, 'fill="#ff7a66"', 'fill="#5c7cfa"')
  await expect(svg.locator('[fill="#5c7cfa"]')).toHaveCount(1)

  const math = page.locator('.diagram').filter({
    has: page.locator('.diagram-label', { hasText: 'math' }),
  })
  const mathBefore = await math.locator('.math-block .katex').innerHTML()
  await replaceSource(page, math, '\\boxed{3}', '\\boxed{4}')
  await expect.poll(() => math.locator('.math-block .katex').innerHTML()).not.toBe(mathBefore)
})

test('untouched sample saves reload the exact canonical bytes', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.save())
  await page.getByRole('button', { name: TANOA, exact: true }).click()
  await page.evaluate(() => window.simplemark!.save())
  await page.getByRole('button', { name: WELCOME, exact: true }).click()
  expect(await page.evaluate(() => window.simplemark!.session.snapshot().markdown)).toBe(WELCOME_SOURCE)
  await page.getByRole('button', { name: TANOA, exact: true }).click()
  expect(await page.evaluate(() => window.simplemark!.session.snapshot().markdown)).toBe(TANOA_SOURCE)
})
