import { expect, test } from '@playwright/test'

/**
 * Paper (APP-21).
 *
 * The macOS print panel cannot be opened in a headless browser, so what is
 * provable here is the part that decides the printout's quality: the command
 * reaches the shell's print hook, and the print stylesheet turns a three-pane
 * scrolling workspace into one continuous document. `emulateMedia` applies the
 * real @media print rules, so these assertions read the same cascade a printer
 * would.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__printCalls', { value: { count: 0 }, writable: true })
    window.print = () => {
      ;(window as unknown as { __printCalls: { count: number } }).__printCalls.count += 1
    }
  })
  await page.setViewportSize({ width: 1100, height: 760 })
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
})

test('the print command is enabled and reaches the shell print hook', async ({ page }) => {
  expect(await page.evaluate(() => window.simplemark!.commandState('print').enabled)).toBe(true)

  await page.evaluate(() => window.simplemark!.run('print'))

  expect(
    await page.evaluate(
      () => (window as unknown as { __printCalls: { count: number } }).__printCalls.count,
    ),
  ).toBe(1)
})

test('printing leaves the document and drops the workspace around it', async ({ page }) => {
  await page.emulateMedia({ media: 'print' })

  for (const chrome of [
    '.titlebar',
    '.styles-bar',
    '.workspace-folders',
    '.workspace-notes',
    '.document-scroll-track',
    '.continue-writing',
  ]) {
    await expect(page.locator(chrome).first(), `${chrome} must not reach paper`).toBeHidden()
  }

  await expect(page.locator('.page')).toBeVisible()
  await expect(page.locator('.milkdown .ProseMirror')).toBeVisible()
})

test('the document scroller becomes one continuous flow instead of a clipped page', async ({ page }) => {
  // Enough content that the on-screen scroller is genuinely overflowing: this
  // is the case where a print that keeps overflow:auto emits page one only.
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>('.milkdown .ProseMirror')!
    for (let index = 0; index < 90; index += 1) {
      const paragraph = document.createElement('p')
      paragraph.textContent = `Printed line ${index + 1}: enough content to overflow one sheet.`
      editor.append(paragraph)
    }
  })

  const onScreen = await page.locator('section.editor').evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    clipped: element.scrollHeight > element.clientHeight,
  }))
  expect(onScreen.overflowY).toBe('auto')
  expect(onScreen.clipped).toBe(true)

  await page.emulateMedia({ media: 'print' })

  const onPaper = await page.locator('section.editor').evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    clipped: element.scrollHeight > element.clientHeight + 1,
  }))
  expect(onPaper.overflowY).toBe('visible')
  expect(onPaper.clipped).toBe(false)
})

test('paper is white and a fixed size, whatever the reader chose on screen', async ({ page }) => {
  await page.evaluate(() => {
    document.documentElement.dataset['readerTheme'] = 'night'
    document.documentElement.style.setProperty('--reader-scale', '1.4')
  })

  const screen = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(screen).not.toBe('rgb(255, 255, 255)')

  await page.emulateMedia({ media: 'print' })

  const paper = await page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
    scale: getComputedStyle(document.documentElement).getPropertyValue('--reader-scale').trim(),
  }))
  expect(paper.background).toBe('rgb(255, 255, 255)')
  expect(paper.ink).toBe('#1a1a1a')
  // The inline style is the reader's on-screen size; paper pins its own.
  expect(paper.scale).toBe('0.8')
})
