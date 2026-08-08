import { expect, test } from '@playwright/test'

const WELCOME = 'Welcome to SimpleMark'
const TANOA = 'Project Tanoa: Storm Atlas'

const notes = (page: import('@playwright/test').Page) =>
  page.getByRole('complementary', { name: 'Notes' })

const closeNote = async (page: import('@playwright/test').Page, name: string) => {
  const close = page.getByRole('button', { name: `Close ${name}` })
  await close.locator('..').hover()
  await close.click()
}

const togglePin = async (page: import('@playwright/test').Page, name: string) => {
  const pin = page.getByRole('button', { name })
  await pin.locator('..').hover()
  await pin.click()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => window.simplemark !== undefined)
})

test('L2-020 selecting notes preserves the complete catalog and changes only the document', async ({ page }) => {
  const initialOrder = await notes(page).locator('.note-select').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('aria-label')),
  )
  await expect(notes(page).locator('.note-item')).toHaveCount(2)

  for (const [name, heading] of [
    [TANOA, 'Project Tanoa: the storm atlas'],
    [WELCOME, 'Welcome to SimpleMark'],
  ] as const) {
    await page.getByRole('button', { name, exact: true }).click()
    await expect(notes(page).locator('.note-item')).toHaveCount(2)
    await expect(page.locator('.milkdown .ProseMirror h1')).toHaveText(heading)
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page')
    await expect.poll(() => notes(page).locator('.note-select').evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('aria-label')),
    )).toEqual(initialOrder)
  }
})

/** The rows the middle pane is actually showing, top to bottom. */
const rowOrder = (page: import('@playwright/test').Page) =>
  notes(page).locator('.note-select').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label')))

test('L2-010 each New Note accumulates instead of replacing the list', async ({ page }) => {
  const newNote = page.getByRole('button', { name: 'New note' })
  await newNote.click()
  await expect(notes(page).locator('.note-item')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'new-note-3', exact: true })).toHaveAttribute('aria-current', 'page')

  await newNote.click()
  await expect(notes(page).locator('.note-item')).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'new-note-3', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'new-note-4', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByLabel('Library')).toContainText('Recent Notes4')
})

test('L2-010 a new note arrives at the top of the notes it joins', async ({ page }) => {
  // The handbook ships pinned, and a pin outranks every other date order — a new
  // note leads the notes it can lead, rather than displacing a pinned one.
  expect(await rowOrder(page)).toEqual([WELCOME, TANOA])

  await page.getByRole('button', { name: 'New note' }).click()
  expect(await rowOrder(page)).toEqual([WELCOME, 'new-note-3', TANOA])

  await page.getByRole('button', { name: 'New note' }).click()
  expect(await rowOrder(page)).toEqual([
    WELCOME,
    'new-note-4',
    'new-note-3',
    TANOA,
  ])
})

