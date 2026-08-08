import { expect, test } from '@playwright/test'

/**
 * TOOLBAR-1: the editing commands and D6 reader typography.
 *
 * Every assertion is against the real document through the application API or
 * against computed style, never against the button's own state — a toolbar that
 * looks enabled and does nothing is exactly what EDITOR-1's acceptance forbids.
 */

const editor = '.milkdown .ProseMirror'
const markdown = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.simplemark!.session.snapshot().markdown)

test.beforeEach(async ({ page }) => {
  // Clear once, before the first navigation. addInitScript runs on *every*
  // navigation, so clearing there would wipe the preferences the reload test
  // exists to check.
  await page.goto('/?fixture=legacy')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
})

/**
 * Puts the caret at the very end of the document, reliably.
 *
 * Uses the editor's own focusEnd rather than simulated keys. Clicking the
 * canvas can land on the Mermaid NodeView, which takes a node selection and
 * silently swallows typing; `End` stops at the end of a wrapped visual line;
 * and select-all-then-collapse raced the async listener. All three produced
 * intermittent failures in different tests on different runs.
 */
async function caretAtEnd(page: import('@playwright/test').Page) {
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await expect(page.locator(editor)).toBeFocused()
}

async function selectWord(page: import('@playwright/test').Page, word: string) {
  await caretAtEnd(page)
  await page.keyboard.type(word)
  // Wait for the word to actually be in the document. Selecting before the last
  // keystroke lands shifts the selection off the word, and the command then
  // applies to the wrong range — which failed intermittently under load.
  await expect.poll(() => markdown(page)).toContain(word)
  for (let i = 0; i < word.length; i += 1) await page.keyboard.press('Shift+ArrowLeft')
}

async function openTableOptions(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Table options' }).click()
  const menu = page.locator('.table-controls-menu:not([hidden])')
  await expect(menu).toBeVisible()
  return menu
}

test.describe('inline commands reach the document', () => {
  for (const [label, word, expected] of [
    ['Italic', 'slanted', '*slanted*'],
    ['Strikethrough', 'struck', '~~struck~~'],
  ] as const) {
    test(`${label} produces ${expected}`, async ({ page }) => {
      await selectWord(page, word)
      await page.getByRole('button', { name: 'Text formatting' }).click()
      await page.locator('.format-popover').getByRole('button', { name: label, exact: true }).click()
      await expect.poll(() => markdown(page)).toContain(expected)
    })
  }
})

test('the Todo button produces a task item', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.keyboard.type('a thing to do')
  await expect.poll(() => markdown(page)).toContain('a thing to do')
  await page.getByLabel('Styles bar').getByRole('button', { name: 'Todo', exact: true }).click()

  await expect(page.locator(`${editor} li[data-item-type="task"]`)).toHaveCount(1)
  await expect.poll(() => markdown(page)).toMatch(/[-*] \[ \] a thing to do/)
})

test('the table button inserts a real table', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.getByLabel('Styles bar').getByRole('button', { name: 'Tables' }).click()

  await expect(page.locator(`${editor} table`)).toBeVisible()

  // A wholly empty table serialises to nothing, so type a cell before checking
  // the document — an empty table in the DOM is not yet a table in the file.
  await page.locator(`${editor} table th`).first().click()
  await page.keyboard.type('Take')
  await expect.poll(() => markdown(page)).toMatch(/\|\s*Take\s*\|/)
})

test('table headers keep their generous title rhythm while body rows use Reading density', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.getByLabel('Styles bar').getByRole('button', { name: 'Tables' }).click()

  const table = page.locator(`${editor} table`)
  await expect(table).toBeVisible()
  await expect(table.locator('th').first()).toHaveCSS('padding-top', '9px')
  await expect(table.locator('th').first()).toHaveCSS('padding-bottom', '9px')
  await expect(table.locator('td').first()).toHaveCSS('padding-top', '6px')
  await expect(table.locator('td').first()).toHaveCSS('padding-bottom', '6px')
})

