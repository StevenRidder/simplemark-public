import { expect, test } from '@playwright/test'

/**
 * EDITOR-3: quiet reader preferences, folding, and temporary contents.
 *
 * The acceptance from the board task, verbatim: "actual browser UI and
 * Playwright prove theme/preferences, folding behavior, temporary contents
 * navigation, reopen persistence, and byte-safe source behavior."
 *
 * Byte safety is the recurring assertion: every one of these features is view
 * state, so the serialised Markdown must be identical before and after using
 * any of them.
 */

const editor = '.milkdown .ProseMirror'
const markdown = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.simplemark!.session.snapshot().markdown)
const serialized = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.simplemark!.editor.serialize())
test.beforeEach(async ({ page }) => {
  // Clear once, before the first navigation — addInitScript would also wipe
  // the preferences the persistence tests exist to check.
  await page.goto('/?fixture=legacy')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
})

async function openFormatPopover(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Text formatting' }).click()
  await expect(page.locator('.format-popover')).toBeVisible()
}

test.describe('reader layout preferences (D6)', () => {
  test('restores the last workspace view after reopen', async ({ page }) => {
    const run = (id: string): Promise<void> =>
      page.evaluate((command) => window.simplemark!.run(command as never), id)

    await run('showEditorOnly')
    await expect(page.locator('.workspace-body')).toHaveAttribute('data-layout', 'editor')
    await page.reload()
    await page.waitForFunction(() => window.simplemark !== undefined)
    await expect(page.locator('.workspace-body')).toHaveAttribute('data-layout', 'editor')

    await run('showNotesAndEditor')
    await expect(page.locator('.workspace-body')).toHaveAttribute('data-layout', 'notes')
    await page.reload()
    await page.waitForFunction(() => window.simplemark !== undefined)
    await expect(page.locator('.workspace-body')).toHaveAttribute('data-layout', 'notes')
  })

  test('Reader Only centers the native filename without moving it in other pane layouts', async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.dataset.shell = 'native'
      const titlebar = document.querySelector('.titlebar')
      const surface = document.querySelector('.document-surface')
      if (titlebar === null || surface === null) throw new Error('Expected the document titlebar')
      titlebar.classList.add('native-editor-head')
      surface.prepend(titlebar)
    })
    await page.evaluate(() => window.simplemark!.run('showEditorOnly'))

    const centered = await page.locator('.native-editor-head').evaluate((titlebar) => {
      const name = titlebar.querySelector('.filename')
      if (name === null) throw new Error('Expected filename')
      const titlebarBox = titlebar.getBoundingClientRect()
      const nameBox = name.getBoundingClientRect()
      return Math.abs((nameBox.left + nameBox.width / 2) - (titlebarBox.left + titlebarBox.width / 2))
    })
    expect(centered).toBeLessThan(1)

    await page.evaluate(() => window.simplemark!.run('showNotesAndEditor'))
    await expect(page.locator('.native-editor-head .filename')).toHaveCSS('position', 'static')
  })

  test('restores deliberate shell choices instead of hard-resetting the app', async ({ page }) => {
    const run = (id: string): Promise<void> =>
      page.evaluate((command) => window.simplemark!.run(command as never), id)

    await run('previewLarge')
    await run('sortByTitle')
    await run('toggleNewestOnTop')
    await run('toggleHistoryNavigation')
    await run('toggleWordCount')
    await run('toggleStatistics')
    await page.getByRole('button', { name: /Pinned\s*1/ }).click()

    await expect(page.locator('.workspace-notes')).toHaveAttribute('data-preview', 'large')
    await expect(page.locator('.history-navigation')).toBeVisible()
    await expect(page.locator('.word-count')).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Document information' })).toBeVisible()

    await page.reload()
    await page.waitForFunction(() => window.simplemark !== undefined)

    await expect(page.locator('.workspace-notes')).toHaveAttribute('data-preview', 'large')
    await expect(page.getByRole('button', { name: 'Note list options' })).toContainText('Pinned')
    await expect(page.locator('.history-navigation')).toBeVisible()
    await expect(page.locator('.word-count')).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Document information' })).toBeVisible()
    expect(await page.evaluate(() => ({
      title: window.simplemark!.commandState('sortByTitle').checked,
      newest: window.simplemark!.commandState('toggleNewestOnTop').checked,
    }))).toEqual({ title: true, newest: false })
  })

  test('Cmd zoom keeps moving from 25% through 500% and Actual Size resets it', async ({ page }) => {
    const runRepeatedly = (id: string, count: number): Promise<void> =>
      page.evaluate(({ command, repetitions }) => {
        for (let index = 0; index < repetitions; index += 1) {
          window.simplemark!.run(command as never)
        }
      }, { command: id, repetitions: count })
    const scale = () => page.evaluate(() =>
      Number(getComputedStyle(document.documentElement).getPropertyValue('--reader-scale')),
    )

    await runRepeatedly('zoomOut', 40)
    expect(await scale()).toBe(0.25)

    await runRepeatedly('zoomIn', 80)
    expect(await scale()).toBe(5)

    await runRepeatedly('actualSize', 1)
    expect(await scale()).toBe(1)
  })

  test('the browser shell leaves whole-page pinch to the browser engine', async ({ page }) => {
    const before = await markdown(page)
    const canceled = await page.locator('.window').evaluate((element) =>
      !element.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -30,
      })),
    )
    expect(canceled).toBe(false)
    expect(await page.locator('#root').evaluate((element) => getComputedStyle(element).transform)).toBe('none')
    expect(await page.evaluate(() =>
      Number(getComputedStyle(document.documentElement).getPropertyValue('--reader-scale')),
    )).toBe(1)
    expect(await markdown(page)).toBe(before)
  })

  test('Actual Size remains the reset command while the browser owns page magnification', async ({ page }) => {
    await page.evaluate(() => window.simplemark!.run('zoomIn'))
    await page.evaluate(() => window.simplemark!.run('actualSize'))
    expect(await page.evaluate(() =>
      Number(getComputedStyle(document.documentElement).getPropertyValue('--reader-scale')),
    )).toBe(1)
    expect(await page.locator('#root').evaluate((element) => getComputedStyle(element).transform)).toBe('none')
  })

  test('browser-style magnification has no app-specific reflow or counter-scale', async ({ page }) => {
    await expect(page.locator('.workspace-body')).toHaveCSS('grid-template-columns', /190px 285px/)
    await expect(page.locator('.page')).toHaveCSS('zoom', '1')
    await expect(page.locator('.workspace-folders')).toHaveCSS('transform', 'none')
    await expect(page.locator('.workspace-notes')).toHaveCSS('transform', 'none')
  })

  test('Editor Only keeps the document usable at a narrow or highly magnified viewport', async ({ page }) => {
    await page.evaluate(() => window.simplemark!.run('showEditorOnly'))
    await page.setViewportSize({ width: 500, height: 760 })

    await expect(page.locator('.workspace-body')).toHaveClass(/navigation-hidden/)
    await expect(page.locator('.document-surface')).toBeVisible()
    await expect(page.locator(editor)).toBeVisible()
  })

  test('reading width steps the column, document-level', async ({ page }) => {
    const width = async () =>
      page.locator('.page').evaluate((el) => parseFloat(getComputedStyle(el).width))
    const before = await width()

    await openFormatPopover(page)
    await page.getByRole('button', { name: 'Wide width' }).click()
    expect(await width()).toBeGreaterThan(before)

    await page.getByRole('button', { name: 'Narrow width' }).click()
    expect(await width()).toBeLessThan(before)
  })

  test('line height steps the body leading', async ({ page }) => {
    const leading = async () =>
      page.locator(editor).evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
    const before = await leading()

    await openFormatPopover(page)
    await page.getByRole('button', { name: 'Open leading' }).click()
    expect(await leading()).toBeGreaterThan(before)

    await page.getByRole('button', { name: 'Tight leading' }).click()
    expect(await leading()).toBeLessThan(before)
  })

  test('paragraph spacing steps the block rhythm', async ({ page }) => {
    const spacing = async () =>
      page
        .locator(`${editor} > p`)
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).marginBottom))
    const before = await spacing()

    await openFormatPopover(page)
    await page.getByRole('button', { name: 'Airy spacing' }).click()
    expect(await spacing()).toBeGreaterThan(before)

    await page.getByRole('button', { name: 'Compact spacing' }).click()
    expect(await spacing()).toBeLessThan(before)
  })

  test('first-line indentation applies to top-level prose only', async ({ page }) => {
    const indent = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).textIndent))

    await openFormatPopover(page)
    await page.getByRole('button', { name: 'First line indent' }).click()
    expect(await indent(`${editor} > p`)).toBeGreaterThan(0)
    // Headings never indent — this is a book convention for prose.
    expect(await indent(`${editor} h1`)).toBe(0)

    await page.getByRole('button', { name: 'None indent' }).click()
    expect(await indent(`${editor} > p`)).toBe(0)
  })

  test('preferences are reader state: the source Markdown never changes', async ({ page }) => {
    const before = await markdown(page)
    // The bridge's own serialisation is compared against its own baseline:
    // byte-for-byte source preservation is the session's contract (D7), while
    // this asserts preferences change *neither* representation.
    const beforeSerialized = await serialized(page)

    await openFormatPopover(page)
    for (const name of ['Wide width', 'Open leading', 'Airy spacing', 'First line indent', 'night background']) {
      await page.getByRole('button', { name }).click()
    }

    expect(await markdown(page)).toBe(before)
    expect(await serialized(page)).toBe(beforeSerialized)
    // And the document is not dirty — the status still says Saved.
    await expect(page.locator('.status')).toHaveAttribute('data-state', 'saved')
  })

  test('the full reader setup survives a reload', async ({ page }) => {
    await openFormatPopover(page)
    for (const name of ['night background', 'Wide width', 'Open leading', 'Airy spacing', 'First line indent']) {
      await page.getByRole('button', { name }).click()
    }

    await page.reload()
    await page.waitForFunction(() => window.simplemark !== undefined)

    await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'night')
    const variables = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return {
        width: style.getPropertyValue('--reader-width').trim(),
        leading: style.getPropertyValue('--reader-leading').trim(),
        spacing: style.getPropertyValue('--reader-para-space').trim(),
        indent: style.getPropertyValue('--reader-indent').trim(),
      }
    })
    expect(variables).toEqual({ width: '860px', leading: '1.9', spacing: '32px', indent: '1.4em' })
  })

  test('a stored pre-rename `black` theme still opens as night', async ({ page }) => {
    await page.evaluate(() =>
      window.localStorage.setItem(
        'simplemark.reader-preferences',
        JSON.stringify({ theme: 'black', family: 'serif', scale: 1 }),
      ),
    )
    await page.reload()
    await page.waitForFunction(() => window.simplemark !== undefined)
    await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'night')
  })
})