test('L2-040/L2-041 pinning reorders, filters, and unpins without closing the document', async ({ page }) => {
  await page.getByRole('button', { name: TANOA, exact: true }).click()
  await togglePin(page, `Pin ${TANOA}`)

  await expect(notes(page).locator('.note-select').first()).toHaveAccessibleName(TANOA)
  await expect(page.getByRole('button', { name: `Unpin ${TANOA}` })).toBeVisible()
  await expect(page.getByRole('button', { name: TANOA, exact: true }).locator('..').getByRole('img', { name: 'Pinned' })).toBeVisible()
  await expect(page.getByLabel('Library')).toContainText('Pinned2')

  await page.getByRole('button', { name: /Pinned\s*2/ }).click()
  await expect(notes(page).locator('.note-item')).toHaveCount(2)
  await togglePin(page, `Unpin ${TANOA}`)

  await expect(notes(page).locator('.note-item')).toHaveCount(1)
  await expect(page.locator('.milkdown .ProseMirror h1')).toHaveText('Project Tanoa: the storm atlas')
  await expect(page.getByRole('button', { name: TANOA, exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Library')).toContainText('Pinned1')
})

test('L2-030/L2-031 search is scoped, live, clearable, and keeps the document open', async ({ page }) => {
  await page.getByRole('button', { name: 'Search' }).click()
  const search = page.getByRole('searchbox', { name: 'Search notes' })
  await expect(search).toBeFocused()
  await search.fill('microgrid')
  await expect(notes(page).locator('.note-item')).toHaveCount(1)
  await expect(page.getByRole('button', { name: TANOA, exact: true })).toBeVisible()

  await search.fill('no note has this phrase')
  await expect(notes(page).locator('.note-item')).toHaveCount(0)
  await expect(page.locator('.milkdown .ProseMirror h1')).toHaveText('Welcome to SimpleMark')

  await page.keyboard.press('Escape')
  await expect(search).toBeHidden()
  await expect(notes(page).locator('.note-item')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Search' })).toBeFocused()
})

test('L2-001/L2-050/L2-060 list options expose count, sorting, and all preview densities', async ({ page }) => {
  const open = page.getByRole('button', { name: 'Note list options' })
  await open.click()
  let menu = page.getByLabel('Note list options').filter({ has: page.getByText('2 notes') })
  await expect(menu.getByText('2 notes')).toBeVisible()
  await expect(menu.getByText('Sort', { exact: true })).toBeVisible()
  await expect(menu.getByText('Layout', { exact: true })).toBeVisible()
  await expect(menu.getByText('Filter', { exact: true })).toBeVisible()
  await menu.getByRole('button', { name: 'Sort by title' }).click()
  await expect.poll(() => notes(page).locator('.note-select').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('aria-label')),
  )).toEqual([TANOA, WELCOME])

  await togglePin(page, `Unpin ${WELCOME}`)
  await open.click()
  menu = page.getByLabel('Note list options').filter({ has: page.getByText('2 notes') })
  await menu.getByRole('button', { name: 'Sort by creation date' }).click()
  await expect.poll(() => notes(page).locator('.note-select').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('aria-label')),
  )).toEqual([TANOA, WELCOME])

  await open.click()
  menu = page.getByLabel('Note list options').filter({ has: page.getByText('2 notes') })
  await menu.getByRole('button', { name: 'Sort by modification date' }).click()
  await expect.poll(() => notes(page).locator('.note-select').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('aria-label')),
  )).toEqual([WELCOME, TANOA])

  for (const [label, density] of [
    ['Small preview', 'small'],
    ['Medium preview', 'medium'],
    ['Large preview', 'large'],
  ] as const) {
    await open.click()
    menu = page.getByLabel('Note list options').filter({ has: page.getByText('2 notes') })
    await menu.getByRole('button', { name: label }).click()
    await expect(notes(page)).toHaveAttribute('data-preview', density)
  }
})

test('Pinned only is a recoverable filter when no notes are pinned', async ({ page }) => {
  await togglePin(page, `Unpin ${WELCOME}`)
  const open = page.getByRole('button', { name: 'Note list options' })
  await open.click()
  const menu = page.getByLabel('Note list options').filter({ has: page.getByText('2 notes') })

  await expect(menu.getByRole('button', { name: 'Pinned only (0)' })).toBeVisible()
  await menu.getByRole('button', { name: 'Pinned only (0)' }).click()
  await expect(notes(page).locator('.note-item')).toHaveCount(0)
  await expect(notes(page).getByText('No pinned notes')).toBeVisible()

  await notes(page).getByRole('button', { name: 'Show Recent Notes' }).click()
  await expect(notes(page).locator('.note-item')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Note list options' })).toContainText('Samples')
})

test('L1-050 Recent Notes and Pinned keep collection title, selection, and count aligned', async ({ page }) => {
  await page.getByRole('button', { name: /Pinned\s*1/ }).click()
  await expect(page.getByRole('button', { name: 'Note list options' })).toContainText('Pinned')
  await expect(notes(page).locator('.note-item')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Pinned\s*1/ })).toHaveClass(/selected/)

  await page.getByRole('button', { name: /Recent Notes\s*2/ }).click()
  await expect(page.getByRole('button', { name: 'Note list options' })).toContainText('Samples')
  await expect(notes(page).locator('.note-item')).toHaveCount(2)
  await expect(page.getByRole('button', { name: /Recent Notes\s*2/ })).toHaveClass(/selected/)
})