test('table-local controls change rows, columns, and alignment as portable Markdown', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.getByLabel('Styles bar').getByRole('button', { name: 'Tables' }).click()

  const table = page.locator(`${editor} table`)
  await table.locator('th').first().click()
  await expect(table).toHaveCSS('table-layout', 'auto')
  await expect(page.getByRole('button', { name: 'Table options' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Row below' })).toBeHidden()
  const compactControl = await page.locator('.table-controls:not([hidden])').boundingBox()
  expect(compactControl?.width ?? Infinity).toBeLessThan(100)

  const rowsBefore = await table.locator('tr').count()
  await (await openTableOptions(page)).getByRole('button', { name: 'Row below' }).click()
  await expect(table.locator('tr')).toHaveCount(rowsBefore + 1)

  const cellsBefore = await table.locator('tr').first().locator('th, td').count()
  await (await openTableOptions(page)).getByRole('button', { name: 'Column right', exact: true }).click()
  await expect(table.locator('tr').first().locator('th, td')).toHaveCount(cellsBefore + 1)

  await (await openTableOptions(page)).getByRole('button', { name: 'Align right' }).click()
  await table.locator('th').first().click()
  await page.keyboard.type('Revenue')
  await expect.poll(() => markdown(page)).toContain('Revenue')
  // Alignment serializes through the regular GFM delimiter; no HTML or width
  // metadata is allowed to leak into the Markdown file.
  await expect.poll(() => markdown(page)).toMatch(/\|\s*:?-+:\s*\|/)
  await expect.poll(() => markdown(page)).not.toContain('colwidth')
})

test('table rows and columns move while the GFM header remains first', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.getByLabel('Styles bar').getByRole('button', { name: 'Tables' }).click()

  const table = page.locator(`${editor} table`)
  await table.locator('th').nth(0).click()
  await page.keyboard.type('Left')
  await table.locator('th').nth(1).click()
  await page.keyboard.type('Right')
  await table.locator('td').nth(0).click()
  await page.keyboard.type('first')
  const columns = await table.locator('tr').nth(1).locator('td').count()
  await table.locator('td').nth(columns).click()
  await page.keyboard.type('second')

  await table.locator('td').nth(columns).click()
  await (await openTableOptions(page)).getByRole('button', { name: 'Move row up' }).click()
  await expect.poll(async () => table.locator('tr').nth(1).textContent()).toContain('second')
  await expect(table.locator('tr').first()).toContainText('Left')

  await table.locator('th').nth(1).click()
  await (await openTableOptions(page)).getByRole('button', { name: 'Move column left' }).click()
  await expect.poll(async () => table.locator('th').first().textContent()).toContain('Right')
  await expect.poll(() => markdown(page)).toMatch(/\|\s*Right\s*\|\s*Left\s*\|/)
})

test('Tab from the final table cell creates a new editable GFM row', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.getByLabel('Styles bar').getByRole('button', { name: 'Tables' }).click()

  const table = page.locator(`${editor} table`)
  const rowsBefore = await table.locator('tr').count()
  await table.locator('th, td').last().click()
  await page.keyboard.press('Tab')

  await expect(table.locator('tr')).toHaveCount(rowsBefore + 1)
  await page.keyboard.type('A real next row')
  await expect.poll(() => markdown(page)).toContain('A real next row')
})

test('table controls delete structure without turning into table administration', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.getByLabel('Styles bar').getByRole('button', { name: 'Tables' }).click()

  const table = page.locator(`${editor} table`)
  await table.locator('td').first().click()
  await expect(page.getByRole('button', { name: 'Table options' })).toBeVisible()

  const rowsBefore = await table.locator('tr').count()
  await (await openTableOptions(page)).getByRole('button', { name: 'Delete row' }).click()
  await expect(table.locator('tr')).toHaveCount(rowsBefore - 1)

  const columnsBefore = await table.locator('tr').first().locator('th, td').count()
  await (await openTableOptions(page)).getByRole('button', { name: 'Delete column' }).click()
  await expect(table.locator('tr').first().locator('th, td')).toHaveCount(columnsBefore - 1)
  await (await openTableOptions(page)).getByRole('button', { name: 'Delete table' }).click()
  await expect(table).toHaveCount(0)
})