test.describe('folding', () => {
  test('a heading chevron folds the section and unfolds it, byte-safely', async ({ page }) => {
    const before = await markdown(page)
    const beforeSerialized = await serialized(page)
    const sectionParagraph = page.getByText('Fixture body paragraph before the diagram', { exact: false })
    await expect(sectionParagraph).toBeVisible()

    // The chevron is quiet: hidden until the heading is hovered.
    const heading = page.locator(`${editor} h2`, { hasText: 'Fixture section heading' })
    const chevron = heading.locator('.sm-fold-chevron')
    await expect(chevron).toHaveCSS('opacity', '0')
    await heading.hover()
    await expect(chevron).not.toHaveCSS('opacity', '0')

    await chevron.click()
    await expect(sectionParagraph).toBeHidden()
    // The heading itself stays visible, marked as folded.
    await expect(heading).toBeVisible()
    await expect(heading.locator('.sm-fold-chevron.is-folded')).toBeVisible()

    // Folding is view state only: the source is byte-identical.
    expect(await markdown(page)).toBe(before)
    expect(await serialized(page)).toBe(beforeSerialized)

    await heading.locator('.sm-fold-chevron').click()
    await expect(sectionParagraph).toBeVisible()
    expect(await serialized(page)).toBe(beforeSerialized)
  })

  test('a nested todo list folds under its parent item', async ({ page }) => {
    // Build a todo with two children through the real editor.
    await page.evaluate(() => window.simplemark!.editor.focusEnd())
    await page.keyboard.press('Enter')
    await page.keyboard.type('- [ ] parent task')
    await page.keyboard.press('Enter')
    await page.keyboard.type('child one')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await page.keyboard.type('child two')
    await expect.poll(() => markdown(page)).toContain('child two')

    const before = await markdown(page)
    const parent = page.locator(`${editor} li`, { hasText: 'parent task' }).first()
    const childOne = page.getByText('child one', { exact: true })
    await expect(childOne).toBeVisible()

    await parent.hover()
    await parent.locator('.sm-fold-chevron').first().click()
    await expect(childOne).toBeHidden()
    expect(await markdown(page)).toBe(before)

    await parent.locator('.sm-fold-chevron').first().click()
    await expect(childOne).toBeVisible()
    expect(await markdown(page)).toBe(before)
  })

  test('Fold All and Unfold All change only temporary reader state', async ({ page }) => {
    const before = await serialized(page)
    const run = (id: string): Promise<void> =>
      page.evaluate((command) => window.simplemark!.run(command as never), id)
    const section = page.getByText('Fixture body paragraph before the diagram', { exact: false })

    await run('foldAll')
    await expect(section).toBeHidden()
    expect(await serialized(page)).toBe(before)

    await run('unfoldAll')
    await expect(section).toBeVisible()
    expect(await serialized(page)).toBe(before)
  })
})