test('L1-120 visible sidebar controls expose names and honest disabled states', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Search' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Open note' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Open note' })).toHaveAttribute(
    'title',
    'Open an existing Markdown file',
  )
  await expect(page.getByRole('button', { name: 'New note' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Sidebar options' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Folder sync status' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeEnabled()
  await expect(page.locator('.workspace-name')).toHaveCount(0)
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('button', { name: 'White background' })).toBeVisible()
  const library = page.getByLabel('Library')
  await expect(library.getByRole('button', { name: 'Untagged' })).toBeDisabled()
  await expect(library.getByRole('button', { name: 'Todo' })).toBeDisabled()
  await expect(library.getByRole('button', { name: 'Today' })).toBeDisabled()
  await expect(library.getByRole('button', { name: 'Trash' })).toBeDisabled()
})

test('browser Settings omits the native App Icon capability', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'App Icon' })).toHaveCount(0)
})

test('native App Icon chooser commits successful changes and preserves selection on failure', async ({ page }) => {
  await page.evaluate(async () => {
    const catalogPath = '/src/app/app-icons.ts'
    const settingsPath = '/src/app/ui/app-icon-settings.ts'
    const { APP_ICON_CHOICES } = await import(catalogPath) as typeof import('../../src/app/app-icons.js')
    const { createAppIconSettings } = await import(settingsPath) as typeof import('../../src/app/ui/app-icon-settings.js')
    const chooser = createAppIconSettings({
      choices: APP_ICON_CHOICES,
      selected: 'midnight',
      onChange: async (icon) => {
        if (icon === 'original') throw new Error('native bridge refused the icon')
        document.body.dataset['chosenIcon'] = icon
      },
      onError: (error) => {
        document.body.dataset['iconError'] = error instanceof Error ? error.message : String(error)
      },
    })
    document.body.replaceChildren(chooser)
  })

  await expect(page.getByRole('heading', { name: 'App Icon' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Use .* app icon$/ })).toHaveCount(7)
  await expect(page.getByRole('button', { name: 'Use Blue Trio app icon' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use Electric + Black app icon' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use Midnight app icon' }))
    .toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Use Blue Page app icon' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-chosen-icon', 'blue-page')
  await expect(page.getByRole('button', { name: 'Use Blue Page app icon' }))
    .toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Use Original app icon' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-icon-error', 'native bridge refused the icon')
  await expect(page.getByRole('button', { name: 'Use Blue Page app icon' }))
    .toHaveAttribute('aria-pressed', 'true')
})

test('active notes use a left selection rule while X and pin remain hover-only', async ({ page }) => {
  const list = notes(page)
  const selected = list.locator('.note-item.selected')
  const restingName = await list.locator('.note-item:not(.selected) .note-select').last().getAttribute('aria-label')
  if (restingName === null) throw new Error('Expected a resting note row')
  const resting = list.getByRole('button', { name: restingName, exact: true }).locator('..')

  await expect(selected.locator('.note-close')).toHaveCSS('opacity', '0')
  await expect(selected.locator('.note-pin')).toHaveCSS('opacity', '0')
  expect(await selected.evaluate((row) => getComputedStyle(row, '::before').width)).toBe('3px')
  expect(await selected.evaluate((row) => getComputedStyle(row, '::before').left)).toBe('0px')
  expect(await selected.evaluate((row) => getComputedStyle(row, '::after').opacity)).toBe('1')
  await expect(resting.locator('.note-close')).toHaveCSS('opacity', '0')
  await expect(resting.locator('.note-pin')).toHaveCSS('opacity', '0')
  await expect(resting).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  expect(await resting.evaluate((row) => getComputedStyle(row, '::after').opacity)).toBe('1')

  await resting.locator('.note-select').click()
  await page.mouse.move(0, 0)

  await expect(resting).toHaveClass(/selected/)
  await expect(resting.locator('.note-close')).toHaveCSS('opacity', '0')
  await expect(resting.locator('.note-pin')).toHaveCSS('opacity', '0')
  expect(await resting.evaluate((row) => getComputedStyle(row, '::before').width)).toBe('3px')

  await resting.hover()
  await expect(resting.locator('.note-close')).toHaveCSS('opacity', '1')
  await expect(resting.locator('.note-pin')).toHaveCSS('opacity', '1')
})