test('a table column can be width-dragged without width metadata entering Markdown', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.getByLabel('Styles bar').getByRole('button', { name: 'Tables' }).click()

  const table = page.locator(`${editor} table`)
  const cell = table.locator('th').first()
  await cell.scrollIntoViewIfNeeded()
  const box = await cell.boundingBox()
  if (box === null) throw new Error('Expected a visible table header cell')
  const before = box.width
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2)
  await expect(cell.locator('.column-resize-handle')).toBeVisible()
  await page.mouse.down()
  await page.mouse.move(box.x + box.width + 80, box.y + box.height / 2)
  await page.mouse.up()

  await expect.poll(async () => (await cell.boundingBox())?.width ?? 0).toBeGreaterThan(before + 30)
  expect(await markdown(page)).not.toContain('colwidth')
})

test('table controls select cells, bold them portably, and move the table as one block', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.getByLabel('Styles bar').getByRole('button', { name: 'Tables' }).click()

  const table = page.locator(`${editor} table`)
  const dataCells = table.locator('td')
  expect(await dataCells.count()).toBeGreaterThanOrEqual(2)
  await dataCells.nth(0).click()
  await page.keyboard.type('North')
  await dataCells.nth(1).click()
  await page.keyboard.type('Revenue')

  await dataCells.nth(0).click()
  await (await openTableOptions(page)).getByRole('button', { name: 'Select row' }).click()
  expect(await table.locator('.selectedCell').count()).toBe(
    await table.locator('tr').nth(1).locator('td').count(),
  )
  await (await openTableOptions(page)).getByRole('button', { name: 'Bold selected cells' }).click()
  await expect.poll(() => markdown(page)).toContain('**North**')
  await expect.poll(() => markdown(page)).toContain('**Revenue**')

  await (await openTableOptions(page)).getByRole('button', { name: 'Select column' }).click()
  await expect(table.locator('.selectedCell')).toHaveCount(await table.locator('tr').count())

  const before = await markdown(page)
  const tableBefore = before.indexOf('**North**')
  await (await openTableOptions(page)).getByRole('button', { name: 'Move table up' }).click()
  await expect.poll(async () => (await markdown(page)).indexOf('**North**')).toBeLessThan(tableBefore)
})

test('advanced table administration stays out of the reader menu', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.getByLabel('Styles bar').getByRole('button', { name: 'Tables' }).click()

  const table = page.locator(`${editor} table`)
  await table.locator('td').first().click()
  await openTableOptions(page)
  await expect(page.getByRole('button', { name: 'Sort selected column ascending' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Shift row down' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Move right' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Fit content' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Equal columns' })).toHaveCount(0)
})

test('the numbered list button produces an ordered list', async ({ page }) => {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.keyboard.type('first thing')
  await expect.poll(() => markdown(page)).toContain('first thing')
  await page.getByRole('button', { name: 'Text formatting' }).click()
  await page.getByRole('button', { name: 'Numbered list' }).click()

  await expect(page.locator(`${editor} ol li`)).toHaveCount(1)
  await expect.poll(() => markdown(page)).toContain('1. first thing')
})

