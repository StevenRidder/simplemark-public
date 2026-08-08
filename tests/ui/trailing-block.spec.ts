import { expect, test } from '@playwright/test'

/**
 * BUG-2 regression: a document whose last node is a rendered block must not
 * trap the caret inside that block's source.
 *
 * The corruption this prevents is real — a heading pasted "at the end" was
 * being appended to the Mermaid source, silently breaking the diagram and
 * writing the heading into the file as diagram code.
 */

const EDITOR = '.milkdown .ProseMirror'

/** Leaves the document ending in a rendered Mermaid diagram. */
async function endWithDiagram(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.evaluate(() => navigator.clipboard.writeText('flowchart LR\n  A[One] --> B[Two]'))
  await page.keyboard.press('ControlOrMeta+v')
  await expect(page.locator('.diagram .diagram-render svg').last()).toBeVisible({ timeout: 30_000 })
}

const lastNodeType = (page: import('@playwright/test').Page): Promise<string | undefined> =>
  page.evaluate(
    () =>
      (
        document.querySelector('.milkdown .ProseMirror') as HTMLElement & {
          pmViewDesc?: { node: { lastChild?: { type: { name: string } } } }
        }
      ).pmViewDesc?.node.lastChild?.type.name,
  )

test('pasting after a terminal diagram creates a new block, never diagram source', async ({
  page,
}) => {
  await endWithDiagram(page)
  expect(await lastNodeType(page)).toBe('code_block')

  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.evaluate(() =>
    navigator.clipboard.writeText('# A heading that must not land inside the diagram'),
  )
  await page.keyboard.press('ControlOrMeta+v')

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.editor.serialize()))
    .toContain('# A heading that must not land inside the diagram')

  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())
  // The diagram's source ends where it should — the heading is outside the fence.
  expect(markdown).toMatch(/A\[One\] --> B\[Two\]\n```/)
  expect(markdown).not.toMatch(/A\[One\][\s\S]*heading that must not land[\s\S]*```/)
})

test('typing after a terminal diagram writes prose, not diagram source', async ({ page }) => {
  await endWithDiagram(page)

  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.type('Ordinary prose after the diagram.')

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.editor.serialize()))
    .toContain('Ordinary prose after the diagram.')

  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())
  expect(markdown).toMatch(/```\n\nOrdinary prose after the diagram\./)
})

test('merely opening a document ending in a diagram changes nothing', async ({ page }) => {
  await endWithDiagram(page)
  const before = await page.evaluate(() => window.simplemark!.editor.serialize())

  // Reload and re-open the same content; no unsolicited trailing paragraph.
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  const fixture = await page.evaluate(() => window.simplemark!.editor.serialize())

  expect(before.endsWith('```\n')).toBe(true)
  expect(fixture).not.toMatch(/\n\n\n$/)
})

test('the caret lands after the diagram, not inside it', async ({ page }) => {
  await endWithDiagram(page)
  await page.evaluate(() => window.simplemark!.editor.focusEnd())

  const insideCode = await page.evaluate(() => {
    const view = (
      document.querySelector('.milkdown .ProseMirror') as HTMLElement & {
        pmViewDesc?: { node: unknown }
      }
    ).pmViewDesc
    if (view === undefined) return null
    const sel = window.getSelection()
    const node = sel?.anchorNode
    const el = node instanceof Element ? node : node?.parentElement
    return el?.closest('.diagram-source, pre, code') !== null && el?.closest('.diagram') !== null
  })

  expect(insideCode).toBe(false)
  await expect(page.locator(EDITOR)).toBeFocused()
})