test('L2-070 right-click exposes only actions that really work on this client', async ({ page }) => {
  await page.getByRole('button', { name: TANOA, exact: true }).click({ button: 'right' })
  const menu = page.getByRole('menu')

  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Pin To Top' })).toBeEnabled()
  await expect(menu.getByRole('menuitem', { name: 'Open', exact: true })).toBeEnabled()
  await expect(menu.getByRole('menuitem', { name: 'Copy Markdown' })).toBeEnabled()
  await expect(menu.getByRole('menuitem', { name: 'Copy Link' })).toBeEnabled()
  await expect(menu.getByRole('menuitem', { name: 'Copy Identifier' })).toBeEnabled()
  await expect(menu.getByRole('menuitem', { name: 'Close Note' })).toBeEnabled()
  await expect(menu.getByRole('menuitem', { name: 'Move to Trash' })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'Duplicate' })).toHaveCount(0)

  await menu.getByRole('menuitem', { name: 'Pin To Top' }).click()
  await expect(page.getByRole('button', { name: `Unpin ${TANOA}` })).toBeVisible()
})

test('closing a background note hides its row without remounting the active editor or invoking Trash', async ({ page }) => {
  const close = page.getByRole('button', { name: `Close ${TANOA}` })
  await page.locator('.milkdown .ProseMirror').evaluate((editor) => {
    ;(window as typeof window & { __simplemarkEditorBeforeClose?: Element }).__simplemarkEditorBeforeClose = editor
  })
  await expect(close).toBeVisible()
  await expect(close).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

  await close.locator('..').hover()
  await expect(close).toHaveCSS('opacity', '1')
  await close.hover()
  await expect(close).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await close.click()

  await expect(page.getByRole('button', { name: TANOA, exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Library')).toContainText('Recent Notes1')
  await expect(page.getByText('Closed note — file remains on disk')).toBeVisible()
  expect(await page.locator('.milkdown .ProseMirror').evaluate((editor) =>
    editor === (window as typeof window & { __simplemarkEditorBeforeClose?: Element }).__simplemarkEditorBeforeClose,
  )).toBe(true)
})

test('closing the active note removes it from both the list and reading pane', async ({ page }) => {
  await expect(page.locator('.milkdown .ProseMirror h1')).toHaveText('Welcome to SimpleMark')
  await closeNote(page, WELCOME)

  await expect(page.getByRole('button', { name: WELCOME, exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: TANOA, exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.locator('.milkdown .ProseMirror h1')).toHaveText('Project Tanoa: the storm atlas')
  await expect(page.locator('.milkdown .ProseMirror')).not.toContainText('Welcome to SimpleMark')
  await expect(page.getByText('Closed note — file remains on disk')).toBeVisible()
})

test('closing the final visible note leaves a clean no-selection pane', async ({ page }) => {
  await closeNote(page, WELCOME)
  await closeNote(page, TANOA)

  await expect(notes(page).locator('.note-item')).toHaveCount(0)
  await expect(page.locator('.milkdown .ProseMirror')).toBeEmpty()
  await expect(page.locator('.filename small')).toHaveText('No note selected')
  await expect(page.getByText('Closed note — file remains on disk')).toBeVisible()
})

test('Samples disclosure is a centred Tabler chevron and both columns expose resize handles', async ({ page }) => {
  const title = page.getByRole('button', { name: 'Note list options' })
  await expect(title.locator('svg')).toHaveCount(1)
  await expect(title).toHaveCSS('align-items', 'center')
  await expect(page.getByRole('button', { name: 'Resize navigation column' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resize note list column' })).toBeVisible()

  const navigation = page.getByRole('complementary', { name: 'Library' })
  const before = await navigation.evaluate((element) => element.getBoundingClientRect().width)
  const handle = page.getByRole('button', { name: 'Resize navigation column' })
  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 20)
  await page.mouse.down()
  await page.mouse.move(box!.x + 45, box!.y + 20)
  await page.mouse.up()
  const after = await navigation.evaluate((element) => element.getBoundingClientRect().width)
  expect(after).toBeGreaterThan(before + 25)
})