test.describe('everyday correction controls', () => {
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    test(`Heading ${level} creates a real H${level}`, async ({ page }) => {
      const text = `heading level ${level}`
      await caretAtEnd(page)
      await page.keyboard.press('Enter')
      await page.keyboard.type(text)
      await page.getByRole('button', { name: 'Text formatting' }).click()
      await page.getByRole('button', { name: `Heading ${level}` }).click()

      await expect(page.locator(`${editor} h${level}`, { hasText: text })).toBeVisible()
      await expect.poll(() => markdown(page)).toContain(`${'#'.repeat(level)} ${text}`)
    })
  }

  test('quote, code block, and divider write normal Markdown structures', async ({ page }) => {
    await caretAtEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('quoted correction')
    await page.getByRole('button', { name: 'Text formatting' }).click()
    await page.getByRole('button', { name: 'Quote' }).click()
    await expect(page.locator(`${editor} blockquote`, { hasText: 'quoted correction' })).toBeVisible()

    await caretAtEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('const portable = true')
    await page.getByRole('button', { name: 'Code block' }).click()
    await expect(page.locator(`${editor} pre`)).toBeVisible()

    await caretAtEnd(page)
    await page.getByRole('button', { name: 'Divider' }).click()
    await expect(page.locator(`${editor} hr`)).toHaveCount(2)
    // remark may serialise the same horizontal rule as `---` or `***`
    // depending on the surrounding blockquote. Both are ordinary Markdown.
    await expect.poll(() => markdown(page)).toMatch(/^(---|\*\*\*)$/m)
  })

  test('highlight, inline code, and link stay portable in the document', async ({ page }) => {
    await selectWord(page, 'emphasized')
    await page.getByRole('button', { name: 'Text formatting' }).click()
    await page.locator('.format-popover.open').getByRole('button', { name: 'Highlight', exact: true }).click()
    await expect.poll(() => markdown(page)).toContain('==emphasized==')

    await selectWord(page, 'identifier')
    await page.getByRole('button', { name: 'Inline code' }).click()
    await expect.poll(() => markdown(page)).toContain('`identifier`')

    await caretAtEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('destination')
    for (let i = 0; i < 'destination'.length; i += 1) await page.keyboard.press('Shift+ArrowLeft')
    await page.once('dialog', (dialog) => dialog.accept('https://example.invalid/destination'))
    await page.locator('.format-popover').getByRole('button', { name: 'Link', exact: true }).click()
    await expect.poll(() => markdown(page)).toContain('[destination](https://example.invalid/destination)')
  })
})

test.describe('undo and redo', () => {
  test('the buttons undo and redo an edit', async ({ page }) => {
    await caretAtEnd(page)
    await page.keyboard.type(' BUTTON UNDO')
    await expect.poll(() => markdown(page)).toContain('BUTTON UNDO')

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => markdown(page)).not.toContain('BUTTON UNDO')

    await page.getByRole('button', { name: 'Redo' }).click()
    await expect.poll(() => markdown(page)).toContain('BUTTON UNDO')
  })

  test('Cmd+Shift+Z and Cmd+Y both redo', async ({ page }) => {
    for (const redoKey of ['ControlOrMeta+Shift+z', 'ControlOrMeta+y'] as const) {
      await caretAtEnd(page)
      await page.keyboard.type(` KEY ${redoKey}`)
      await expect.poll(() => markdown(page)).toContain(`KEY ${redoKey}`)

      await page.keyboard.press('ControlOrMeta+z')
      await expect.poll(() => markdown(page)).not.toContain(`KEY ${redoKey}`)

      await page.keyboard.press(redoKey)
      await expect.poll(() => markdown(page)).toContain(`KEY ${redoKey}`)
    }
  })
})

test.describe('reader typography is document-level (D6)', () => {
  const paper = (page: import('@playwright/test').Page) =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),
    )

  test('defaults to plain white paper', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'white')
    expect(await paper(page)).toBe('#ffffff')
  })

  test('the three backgrounds change the whole page', async ({ page }) => {
    await page.getByRole('button', { name: 'Text formatting' }).click()

    await page.getByRole('button', { name: 'night background' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'night')
    expect(await paper(page)).toBe('#0d0d0d')

    await page.getByRole('button', { name: 'white background' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'white')
    expect(await paper(page)).toBe('#ffffff')
  })

  test('tan is visibly sepia, not a white with a rumour of warmth in it', async ({ page }) => {
    // The previous tan was #fffefa, which switching to looked like nothing had
    // happened. A theme has to be visibly the thing it is named after, so this
    // pins a real colour distance rather than merely "not white".
    await page.getByRole('button', { name: 'Text formatting' }).click()
    await page.getByRole('button', { name: 'tan background' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'tan')

    const hex = await paper(page)
    const [red, green, blue] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))
    // Warm: red leads, blue trails, and the gap is wide enough to see.
    expect(red!).toBeGreaterThan(blue!)
    expect(red! - blue!).toBeGreaterThan(16)
    expect(green!).toBeGreaterThan(blue!)
  })

  test('text size steps up and down for the whole document, not a selection', async ({ page }) => {
    const size = async () =>
      page.locator(editor).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    const before = await size()

    await page.getByRole('button', { name: 'Text formatting' }).click()
    await page.getByRole('button', { name: 'Larger text' }).click()
    expect(await size()).toBeGreaterThan(before)

    await page.getByRole('button', { name: 'Smaller text' }).click()
    await page.getByRole('button', { name: 'Smaller text' }).click()
    expect(await size()).toBeLessThan(before)

    // Nothing about typography may reach the document.
    expect(await markdown(page)).not.toContain('font')
    expect(await markdown(page)).not.toContain('style=')
  })

  test('the typeface choice applies to body text', async ({ page }) => {
    await page.getByRole('button', { name: 'Text formatting' }).click()
    await page.getByRole('button', { name: 'Mono typeface' }).click()
    const family = await page.locator(editor).evaluate((el) => getComputedStyle(el).fontFamily)
    expect(family).toMatch(/Mono|Consolas|monospace/i)
  })

  test('preferences survive a reload', async ({ page }) => {
    await page.getByRole('button', { name: 'Text formatting' }).click()
    await page.getByRole('button', { name: 'night background' }).click()
    await page.getByRole('button', { name: 'Larger text' }).click()

    await page.reload()
    await page.waitForFunction(() => window.simplemark !== undefined)

    await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'night')
    const scale = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--reader-scale').trim(),
    )
    expect(Number(scale)).toBeGreaterThan(1)
  })
})

