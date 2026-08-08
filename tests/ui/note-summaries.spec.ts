import { expect, test } from '@playwright/test'

/**
 * A summary must never reorder the note list.
 *
 * The spec names this non-negotiable, and the failure is nasty in a way a
 * screenshot would not catch: summaries land asynchronously, over a second
 * after they were asked for, so rows would shuffle under someone who is
 * already reading. `applyNoteSummary` therefore patches one span and the note
 * model in place and never repaints — repainting re-runs the sort.
 *
 * Held by construction today, which is exactly why it needs a test: nothing
 * else stops a later edit adding a `repaintNoteList()` call and quietly
 * breaking it.
 */
test.describe('note summaries', () => {
  test('replace one subtitle without reordering the list', async ({ page }) => {
    await page.goto('/?fixture=legacy')
    await page.waitForFunction(() => window.simplemark !== undefined)

    const rows = page.locator('.note-item')
    await expect(rows.first()).toBeVisible()

    const orderBefore = await rows.locator('.note-select strong').allTextContents()
    expect(orderBefore.length).toBeGreaterThan(0)

    const handle = await rows.first().getAttribute('data-note-id')
    expect(handle).not.toBeNull()

    const summary = 'A two-sentence summary. It carries the specific detail.'
    await page.evaluate(
      ([id, text]) => window.simplemark!.applyNoteSummary(id!, text!),
      [handle, summary] as const,
    )

    await expect(rows.first().locator('.note-select span').first()).toHaveText(summary)

    const orderAfter = await rows.locator('.note-select strong').allTextContents()
    expect(orderAfter).toEqual(orderBefore)
  })

  test('a summary does not make a row vanish from under a live search', async ({ page }) => {
    await page.goto('/?fixture=legacy')
    await page.waitForFunction(() => window.simplemark !== undefined)

    const rows = page.locator('.note-item')
    await expect(rows.first()).toBeVisible()

    // The sharper version of the invariant. The note-list filter matches on
    // `${title} ${preview}`, so if a summary arriving triggered a repaint, a
    // row whose old preview matched the query and whose new summary does not
    // would disappear mid-read — a worse outcome than reordering.
    const title = await rows.first().locator('.note-select strong').textContent()
    const handle = await rows.first().getAttribute('data-note-id')

    // The field is collapsed until the header enters its searching state.
    await page.locator('button.notes-action[aria-label="Search"]').first().click()
    const search = page.locator('input.workspace-search')
    await expect(search.first()).toBeVisible()
    await search.first().fill(title!.slice(0, 4))
    await expect(rows.first()).toBeVisible()
    const visibleDuringSearch = await rows.count()

    await page.evaluate(
      ([id]) => window.simplemark!.applyNoteSummary(id!, 'Nothing here matches that query.'),
      [handle] as const,
    )

    expect(await rows.count()).toBe(visibleDuringSearch)
    await expect(rows.first()).toBeVisible()
  })

  test('a long summary grows its row instead of spilling into the next', async ({ page }) => {
    await page.goto('/?fixture=legacy')
    await page.waitForFunction(() => window.simplemark !== undefined)

    const rows = page.locator('.note-item')
    await expect(rows.first()).toBeVisible()

    // The defect this catches shipped: the list was a CSS grid, and once the
    // subtitle became a clamped `-webkit-box` the auto-sized track stopped
    // counting its height. Rows stayed at their 70px minimum while their own
    // content needed 110px, so every summary overlapped the row beneath it.
    const long =
      "Total's FMP asset sync is live in production. Pads sync cleanly without " +
      'creating duplicates, operators have a review queue and health dashboard, ' +
      'and the schedule runs every 30 minutes.'

    const spills = await page.evaluate((summary) => {
      const items = [...document.querySelectorAll('.note-item')]
      items.forEach((item) => {
        const id = (item as HTMLElement).dataset['noteId']
        if (id !== undefined) window.simplemark!.applyNoteSummary(id, summary)
      })
      return items.map((item) => {
        const row = item.getBoundingClientRect()
        const content = item.querySelector('.note-select')!.getBoundingClientRect()
        return Math.round(content.bottom - row.bottom)
      })
    }, long)

    expect(spills.length).toBeGreaterThan(0)
    for (const spill of spills) expect(spill).toBeLessThanOrEqual(0)
  })

  test('a short summary makes a shorter row than a long one', async ({ page }) => {
    await page.goto('/?fixture=legacy')
    await page.waitForFunction(() => window.simplemark !== undefined)
    await expect(page.locator('.note-item').first()).toBeVisible()

    // "Adaptive to the text" in both directions: bounded above by the clamp,
    // and not padded out to a fixed height below it.
    const heights = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.note-item')]
      if (items.length < 2) return null
      const apply = (item: Element, text: string): void => {
        const id = (item as HTMLElement).dataset['noteId']
        if (id !== undefined) window.simplemark!.applyNoteSummary(id, text)
      }
      apply(items[0]!, 'Short one.')
      apply(
        items[1]!,
        "Total's FMP asset sync is live in production. Pads sync cleanly without " +
          'creating duplicates, operators have a review queue and health dashboard.',
      )
      return {
        short: Math.round(items[0]!.getBoundingClientRect().height),
        long: Math.round(items[1]!.getBoundingClientRect().height),
      }
    })

    if (heights === null) test.skip(true, 'needs at least two notes')
    expect(heights!.long).toBeGreaterThan(heights!.short)
  })

  test('a summary for a note that is not listed changes nothing', async ({ page }) => {
    await page.goto('/?fixture=legacy')
    await page.waitForFunction(() => window.simplemark !== undefined)

    const rows = page.locator('.note-item')
    await expect(rows.first()).toBeVisible()
    const before = await rows.locator('.note-select span').allTextContents()

    // A summary can arrive after its note left the collection — the request
    // was queued before the folder changed. It must be dropped, not applied
    // to whichever row happens to sit in that position now.
    await page.evaluate(() =>
      window.simplemark!.applyNoteSummary('/tmp/not-in-this-collection.md', 'Should not appear.'),
    )

    const after = await rows.locator('.note-select span').allTextContents()
    expect(after).toEqual(before)
  })
})
