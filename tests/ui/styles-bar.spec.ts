import { expect, test } from '@playwright/test'

const editor = '.milkdown .ProseMirror'
const markdown = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.simplemark!.session.snapshot().markdown)

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=legacy')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.locator(editor)).toBeVisible()
})

async function selectNewWord(page: import('@playwright/test').Page, text: string) {
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.type(text)
  await expect.poll(() => markdown(page)).toContain(text)
  for (let index = 0; index < text.length; index += 1) await page.keyboard.press('Shift+ArrowLeft')
}

async function freshLine(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type(text)
}

async function chooseListNested(bar: import('@playwright/test').Locator, group: string, item: string): Promise<void> {
  await bar.getByRole('button', { name: 'Lists', exact: true }).click()
  const menu = bar.locator('.styles-menu.open')
  await menu.locator('.styles-nested-trigger').filter({ hasText: group }).hover()
  await menu.locator('.styles-nested-menu').getByRole('button', { name: item, exact: true }).click()
}

async function chooseMore(bar: import('@playwright/test').Locator, name: string): Promise<void> {
  await bar.getByRole('button', { name: 'More', exact: true }).click()
  await bar.locator('.styles-menu.open').getByRole('button', { name, exact: true }).click()
}

test('the styles bar is quiet, ordered, and its commands edit ordinary Markdown', async ({ page }) => {
  const bar = page.getByLabel('Styles bar')
  await expect(bar).toBeVisible()
  await expect(bar.locator(':scope > *').evaluateAll((items) =>
    items.map((item) => item.matches('button')
      ? item.getAttribute('aria-label')
      : item.querySelector('button')?.getAttribute('aria-label')),
  )).resolves.toEqual([
    'Move formatting palette', 'Headers', 'Todo', 'Lists', 'Bold', 'Italic', 'Highlight', 'Link', 'Tables', 'Insert image or link file', 'More', 'Text formatting',
  ])

  const geometry = await bar.evaluate((element) => {
    const style = getComputedStyle(element)
    const buttons = [...element.querySelectorAll(':scope > button, :scope > div > button')]
    return {
      position: style.position,
      bottom: style.bottom,
      radius: style.borderRadius,
      size: [element.getBoundingClientRect().width, element.getBoundingClientRect().height],
      buttonSizes: buttons.map((button) => {
        const rect = button.getBoundingClientRect()
        return [rect.width, rect.height]
      }),
    }
  })
  expect(geometry).toEqual({
    position: 'absolute',
    bottom: '18px',
    radius: '11px',
    size: [436, 33],
    buttonSizes: [
      [17, 29], [39, 29], [31, 29], [39, 29], [31, 29], [31, 29],
      [39, 29], [31, 29], [31, 29], [31, 29], [31, 29], [31, 29],
    ],
  })

  const opticalDetails = await bar.evaluate((element) => {
    const headingTrigger = element.querySelector<HTMLElement>('.styles-menu-headers > .styles-menu-trigger')!
    const disclosure = headingTrigger.querySelector<HTMLElement>('.styles-disclosure')!
    const boldIcon = element.querySelector<HTMLElement>('.styles-strong svg')!
    return {
      headingGap: getComputedStyle(headingTrigger).columnGap,
      headingDisclosureMargin: getComputedStyle(disclosure).marginLeft,
      boldStroke: getComputedStyle(boldIcon).strokeWidth,
    }
  })
  expect(opticalDetails).toEqual({
    headingGap: '0px',
    headingDisclosureMargin: '-2px',
    boldStroke: '2.4px',
  })

  await selectNewWord(page, 'calm controls')
  await bar.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect.poll(() => markdown(page)).toContain('**calm controls**')

  // Reader chrome must not become a document feature.
  const afterBold = await markdown(page)
  await page.getByRole('button', { name: 'Text formatting' }).click()
  await page.getByRole('button', { name: 'Hide styles bar', exact: true }).click()
  await expect(bar).toBeHidden()
  await expect.poll(() => markdown(page)).toBe(afterBold)

  await page.getByRole('button', { name: 'Show styles bar', exact: true }).click()
  await expect(bar).toBeVisible()
})

