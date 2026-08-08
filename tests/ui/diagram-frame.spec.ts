import { expect, test } from '@playwright/test'

/**
 * The frame around a rendered diagram: how wide it draws, and how you leave the
 * source sheet.
 *
 * Both behaviours are layout, so they can only be asserted in a browser — the
 * vitest suite runs in Node, where every element measures zero. That is exactly
 * how both defects survived: `max-width: 100%` that could only ever shrink, and
 * a sheet whose only exit was a button on the block behind it.
 */

const editor = '.milkdown .ProseMirror'
const render = '.diagram-render'

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
  await expect(page.locator(`${render} svg`).first()).toBeVisible()
})

/**
 * §2 of the chip-chrome spec: the Edit source button lives on the
 * selection-triggered chip toolbar now, not always in the DOM — select the
 * first diagram, then reach for its "Edit source" chip.
 */
async function openFirstDiagramSource(page: import('@playwright/test').Page): Promise<void> {
  await page.locator(render).first().click()
  await page.locator('.diagram-chips').first().getByRole('button', { name: 'Edit source' }).click()
}

/** Replaces the first diagram's source the way the sheet's textarea does. */
async function setSource(page: import('@playwright/test').Page, source: string) {
  await openFirstDiagramSource(page)
  const textarea = page.locator('textarea.diagram-source').first()
  await textarea.fill(source)
  // Mermaid re-renders asynchronously; the viewBox is what settles last.
  await expect
    .poll(async () =>
      page.locator(`${render} svg`).first().getAttribute('viewBox'),
    )
    .not.toBe(null)
}

async function metrics(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const box = document.querySelector('.diagram-render') as HTMLElement
    const svg = box.querySelector('svg') as SVGElement
    const viewBox = svg.getAttribute('viewBox') ?? '0 0 0 0'
    const natural = Number(viewBox.split(/[\s,]+/)[2])
    return {
      container: box.clientWidth,
      natural,
      drawn: svg.getBoundingClientRect().width,
      isWide: box.classList.contains('is-wide'),
      scrollsInside: box.scrollWidth > box.clientWidth,
      pageScrollsSideways:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
  })
}

test('a diagram that fits fills the column instead of sitting marooned in it', async ({ page }) => {
  const { container, natural, drawn, isWide } = await metrics(page)

  expect(natural).toBeLessThan(container * 1.6)
  expect(isWide).toBe(false)
  // The bug: Mermaid writes an inline `max-width` at its natural size, which
  // beats the stylesheet, so the diagram stopped short of its own column.
  expect(drawn).toBeGreaterThan(natural)
  expect(Math.abs(drawn - container)).toBeLessThan(3)
})

test('a diagram too wide to squeeze keeps its size and scrolls inside its own box', async ({ page }) => {
  const chain = [
    'flowchart LR',
    ...Array.from(
      { length: 12 },
      (_, i) => `  N${i}[Stage number ${i}] --> N${i + 1}[Stage number ${i + 1}]`,
    ),
  ].join('\n')
  await setSource(page, chain)

  await expect.poll(async () => (await metrics(page)).isWide).toBe(true)
  const { container, natural, drawn, scrollsInside, pageScrollsSideways } = await metrics(page)

  expect(natural).toBeGreaterThan(container * 1.6)
  // Legibility over fitting: shrinking this to the column gives 4px labels.
  expect(Math.abs(drawn - natural)).toBeLessThan(4)
  expect(scrollsInside).toBe(true)
  // The one rule this must not break, whatever else it does.
  expect(pageScrollsSideways).toBe(false)
})

test('the source sheet can be closed from the sheet itself', async ({ page }) => {
  const sheet = page.locator('.diagram-source-sheet')
  await openFirstDiagramSource(page)
  await expect(sheet).toBeVisible()

  await page.locator('.diagram-source-close').first().click()
  await expect(sheet).toBeHidden()
})

test('Escape still closes the sheet after the header has been dragged', async ({ page }) => {
  const sheet = page.locator('.diagram-source-sheet')
  await openFirstDiagramSource(page)
  await expect(sheet).toBeVisible()

  // Dragging moves focus off the textarea. Escape used to be bound there, so
  // from this moment on the sheet had no keyboard exit and — now that it has
  // been moved away from its block — no visible one either.
  const header = page.locator('.diagram-source-header').first()
  const box = (await header.boundingBox())!
  await page.mouse.move(box.x + 40, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 240, box.y + 180, { steps: 8 })
  await page.mouse.up()
  await expect(sheet).toHaveAttribute('data-positioned', 'true')

  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
})

test('pressing the close button does not drag the sheet out from under the pointer', async ({ page }) => {
  const sheet = page.locator('.diagram-source-sheet')
  await openFirstDiagramSource(page)
  await expect(sheet).toBeVisible()

  const before = await sheet.evaluate((el) => (el as HTMLElement).style.left)
  const close = page.locator('.diagram-source-close').first()
  const box = (await close.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 200, box.y + 200, { steps: 5 })
  await page.mouse.up()

  // Not closed: releasing away from a button is not a click, which is the
  // behaviour a button should have. The property under test is that the press
  // did not start a drag — the sheet has not moved a pixel.
  // `left` is the only witness: `data-positioned` is already true from the
  // opening placement, so it cannot tell a drag apart from a centring.
  expect(await sheet.evaluate((el) => (el as HTMLElement).style.left)).toBe(before)
  await expect(sheet).toBeVisible()
})