test('convert to diagram turns a Mermaid paragraph into a rendered block', async ({ page }) => {
  await expect(page.locator('.diagram')).toHaveCount(1)

  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.keyboard.type('flowchart LR')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('  A --> B')

  // Wait for the typed source to actually be in the block. Clicking Convert
  // before the last keystroke lands gives Mermaid a half-typed diagram, which
  // fails validation and correctly refuses to convert.
  await expect
    .poll(() => markdown(page))
    .toContain('A --> B')

  await page.getByLabel('Styles bar').getByRole('button', { name: 'More', exact: true }).click()
  await page.getByLabel('Styles bar').getByRole('button', { name: 'Convert to diagram' }).click()

  await expect(page.locator('.diagram')).toHaveCount(2)
  await expect.poll(() => markdown(page)).toContain('```mermaid')

  // A diagram at the terminal position remains a document, not an editing
  // dead end. This creates a paragraph only when the reader asks for one.
  await page.getByRole('button', { name: 'Click to keep writing' }).click()
  await page.keyboard.type('continued after diagram')
  await expect.poll(() => markdown(page)).toContain('continued after diagram')
})

/**
 * §4.4 rule 3, "fail visibly", for the conversion path.
 *
 * Convert runs the same validation gate as the paste sniffer, but only handled
 * a renderer that *resolves* {ok:false}. A renderer that rejected — a crash
 * inside a renderer rather than a parse failure — rejected the method, and the
 * command's `void editor?.convertBlockToDiagram()` discarded it: the user got a
 * silent no-op plus an unhandled promise rejection.
 */
async function typeMermaidParagraph(page: import('@playwright/test').Page) {
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.keyboard.type('flowchart LR')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('  A --> B')
  await expect.poll(() => markdown(page)).toContain('A --> B')
}

/**
 * Patches the renderer the editor captured, the way the paste suite does.
 *
 * This is the one renderer the whole editor shares, DiagramNodeView included —
 * and that repaints on document change with no guard of its own. Do not edit
 * the document after calling this: the fixture diagram would repaint, reject,
 * and fail a `pageerror` assertion for a reason that has nothing to do with
 * the test.
 */
async function makeRendererReject(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const milkdown = window.simplemark!.editor as unknown as {
      renderer: { render(language: string, source: string): Promise<unknown> }
    }
    milkdown.renderer.render = () => Promise.reject(new Error('renderer crashed'))
  })
}

test('a rejecting renderer refuses the conversion with a reason, rather than rejecting', async ({
  page,
}) => {
  await typeMermaidParagraph(page)
  await makeRendererReject(page)

  // Resolves — the contract the caller relies on — carrying the crash message.
  const result = await page.evaluate(async () => {
    try {
      return { settled: 'resolved', value: await window.simplemark!.editor.convertBlockToDiagram() }
    } catch (error) {
      return { settled: 'rejected', value: String(error) }
    }
  })

  expect(result.settled).toBe('resolved')
  expect(result.value).toMatchObject({ ok: false })
  expect((result.value as { reason: string }).reason).toContain('renderer crashed')

  // The block is untouched: no diagram, and the source is still a paragraph.
  await expect(page.locator('.diagram')).toHaveCount(1)
  expect(await markdown(page)).not.toContain('```mermaid\nflowchart LR\n  A --> B')
})