test('every styles-bar menu mirrors Bear and every visible command is available', async ({ page }) => {
  const bar = page.getByLabel('Styles bar')
  const headersTrigger = bar.getByRole('button', { name: 'Headers', exact: true })

  await headersTrigger.focus()
  await headersTrigger.press('ArrowDown')
  await expect(bar.getByRole('button', { name: 'Heading 1' })).toBeFocused()
  await page.keyboard.press('End')
  await expect(bar.getByRole('button', { name: 'Heading 6' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(headersTrigger).toBeFocused()
  await expect(bar.locator('.styles-menu.open')).toHaveCount(0)

  await headersTrigger.click()
  await expect(bar.locator('.styles-menu.open').getByRole('button').allTextContents()).resolves.toEqual([
    'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6',
  ])

  await bar.getByRole('button', { name: 'Lists', exact: true }).click()
  const lists = bar.locator('.styles-menu.open')
  await expect(lists.locator(':scope > .styles-control, :scope > .styles-nested-group > .styles-nested-trigger').allTextContents())
    .resolves.toEqual(['List', 'Ordered List', 'Indent', 'Outdent', 'Paragraph', 'Block Quote', 'Todo›', 'Callout›', 'Separator'])
  await lists.locator('.styles-nested-trigger').filter({ hasText: 'Todo' }).hover()
  await expect(lists.getByRole('button', { name: 'Todo', exact: true })).toHaveCount(2)
  await expect(lists.getByRole('button', { name: 'Mark as Completed' })).toBeEnabled()
  await lists.locator('.styles-nested-trigger').filter({ hasText: 'Callout' }).hover()
  await expect(lists.getByRole('button', { name: 'Caution' })).toBeEnabled()

  await bar.getByRole('button', { name: 'Highlight', exact: true }).click()
  const highlight = bar.locator('.styles-menu.open')
  await expect(highlight.getByRole('button').allTextContents()).resolves.toEqual([
    'Default', 'Green', 'Red', 'Blue', 'Yellow', 'Purple',
  ])
  await expect(highlight.getByRole('button', { name: 'Default' })).toBeEnabled()
  for (const name of ['Default', 'Green', 'Red', 'Blue', 'Yellow', 'Purple']) {
    await expect(highlight.getByRole('button', { name })).toBeEnabled()
  }

  await bar.getByRole('button', { name: 'More', exact: true }).click()
  const more = bar.locator('.styles-menu.open')
  await expect(more.locator(':scope > .styles-control:not(.styles-overflow-menu-item)').allTextContents())
    .resolves.toEqual([
      'Underline', 'Strikethrough', 'Footnote', 'Code', 'Code Block', 'Math', 'Math Block',
      'Wiki Link', 'Convert to diagram', 'Hide styles bar',
    ])
  for (const name of ['Underline', 'Strikethrough', 'Footnote', 'Code', 'Code Block', 'Math', 'Math Block', 'Wiki Link', 'Convert to diagram']) {
    await expect(more.getByRole('button', { name, exact: true })).toBeEnabled()
  }

  await page.locator('.workspace-library-head').click()
  await expect(bar.locator('.styles-menu.open')).toHaveCount(0)
})

test('portable structure corrections survive as ordinary Markdown', async ({ page }) => {
  const bar = page.getByLabel('Styles bar', { exact: true })
  const listCommand = async (name: string): Promise<void> => {
    await bar.getByRole('button', { name: 'Lists', exact: true }).click()
    await bar.locator('.styles-menu.open').getByRole('button', { name, exact: true }).click()
  }
  const moreNested = async (group: string, name: string): Promise<void> => {
    await bar.getByRole('button', { name: 'More', exact: true }).click()
    const menu = bar.locator('.styles-menu.open')
    await menu.locator('.styles-nested-trigger').filter({ hasText: group }).hover()
    await menu.locator('.styles-nested-menu').filter({ has: page.getByRole('button', { name, exact: true }) })
      .getByRole('button', { name, exact: true }).click()
  }

  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('parent')
  await listCommand('List')
  await page.keyboard.press('Enter')
  await page.keyboard.type('child')
  await listCommand('Indent')
  await expect.poll(() => markdown(page)).toMatch(/[*-] parent\n\s{2,}[*-] child/)
  await listCommand('Outdent')
  await expect.poll(() => markdown(page)).toMatch(/[*-] parent\n[*-] child/)
  await listCommand('Paragraph')
  await expect.poll(() => markdown(page)).toMatch(/^child$/m)
  await expect.poll(() => markdown(page)).not.toMatch(/[*-]\s*child/)

  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await selectNewWord(page, 'mIXed words')
  await moreNested('Transform', 'Title Case')
  await expect.poll(() => markdown(page)).toContain('Mixed Words')
  await moreNested('Transform', 'Upper Case')
  await expect.poll(() => markdown(page)).toContain('MIXED WORDS')
  await moreNested('Transform', 'Lower Case')
  await expect.poll(() => markdown(page)).toContain('mixed words')

  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await moreNested('Current Date', 'Current Date')
  await expect.poll(() => markdown(page)).toMatch(/\d{4}-\d{2}-\d{2}/)
})

test('Paragraph lifts a list item out of every enclosing list, no matter how deep', async ({ page }) => {
  // A top-level item, mid-list: the list splits around it into two lists
  // with a bare paragraph in between.
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('alpha')
  await page.evaluate(() => window.simplemark!.run('bulletList' as never))
  await page.keyboard.press('Enter')
  await page.keyboard.type('beta')
  await page.keyboard.press('Enter')
  await page.keyboard.type('gamma')
  await expect.poll(() => markdown(page)).toMatch(/[*-] alpha\n[*-] beta\n[*-] gamma/)

  // Click directly on "beta" rather than navigating there with Home+ArrowUp:
  // a relative keyboard move depends on ProseMirror's layout being fully
  // settled, which is not guaranteed under load, where a stale position can
  // leave the cursor on "gamma" instead. A click targets real coordinates
  // and Playwright auto-waits for the element to be actionable first.
  await page.locator(editor).getByText('beta', { exact: true }).click()
  // The click resolves once the browser has dispatched it, not once
  // ProseMirror has finished folding the resulting selection change into its
  // own state — under load that fold can lag. Poll the real DOM selection
  // (not an app-internal API) until it has actually settled on "beta" before
  // running a command that reads the current selection.
  await expect.poll(() =>
    page.evaluate(() => window.getSelection()?.anchorNode?.textContent ?? null),
  ).toContain('beta')
  await page.evaluate(() => window.simplemark!.run('paragraph' as never))
  await expect.poll(() => markdown(page)).toMatch(/[*-] alpha\n+beta\n+[*-] gamma/)

  // A nested item, two levels deep: fully exits every enclosing list, not
  // just one — unlike Outdent, which would only move it up one level.
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('top')
  await page.evaluate(() => window.simplemark!.run('bulletList' as never))
  await page.keyboard.press('Enter')
  await page.keyboard.type('mid')
  await page.evaluate(() => window.simplemark!.run('indentListItem' as never))
  await page.keyboard.press('Enter')
  await page.keyboard.type('bottom')
  await page.evaluate(() => window.simplemark!.run('indentListItem' as never))
  await page.evaluate(() => window.simplemark!.run('indentListItem' as never))
  await expect.poll(() => markdown(page)).toMatch(/[*-] top\n\s{2,}[*-] mid\n\s{4,}[*-] bottom/)

  await page.evaluate(() => window.simplemark!.run('paragraph' as never))
  await expect.poll(() => markdown(page)).toMatch(/^bottom$/m)
  await expect.poll(() => markdown(page)).not.toMatch(/[*-]\s*bottom/)

  // A task-list item: becomes a plain paragraph and loses its checkbox.
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('finish task')
  await page.evaluate(() => window.simplemark!.run('taskList' as never))
  await expect.poll(() => markdown(page)).toMatch(/[*-] \[ \] finish task/)

  await page.evaluate(() => window.simplemark!.run('paragraph' as never))
  await expect.poll(() => markdown(page)).toMatch(/^finish task$/m)
  await expect.poll(() => markdown(page)).not.toMatch(/\[ \]/)
})

test('Todo actions toggle and persist the checkbox state', async ({ page }) => {
  const bar = page.getByLabel('Styles bar', { exact: true })
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.keyboard.type('finish parity')
  await bar.getByRole('button', { name: 'Todo', exact: true }).click()
  await expect.poll(() => markdown(page)).toMatch(/[*-] \[ \] finish parity/)
  await chooseListNested(bar, 'Todo', 'Mark as Completed')
  await expect.poll(() => markdown(page)).toMatch(/[*-] \[x\] finish parity/)
  await chooseListNested(bar, 'Todo', 'Toggle')
  await expect.poll(() => markdown(page)).toMatch(/[*-] \[ \] finish parity/)
  await chooseListNested(bar, 'Todo', 'Mark as Completed')
  await chooseListNested(bar, 'Todo', 'Mark as Incomplete')
  await expect.poll(() => markdown(page)).toMatch(/[*-] \[ \] finish parity/)
})

for (const [name, type] of [
  ['Note', 'note'], ['Tip', 'tip'], ['Important', 'important'],
  ['Warning', 'warning'], ['Caution', 'caution'],
] as const) {
  test(`Callout turns a line into a portable ${type} block`, async ({ page }) => {
    const bar = page.getByLabel('Styles bar', { exact: true })
    await page.evaluate(() => window.simplemark!.editor.focusEnd())
    await page.keyboard.press('Enter')
    await page.keyboard.type(`portable ${type}`)
    await chooseListNested(bar, 'Callout', name)
    await expect.poll(() => markdown(page)).toContain(`> [!${type.toUpperCase()}]`)
    await expect(page.locator(`${editor} .callout-${type}`)).toContainText(`portable ${type}`)
  })
}

for (const [name, source, color] of [
  ['Default', '==marked==', 'default'],
  ['Green', '=={green}marked==', 'green'],
  ['Red', '=={red}marked==', 'red'],
  ['Blue', '=={blue}marked==', 'blue'],
  ['Yellow', '=={yellow}marked==', 'yellow'],
  ['Purple', '=={purple}marked==', 'purple'],
] as const) {
  test(`Highlight applies the ${name} color and writes portable Markdown`, async ({ page }) => {
    const bar = page.getByLabel('Styles bar', { exact: true })
    await selectNewWord(page, 'marked')
    await bar.getByRole('button', { name: 'Highlight', exact: true }).click()
    await bar.locator('.styles-menu.open').getByRole('button', { name, exact: true }).click()
    await expect.poll(() => markdown(page)).toContain(source)
    await expect(page.locator(`${editor} mark[data-highlight-color="${color}"]`)).toContainText('marked')
  })
}

for (let level = 1; level <= 6; level += 1) {
  test(`Heading ${level} promotes a line to a real H${level}`, async ({ page }) => {
    const bar = page.getByLabel('Styles bar', { exact: true })
    await freshLine(page, `heading ${level}`)
    await bar.getByRole('button', { name: 'Headers', exact: true }).click()
    await bar.locator('.styles-menu.open').getByRole('button', { name: `Heading ${level}` }).click()
    await expect.poll(() => markdown(page)).toMatch(new RegExp(`^${'#'.repeat(level)} heading ${level}$`, 'm'))
    await expect(page.locator(`${editor} h${level}`, { hasText: `heading ${level}` })).toBeVisible()
  })
}

for (const [name, text, source] of [
  ['List', 'bullet item', /[*-] bullet item/],
  ['Ordered List', 'numbered item', /1\. numbered item/],
  ['Block Quote', 'quoted item', /> quoted item/],
] as const) {
  test(`${name} writes the expected list Markdown`, async ({ page }) => {
    const bar = page.getByLabel('Styles bar', { exact: true })
    await freshLine(page, text)
    await bar.getByRole('button', { name: 'Lists', exact: true }).click()
    await bar.locator('.styles-menu.open').getByRole('button', { name, exact: true }).click()
    await expect.poll(() => markdown(page)).toMatch(source)
  })
}

test('Separator writes a thematic break', async ({ page }) => {
  const bar = page.getByLabel('Styles bar', { exact: true })
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await bar.getByRole('button', { name: 'Lists', exact: true }).click()
  await bar.locator('.styles-menu.open').getByRole('button', { name: 'Separator' }).click()
  await expect.poll(() => markdown(page)).toMatch(/\n\*\*\*\n/)
})

test('Italic wraps the selection in portable emphasis', async ({ page }) => {
  const bar = page.getByLabel('Styles bar', { exact: true })
  await selectNewWord(page, 'italic text')
  await bar.getByRole('button', { name: 'Italic', exact: true }).click()
  await expect.poll(() => markdown(page)).toContain('*italic text*')
})

test('Link wraps the selection with the entered URL', async ({ page }) => {
  const bar = page.getByLabel('Styles bar', { exact: true })
  await selectNewWord(page, 'linked text')
  page.once('dialog', (dialog) => void dialog.accept('https://example.com/reference'))
  await bar.getByRole('button', { name: 'Link', exact: true }).click()
  await expect.poll(() => markdown(page)).toContain('[linked text](https://example.com/reference)')
})

test('Tables inserts a portable table', async ({ page }) => {
  const bar = page.getByLabel('Styles bar', { exact: true })
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await bar.getByRole('button', { name: 'Tables', exact: true }).click()
  await expect(page.locator(`${editor} table`)).toBeVisible()
  await expect.poll(() => markdown(page)).toMatch(/\| :----- \| :----- \| :----- \|/)
})

test('Hide styles bar hides the bar without changing the document', async ({ page }) => {
  const bar = page.getByLabel('Styles bar', { exact: true })
  await freshLine(page, 'unaffected by hiding the bar')
  // page.keyboard.type() resolving only means the browser dispatched the
  // keystrokes, not that ProseMirror has folded them into its own state —
  // under load that fold can lag. Poll until the typed text has actually
  // settled before snapshotting it as the "before" baseline.
  await expect.poll(() => markdown(page)).toContain('unaffected by hiding the bar')
  const beforeHide = await markdown(page)
  await page.getByRole('button', { name: 'Text formatting' }).click()
  await page.getByRole('button', { name: 'Hide styles bar', exact: true }).click()
  await expect(bar).toBeHidden()
  await expect.poll(() => markdown(page)).toBe(beforeHide)
})

test('Move Completed to Bottom reorders only the active task list', async ({ page }) => {
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => navigator.clipboard.writeText('- [x] done first\n- [ ] open second\n- [x] done third'))
  await page.keyboard.press('ControlOrMeta+v')
  await expect.poll(() => markdown(page)).toMatch(/[*-] \[x\] done third/)
  await page.locator(`${editor} li p`, { hasText: 'done third' }).click({ position: { x: 70, y: 8 } })
  await page.keyboard.press('End')

  const bar = page.getByLabel('Styles bar', { exact: true })
  await bar.getByRole('button', { name: 'Lists', exact: true }).click()
  const menu = bar.locator('.styles-menu.open')
  await menu.locator('.styles-nested-trigger').filter({ hasText: 'Todo' }).hover()
  await menu.locator('.styles-nested-menu').getByRole('button', { name: 'Move Completed to Bottom' }).click()

  await expect.poll(async () => {
    const current = await markdown(page)
    return current.indexOf('open second') < current.indexOf('done first')
      && current.indexOf('done first') < current.indexOf('done third')
  }).toBe(true)
  const source = await markdown(page)
  expect(source.indexOf('open second')).toBeLessThan(source.indexOf('done first'))
  expect(source.indexOf('done first')).toBeLessThan(source.indexOf('done third'))
})

test('Underline wraps the selection in portable HTML', async ({ page }) => {
  const bar = page.getByLabel('Styles bar', { exact: true })
  await selectNewWord(page, 'underlined')
  await chooseMore(bar, 'Underline')
  await expect.poll(() => markdown(page)).toContain('<u>underlined</u>')
  await expect(page.locator(`${editor} u`, { hasText: 'underlined' })).toBeVisible()
})

test('Strikethrough writes portable strikethrough Markdown', async ({ page }) => {
  const bar = page.getByLabel('Styles bar', { exact: true })
  await selectNewWord(page, 'struck')
  await chooseMore(bar, 'Strikethrough')
  await expect.poll(() => markdown(page)).toContain('~~struck~~')
})

test('Footnote inserts a reference and its body', async ({ page }) => {
  const bar = page.getByLabel('Styles bar', { exact: true })
  await selectNewWord(page, 'footnote body')
  await chooseMore(bar, 'Footnote')
  await expect.poll(() => markdown(page)).toContain('[^1]')
  await expect.poll(() => markdown(page)).toContain('[^1]: footnote body')
  await expect(page.locator(`${editor} sup[data-type="footnote_reference"]`)).toBeVisible()
})

test('Code wraps the selection in inline code', async ({ page }) => {
  const bar = page.getByLabel('Styles bar', { exact: true })
  await selectNewWord(page, 'inline code')
  await chooseMore(bar, 'Code')
  await expect.poll(() => markdown(page)).toContain('`inline code`')
})

test('Math wraps the selection in portable inline math', async ({ page }) => {
  const bar = page.getByLabel('Styles bar', { exact: true })
  await selectNewWord(page, 'x+y')
  await chooseMore(bar, 'Math')
  await expect.poll(() => markdown(page)).toContain('$$x+y$$')
  await expect(page.locator(`${editor} .inline-math .katex`)).toBeVisible()
})

test('Wiki Link wraps the selection in portable double-bracket syntax', async ({ page }) => {
  const bar = page.getByLabel('Styles bar', { exact: true })
  await selectNewWord(page, 'Related Note')
  await chooseMore(bar, 'Wiki Link')
  await expect.poll(() => markdown(page)).toContain('[[Related Note]]')
  await expect(page.locator(`${editor} a.wiki-link`, { hasText: 'Related Note' })).toBeVisible()
})

test('Code Block inserts a portable fenced block', async ({ page }) => {
  const bar = page.getByLabel('Styles bar', { exact: true })
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await chooseMore(bar, 'Code Block')
  await expect.poll(() => markdown(page)).toContain('```')
})

test('Math Block inserts a portable block-math fence', async ({ page }) => {
  const bar = page.getByLabel('Styles bar', { exact: true })
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await chooseMore(bar, 'Math Block')
  await expect.poll(() => markdown(page)).toContain('$$\nx = y\n$$')
  await expect(page.locator(`${editor} .math-block .katex`).last()).toBeVisible()
})

test('bar-created portable extensions reopen as rendered, editable content', async ({ page }) => {
  const note = '# Loaded\n\n<u>underlined</u> and $$x+y$$ and [[Related Note]] with note[^1] and =={green}green==.\n\n> [!TIP]\n> Portable callout.\n\n- [x] Finished\n\n[^1]: body\n'
  await page.addInitScript((content: string) => {
    window.showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory()
      const handle = await root.getFileHandle('styles-note.md', { create: true })
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
      return [handle]
    }
  }, note)
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.getByRole('button', { name: 'Open file' }).click()

  await expect(page.locator(`${editor} u`, { hasText: 'underlined' })).toBeVisible()
  await expect(page.locator(`${editor} .inline-math .katex`)).toBeVisible()
  await expect(page.locator(`${editor} a.wiki-link`, { hasText: 'Related Note' })).toBeVisible()
  await expect(page.locator(`${editor} sup[data-type="footnote_reference"]`)).toBeVisible()
  await expect(page.locator(`${editor} mark[data-highlight-color="green"]`)).toContainText('green')
  await expect(page.locator(`${editor} .callout-tip`)).toContainText('Portable callout.')
  await expect(page.locator(`${editor} li[data-checked="true"]`)).toContainText('Finished')
  await expect.poll(() => markdown(page)).toContain('<u>underlined</u>')
  await expect.poll(() => markdown(page)).toContain('$$x+y$$')
  await expect.poll(() => markdown(page)).toContain('[[Related Note]]')
  await expect.poll(() => markdown(page)).toContain('[^1]: body')
  await expect.poll(() => markdown(page)).toContain('=={green}green==')
  await expect.poll(() => markdown(page)).toContain('> [!TIP]')
  await expect.poll(() => markdown(page)).toContain('- [x] Finished')
})

test('the styles-bar preference survives reload without changing source', async ({ page }) => {
  const before = await markdown(page)
  await page.getByRole('button', { name: 'Text formatting' }).click()
  await page.getByRole('button', { name: 'Hide styles bar', exact: true }).click()
  await expect(page.getByLabel('Styles bar')).toBeHidden()
  await expect.poll(() => markdown(page)).toBe(before)

  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  await expect(page.getByLabel('Styles bar')).toBeHidden()
})

test('the styles bar can move, remembers its place, and resets to the wireframe default', async ({ page }) => {
  const bar = page.getByLabel('Styles bar')
  const surface = page.locator('.document-surface')
  const before = await bar.boundingBox()
  const surfaceBox = await surface.boundingBox()
  if (before === null || surfaceBox === null) throw new Error('Expected visible palette and document pane')

  const grip = bar.getByRole('button', { name: 'Move formatting palette' })
  const gripBox = await grip.boundingBox()
  if (gripBox === null) throw new Error('Expected a visible palette grip')
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.72, surfaceBox.y + 120)
  await page.mouse.up()

  const moved = await bar.boundingBox()
  if (moved === null) throw new Error('Expected the moved palette to remain visible')
  expect(moved.y).toBeLessThan(before.y - 100)
  await expect.poll(() => page.evaluate(() =>
    window.localStorage.getItem('simplemark.styles-bar-position.web'),
  )).not.toBe('')

  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
  const restored = await page.getByLabel('Styles bar').boundingBox()
  if (restored === null) throw new Error('Expected the restored palette to remain visible')
  expect(Math.abs(restored.x - moved.x)).toBeLessThan(2)
  expect(Math.abs(restored.y - moved.y)).toBeLessThan(2)

  const restoredGrip = page.getByRole('button', { name: 'Move formatting palette' })
  await restoredGrip.dblclick()
  const resetStyle = await page.getByLabel('Styles bar').evaluate((element) => ({
    bottom: getComputedStyle(element).bottom,
    placed: element.classList.contains('is-placed'),
  }))
  expect(resetStyle).toEqual({ bottom: '18px', placed: false })
})

test('narrow windows collapse low-frequency controls into More', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 760 })
  const bar = page.getByLabel('Styles bar')
  await expect(bar.getByRole('button', { name: 'Bold', exact: true })).toBeHidden()
  await expect(bar.getByRole('button', { name: 'Image/File', exact: true })).toBeHidden()

  await bar.getByRole('button', { name: 'More', exact: true }).click()
  const more = bar.locator('.styles-menu.open')
  await expect(more.getByRole('button', { name: 'Bold', exact: true })).toBeVisible()

  await selectNewWord(page, 'overflow works')
  await more.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect.poll(() => markdown(page)).toContain('**overflow works**')
})
