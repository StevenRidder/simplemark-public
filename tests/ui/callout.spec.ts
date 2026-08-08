import { expect, test } from '@playwright/test'

/**
 * GitHub callouts, end to end. The point of the feature is portability, so the
 * assertions are about the file as much as the rendering: what goes in as
 * `> [!NOTE]` must come back out as `> [!NOTE]`.
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

test('each GitHub callout type renders as its own block', async ({ page }) => {
  await paste(
    page,
    '> [!NOTE]\n> Useful information.\n\n> [!WARNING]\n> Something to watch.\n\n> [!CAUTION]\n> Real risk here.',
  )

  await expect(page.locator(`${EDITOR} .callout-note`)).toContainText('Useful information.')
  await expect(page.locator(`${EDITOR} .callout-warning`)).toContainText('Something to watch.')
  await expect(page.locator(`${EDITOR} .callout-caution`)).toContainText('Real risk here.')
})

test('the marker is stripped from the body, not left visible', async ({ page }) => {
  await paste(page, '> [!TIP]\n> The body only.')

  const callout = page.locator(`${EDITOR} .callout-tip`)
  await expect(callout).toContainText('The body only.')
  await expect(callout).not.toContainText('[!TIP]')
})

test('hover keeps the semantic callout label intact while exposing the drag affordance separately', async ({ page }) => {
  await paste(page, '> [!TIP]\n> The body only.')

  const callout = page.locator(`${EDITOR} .callout-tip`)
  await callout.hover()
  await expect.poll(async () => callout.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element, '::after').opacity),
  )).toBeGreaterThan(0.5)
  const styles = await callout.evaluate((element) => {
    const label = getComputedStyle(element, '::before')
    const handle = getComputedStyle(element, '::after')
    return {
      label: {
        backgroundImage: label.backgroundImage,
        display: label.display,
        opacity: label.opacity,
        position: label.position,
        width: label.width,
      },
      handle: {
        opacity: handle.opacity,
        position: handle.position,
      },
    }
  })

  expect(styles.label).toMatchObject({
    backgroundImage: 'none',
    display: 'block',
    opacity: '1',
    position: 'static',
  })
  expect(Number.parseFloat(styles.label.width)).toBeGreaterThan(100)
  // Hover opacity is animated, so browsers can expose a sub-pixel-time
  // interpolated value such as 0.579771 instead of the final string 0.58.
  expect(Number.parseFloat(styles.handle.opacity)).toBeCloseTo(0.58, 2)
  expect(styles.handle.position).toBe('absolute')
})

test('text on the marker line survives', async ({ page }) => {
  await paste(page, '> [!IMPORTANT] Same line as the marker.\n> And a second line.')

  const callout = page.locator(`${EDITOR} .callout-important`)
  await expect(callout).toContainText('Same line as the marker.')
  await expect(callout).toContainText('And a second line.')
  await expect(callout).not.toContainText('[!IMPORTANT]')
})

test('a callout round-trips to the file as a portable blockquote', async ({ page }) => {
  await paste(page, '> [!NOTE]\n> Portable body.')

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.editor.serialize()))
    .toContain('[!NOTE]')

  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())
  expect(markdown).toContain('> [!NOTE]')
  expect(markdown).toContain('Portable body.')
  // No bespoke syntax leaks into the file.
  expect(markdown).not.toContain('data-callout')
  expect(markdown).not.toContain(':::')
})

test('an unknown type stays an ordinary blockquote', async ({ page }) => {
  await paste(page, '> [!DANGER]\n> Not one of GitHub five.')

  await expect(page.locator(`${EDITOR} .callout`)).toHaveCount(0)
  await expect(page.locator(`${EDITOR} blockquote`)).toContainText('[!DANGER]')
})

test('an ordinary blockquote is untouched', async ({ page }) => {
  await paste(page, '> Just a quotation, nothing special.')

  await expect(page.locator(`${EDITOR} .callout`)).toHaveCount(0)
  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())
  expect(markdown).toContain('> Just a quotation, nothing special.')
})
