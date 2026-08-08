import { expect, test } from '@playwright/test'

/**
 * Vega-Lite charts end to end (EDITOR-17): real clipboard, real ⌘V, the real
 * library loading in the page.
 *
 * The one thing these tests cannot check is the packaged CSP — Playwright does
 * not enforce it, which is exactly how a chart could pass here and render blank
 * in the installed app. That check lives in the packaged-build evidence.
 */

const EDITOR = '.milkdown .ProseMirror'

const CHART = JSON.stringify(
  {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: {
      values: [
        { slot: 'one', hit: 94 },
        { slot: 'two', hit: 72 },
      ],
    },
    mark: 'bar',
    encoding: {
      x: { field: 'slot', type: 'ordinal' },
      y: { field: 'hit', type: 'quantitative' },
    },
  },
  null,
  2,
)

async function paste(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.evaluate((t) => navigator.clipboard.writeText(t), text)
  await page.keyboard.press('ControlOrMeta+v')
}

test('a pasted chart spec renders as a chart', async ({ page }) => {
  await paste(page, CHART)

  const chart = page.locator('.diagram').last()
  await expect(chart.locator('.diagram-render svg')).toBeVisible({ timeout: 30_000 })
  await expect(chart.locator('.diagram-render')).toContainText('one')
})

test('a pasted chart round-trips to the file as a portable vega-lite fence', async ({ page }) => {
  await paste(page, CHART)

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.editor.serialize()), {
      timeout: 30_000,
    })
    .toContain('```vega-lite')

  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())
  expect(markdown).toContain('vega-lite/v6.json')
})

test('rendering a chart reaches no external host (D2: no network)', async ({ page }) => {
  const external: string[] = []
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') external.push(url.href)
    void route.continue()
  })

  await paste(page, CHART)
  await expect(page.locator('.diagram .diagram-render svg').last()).toBeVisible({ timeout: 30_000 })

  // The `$schema` URL is a declaration, not a fetch. If this list is ever
  // non-empty, a note's content is phoning home.
  expect(external).toEqual([])
})

test('a note with no chart never downloads the chart library', async ({ page }) => {
  const chunks: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    // The library itself, not SimpleMark's own adapter modules — the dev
    // server serves those unbundled, so a bare /vega/i match would flag two
    // small source files and hide the thing actually worth asserting.
    if (/vega/i.test(url) && /node_modules|\/assets\//.test(url)) chunks.push(url)
  })

  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.locator(EDITOR).click()
  await page.keyboard.type('An ordinary note with no chart in it.')

  // ~800 KB that a chartless note must not pay for (RENDERERS.md §7).
  expect(chunks).toEqual([])
})

const REMOTE_CHART = JSON.stringify({
  $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
  data: { url: 'https://vega.github.io/data/cars.json' },
  mark: 'point',
  encoding: { x: { field: 'Horsepower', type: 'quantitative' } },
})

test('a chart in the file asking for a remote file says so rather than drawing empty axes', async ({
  page,
}) => {
  // Arrives as a fence through the Markdown path, which is how a chart that is
  // already in a note reaches the renderer — as opposed to the paste path,
  // covered below.
  await paste(page, '```vega-lite\n' + REMOTE_CHART + '\n```')

  const chart = page.locator('.diagram').last()
  await expect(chart.locator('.diagram-error')).toBeVisible({ timeout: 30_000 })
  await expect(chart.locator('.diagram-error')).toContainText('Remote data is not loaded')
})

test('pasting a remote-data chart leaves the text alone rather than converting it', async ({
  page,
}) => {
  await paste(page, REMOTE_CHART)

  // §4.4: conversion requires a successful render. This one cannot render, so
  // the paste stays as text rather than planting a permanent error card in the
  // document. Silence here would be a chart-shaped hole; text is honest.
  // Poll: the fallback happens a tick after the async render refuses, so
  // reading the document straight after ⌘V races the decision.
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.editor.serialize()), {
      timeout: 30_000,
    })
    .toContain('cars.json')

  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())
  expect(markdown).not.toContain('```vega-lite')
})
