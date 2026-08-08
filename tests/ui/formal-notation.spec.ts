import { expect, test } from '@playwright/test'

/**
 * Graphviz DOT and KaTeX math end to end: real clipboard, real ⌘V, real
 * engines (the Graphviz wasm module actually loads in the page).
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

test('pasted DOT renders as a Graphviz drawing', async ({ page }) => {
  await paste(page, 'digraph {\n  rankdir=LR\n  Paste -> Recognise -> Render\n}')

  const graph = page.locator('.diagram').last()
  await expect(graph.locator('.diagram-render svg')).toBeVisible({ timeout: 30_000 })
  await expect(graph.locator('.diagram-render')).toContainText('Recognise')
})

test('rendering a graph reaches no external host (D2: no network)', async ({ page }) => {
  const external: string[] = []
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') external.push(url.href)
    void route.continue()
  })

  await paste(page, 'digraph { wasm -> local }')
  await expect(page.locator('.diagram .diagram-render svg').last()).toBeVisible({ timeout: 30_000 })

  // The Graphviz wasm is embedded in its own lazy chunk; a CDN fetch here would
  // mean a note's content could phone home.
  expect(external).toEqual([])
})

test('pasted DOT round-trips to the file as a portable dot fence', async ({ page }) => {
  await paste(page, 'digraph { a -> b }')

  // Poll the serialised document rather than a locator: the fixture already
  // contains a Mermaid diagram, so `.last()` matches before the DOT block has
  // finished its async validate-then-convert and the assertion races the wasm.
  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.editor.serialize()), {
      timeout: 30_000,
    })
    .toContain('```dot')

  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())
  expect(markdown).toContain('digraph { a -> b }')
})

test('Mermaid still wins its own keyword — "graph LR" is not DOT', async ({ page }) => {
  await paste(page, 'graph LR\n  A --> B')
  await expect(page.locator('.diagram .diagram-render svg').last()).toBeVisible({ timeout: 30_000 })

  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())
  expect(markdown).toContain('```mermaid')
  expect(markdown).not.toContain('```dot')
})

test('a broken graph fails visibly with its source still editable', async ({ page }) => {
  // Passes the signature (keyword + braces) but Graphviz refuses it, so §4.4
  // sends it down the ordinary text path rather than showing a broken block.
  await paste(page, 'digraph { a -> -> b }')

  await expect(page.locator(EDITOR)).toContainText('digraph { a -> -> b }')
})

test('pasted $$ display math typesets with KaTeX', async ({ page }) => {
  await paste(page, '$$E = mc^2$$')

  const math = page.locator('.math-block').last()
  await expect(math).toBeVisible()
  await expect(math.locator('.katex')).toBeVisible()
})

test('a pasted LaTeX environment typesets and stores as $$', async ({ page }) => {
  await paste(page, '\\begin{aligned}\n  a &= b + c \\\\\n  d &= e\n\\end{aligned}')

  await expect(page.locator('.math-block .katex').last()).toBeVisible()
  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())
  expect(markdown).toContain('$$')
  expect(markdown).not.toContain('```math')
  expect(markdown).toContain('\\begin{aligned}')
})

test('display math stores as a portable $$ block, not a fence', async ({ page }) => {
  await paste(page, '$$\\frac{1}{2}$$')

  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())
  // Portable interchange form: $$ on its own lines, the expression between.
  expect(markdown).toMatch(/\$\$\n\\frac\{1\}\{2\}\n\$\$/)
  expect(markdown).not.toContain('```math')
})

test('malformed display math fails visibly without rewriting its source', async ({ page }) => {
  const source = '$$\\frac{broken$$'
  await paste(page, source)

  // An invalid expression may be rejected before it becomes a math node. The
  // readable fallback is then the literal expression, never a blank block.
  await expect(page.locator(EDITOR)).toContainText('\\frac{broken')

  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())
  expect(markdown).toContain('\\frac{broken')
  expect(markdown).not.toContain('```math')
})

test('a dollar amount in prose is never claimed as math', async ({ page }) => {
  await paste(page, 'The licence costs $100 and renews yearly.')

  await expect(page.locator('.math-block')).toHaveCount(0)
  await expect(page.locator(EDITOR)).toContainText('The licence costs $100')
})

test('undo restores the raw pasted text for both new formats', async ({ page }) => {
  await paste(page, '$$E = mc^2$$')
  await expect(page.locator('.math-block')).toBeVisible()

  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.math-block')).toHaveCount(0)
  await expect(page.locator(EDITOR)).toContainText('E = mc^2')
})

test('a file that already contains $$ math opens rendered, and stays $$ on save', async ({ page }) => {
  const NOTE = '# Loaded\n\nBefore.\n\n$$\n\\int_0^1 x^2 dx = \\frac{1}{3}\n$$\n\nAfter.\n'
  await page.addInitScript((content: string) => {
    window.showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory()
      const handle = await root.getFileHandle('math-note.md', { create: true })
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
  await page.getByRole('button', { name: 'Open file' }).click()
  await expect(page.locator('.filename-title')).toHaveText('math-note')

  // The parse direction: math arriving from a file, not from a paste.
  await expect(page.locator('.math-block .katex')).toBeVisible()

  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())
  expect(markdown).toContain('$$')
  expect(markdown).not.toContain('```math')
  expect(markdown).toContain('After.')
})