/**
 * The contents view became one tab of the document-information panel.
 *
 * EDITOR-3 shipped it as a popover that closed on navigate, because it was the
 * only view of its kind and a popover was the smallest thing that could work.
 * Statistics and contents ask temporary questions about the same document, so
 * they share a panel. What EDITOR-3 was protecting survives: the
 * panel floats over the page instead of taking a column, so the document keeps
 * its width and nothing reflows when the panel opens.
 */
test.describe('document information panel', () => {
  test('lists the headings and navigates, floating over the page', async ({ page }) => {
    await page.getByRole('button', { name: 'Contents' }).click()
    const panel = page.locator('.info-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Fixture heading' })).toBeVisible()

    const widthBefore = await page.locator(`${editor}`).evaluate((node) => node.clientWidth)
    await panel.getByRole('button', { name: 'Fixture section heading' }).click()

    // The caret landed in the heading, and the panel is still open — a person
    // navigating an outline is usually navigating it more than once.
    const selection = await page.evaluate(() => window.getSelection()?.anchorNode?.textContent)
    expect(selection).toContain('Fixture section heading')
    await expect(panel).toBeVisible()

    // Floating, not docked: the page never gave up width for it.
    const widthAfter = await page.locator(`${editor}`).evaluate((node) => node.clientWidth)
    expect(widthAfter).toBe(widthBefore)
  })

  test('Escape dismisses it; editing the document does not', async ({ page }) => {
    await page.getByRole('button', { name: 'Contents' }).click()
    const panel = page.locator('.info-panel')
    await expect(panel).toBeVisible()

    // Clicking into the document must not steal it — the panel is read while
    // editing, which is the whole reason it is a panel and not a popover.
    await page.locator(editor).click({ position: { x: 200, y: 300 } })
    await expect(panel).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
  })

  test('the tabs switch views without ever closing the panel', async ({ page }) => {
    const panel = page.locator('.info-panel')
    await page.getByRole('button', { name: 'Contents' }).click()
    await expect(panel.locator('.info-panel-title')).toHaveText('Table of Contents')

    await panel.getByRole('tab', { name: 'Statistics' }).click()
    await expect(panel.locator('.info-panel-title')).toHaveText('Statistics')

    // A segmented control is a choice, not a switch: pressing the selected
    // segment again re-selects it. Closing is the command's job, below.
    await panel.getByRole('tab', { name: 'Statistics' }).click()
    await expect(panel).toBeVisible()
  })

  test('the View command for the open view closes it; another view switches', async ({ page }) => {
    // Bear's exact menubar behaviour, exercised through the shared router the
    // macOS menubar dispatches into — the browser has no menubar to click.
    const panel = page.locator('.info-panel')
    const run = (id: string): Promise<void> => page.evaluate((command) => window.simplemark!.run(command as never), id)

    await run('toggleStatistics')
    await expect(panel.locator('.info-panel-title')).toHaveText('Statistics')

    await run('contents')
    await expect(panel.locator('.info-panel-title')).toHaveText('Table of Contents')
    await expect(panel).toBeVisible()

    await run('contents')
    await expect(panel).toBeHidden()
  })

  test('the word count travels with the styles bar and follows the document', async ({ page }) => {
    const run = (id: string): Promise<void> => page.evaluate((command) => window.simplemark!.run(command as never), id)
    const pill = page.locator('.word-count')
    await expect(pill).toBeHidden()

    await run('toggleWordCount')
    await expect(pill).toBeVisible()
    // Inside the palette, so dragging the bar takes the count with it rather
    // than leaving it to chase a moving target.
    await expect(page.locator('.styles-bar .word-count')).toBeVisible()

    const count = async (): Promise<number> => Number((await pill.innerText()).replace(/[^\d]/g, ''))
    const before = await count()
    expect(before).toBeGreaterThan(0)

    // The editor's own API, as the folding tests use. A bare click can land on
    // a rendered block that accepts no text, and then the assertion below would
    // be reporting a typing failure as a broken counter.
    await page.evaluate(() => window.simplemark!.editor.focusEnd())
    await page.keyboard.type(' one two three')

    // Prove the document took the words before asking what the pill says, so a
    // failure names which half went wrong.
    await expect.poll(() => markdown(page)).toContain('one two three')
    await expect.poll(count).toBe(before + 3)
  })

  test('statistics count the prose, not the Markdown furniture', async ({ page }) => {
    await page.getByRole('button', { name: 'Contents' }).click()
    const panel = page.locator('.info-panel')
    await panel.getByRole('tab', { name: 'Statistics' }).click()

    const words = Number(await panel.locator('.info-statistic').first().locator('strong').innerText())
    expect(words).toBeGreaterThan(0)

    // Timestamps need a file port that reports them. Named and dimmed, never a
    // fabricated date and never a blank row.
    await expect(panel.locator('.info-statistic.unavailable')).toHaveCount(2)
  })

  test('navigating to a heading hidden by a fold reveals it', async ({ page }) => {
    // Fold the H1 — the whole document below it, the H2 included, disappears.
    const h1 = page.locator(`${editor} h1`).first()
    await h1.hover()
    await h1.locator('.sm-fold-chevron').click()
    const h2 = page.locator(`${editor} h2`, { hasText: 'Fixture section heading' })
    await expect(h2).toBeHidden()

    // The outline reads the document, not the DOM, so the entry is still there.
    await page.getByRole('button', { name: 'Contents' }).click()
    await page.locator('.info-panel').getByRole('button', { name: 'Fixture section heading' }).click()

    await expect(h2).toBeVisible()
  })
})