test('the Convert command says why out loud when the renderer crashes (§4.4)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))

  await typeMermaidParagraph(page)
  await makeRendererReject(page)

  await page.getByLabel('Styles bar').getByRole('button', { name: 'More', exact: true }).click()
  await page.getByLabel('Styles bar').getByRole('button', { name: 'Convert to diagram' }).click()

  // Visible refusal in the status area, the same channel Copy Code uses.
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'error')
  await expect(page.locator('.status')).toContainText('renderer crashed')
  await expect(page.locator('.diagram')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('a conversion that throws past the render gate still refuses quietly, not unhandled', async ({
  page,
}) => {
  // The try/catch guards the render await, but editor.action and view.dispatch
  // can throw too — and in an async method that surfaces as a rejection. The
  // caller has to hold the same guarantee the method does, or the command is
  // right back to an unhandled rejection.
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))

  await typeMermaidParagraph(page)
  await page.evaluate(() => {
    const editorApi = window.simplemark!.editor as unknown as {
      convertBlockToDiagram(): Promise<unknown>
    }
    editorApi.convertBlockToDiagram = () => Promise.reject(new Error('transaction exploded'))
  })

  await page.getByLabel('Styles bar').getByRole('button', { name: 'More', exact: true }).click()
  await page.getByLabel('Styles bar').getByRole('button', { name: 'Convert to diagram' }).click()

  await expect(page.locator('.status')).toHaveAttribute('data-state', 'error')
  await expect(page.locator('.status')).toContainText('transaction exploded')
  expect(errors).toEqual([])
})

test('a refusal reason is readable in the slot, not ellipsised away', async ({ page }) => {
  // The fixed 118px slot exists so save wording never nudges the controls, and
  // it used to clip every refusal to roughly its first fifteen characters —
  // "fail visibly" cannot survive that. Error wording is rare and transient, so
  // the slot gives it the room it needs; the title still carries the full text
  // for anything longer than even that.
  await typeMermaidParagraph(page)
  await makeRendererReject(page)

  await page.getByLabel('Styles bar').getByRole('button', { name: 'More', exact: true }).click()
  await page.getByLabel('Styles bar').getByRole('button', { name: 'Convert to diagram' }).click()

  const status = page.locator('.status')
  await expect(status).toHaveAttribute('data-state', 'error')
  await expect(status).toHaveAttribute('title', /renderer crashed/)

  // Nothing ellipsised: the slot is at least as wide as the sentence in it.
  const clipped = await status.evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(clipped).toBe(false)
})

test('the quiet gutter drag reorders document blocks through the editor transaction', async ({ page }) => {
  const h2 = page.locator(`${editor} > h2`).first()
  await expect(h2).toHaveText('Fixture section heading')
  await h2.scrollIntoViewIfNeeded()
  const previousBlock = h2.locator('xpath=preceding-sibling::*[1]')
  await expect(previousBlock).toHaveCount(1)
  const previousBox = await previousBlock.boundingBox()
  const h2Box = await h2.boundingBox()
  expect(previousBox).not.toBeNull()
  expect(h2Box).not.toBeNull()

  // The handle is a six-dot visual in the left gutter. Dragging it moves the
  // actual ProseMirror block, so the Markdown order changes too.
  const gutterX = h2Box!.x - 16
  await page.mouse.move(gutterX, h2Box!.y + 8)
  await page.mouse.down()
  await page.mouse.move(gutterX, previousBox!.y, { steps: 6 })
  await page.mouse.up()

  await expect.poll(async () => {
    const value = await markdown(page)
    return value.indexOf('## Fixture section heading') < value.indexOf('Fixture intro paragraph text for the harness.')
  }).toBe(true)
})

test('workspace controls are enabled while agent participation stays gated', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Search' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'New note' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Document list' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Work with AI' })).toBeDisabled()
  await expect(page.getByLabel('Styles bar').getByRole('button', { name: 'Insert image or link file' })).toBeEnabled()
})
