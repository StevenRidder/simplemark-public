import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 })
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
})

test('the middle note index scrolls independently while its header stays put', async ({ page }) => {
  const noteItems = page.locator('.note-items')
  const documentScroller = page.locator('section.editor')
  const newNote = page.getByRole('button', { name: 'New note' })

  for (let expected = 4; expected <= 14; expected += 1) {
    await newNote.click()
    await expect(noteItems.locator('.note-item')).toHaveCount(expected)
  }

  const before = await page.evaluate(() => ({
    notes: document.querySelector<HTMLElement>('.note-items')!.scrollTop,
    document: document.querySelector<HTMLElement>('section.editor')!.scrollTop,
    headerTop: document.querySelector<HTMLElement>('.notes-header')!.getBoundingClientRect().top,
  }))
  const metrics = await noteItems.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)

  await noteItems.hover()
  await page.mouse.wheel(0, 450)
  await expect.poll(() => noteItems.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

  const after = await page.evaluate(() => ({
    notes: document.querySelector<HTMLElement>('.note-items')!.scrollTop,
    document: document.querySelector<HTMLElement>('section.editor')!.scrollTop,
    headerTop: document.querySelector<HTMLElement>('.notes-header')!.getBoundingClientRect().top,
  }))
  expect(after.notes).toBeGreaterThan(before.notes)
  expect(after.document).toBe(before.document)
  expect(after.headerTop).toBe(before.headerTop)
  await expect(documentScroller).toBeVisible()
})

test('the reading indicator is proportional, tracks progress, and can be dragged', async ({ page }) => {
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>('.milkdown .ProseMirror')!
    for (let index = 0; index < 90; index += 1) {
      const paragraph = document.createElement('p')
      paragraph.textContent = `Long document line ${index + 1}: enough content to prove reading position.`
      editor.append(paragraph)
    }
  })

  const scroller = page.locator('section.editor')
  const track = page.locator('.document-scroll-track')
  const thumb = page.locator('.document-scroll-thumb')
  await expect(track).toHaveClass(/is-scrollable/)

  const initial = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('section.editor')!
    const track = document.querySelector<HTMLElement>('.document-scroll-track')!
    const thumb = document.querySelector<HTMLElement>('.document-scroll-thumb')!
    return {
      expectedThumb: Math.max(34, track.clientHeight * scroller.clientHeight / scroller.scrollHeight),
      thumbHeight: thumb.clientHeight,
      trackHeight: track.clientHeight,
    }
  })
  expect(Math.abs(initial.thumbHeight - initial.expectedThumb)).toBeLessThanOrEqual(1)
  expect(initial.thumbHeight).toBeLessThan(initial.trackHeight / 2)

  await scroller.evaluate((element) => {
    element.scrollTop = (element.scrollHeight - element.clientHeight) / 2
  })
  await expect.poll(() => thumb.evaluate((element) =>
    new DOMMatrixReadOnly(getComputedStyle(element).transform).m42,
  )).toBeGreaterThan(0)

  const beforeDrag = await scroller.evaluate((element) => element.scrollTop)
  const box = await thumb.boundingBox()
  if (box === null) throw new Error('Expected a visible document scroll thumb')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 80)
  await page.mouse.up()
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(beforeDrag)
})
