import { expect, test } from '@playwright/test'

/**
 * The diagram-error box's Copy and Fix-it buttons (EDITOR error-recovery).
 *
 * Fix-it drives the real retry loop against a routed-and-stubbed
 * `/chat/completions` endpoint — no test-only seam in app code, the same way
 * clipboard-exports.spec.ts drives the real clipboard port rather than a
 * fake one.
 */

const EDITOR = '.milkdown .ProseMirror'
const BROKEN_MERMAID = 'flowchart TD\n  Start(["Begin<br/>(also broken"]'
const FIXED_MERMAID = 'flowchart TD\n  Start["Begin"]'

const AI_SETTINGS = { apiKey: 'sk-test', baseUrl: 'https://ai-fix.test/v1', model: 'gpt-4o' }

function chatCompletionResponse(content: string) {
  return { choices: [{ message: { content } }] }
}

async function openNoteWithBrokenDiagram(page: import('@playwright/test').Page): Promise<void> {
  const body = `# Note\n\n\`\`\`mermaid\n${BROKEN_MERMAID}\n\`\`\`\n`
  await page.addInitScript(
    ({ content, settings }: { content: string; settings: typeof AI_SETTINGS }) => {
      window.localStorage.setItem('simplemark.ai-settings', JSON.stringify(settings))
      window.showOpenFilePicker = async () => {
        const root = await navigator.storage.getDirectory()
        const handle = await root.getFileHandle('diagram-fix.md', { create: true })
        if ((await handle.getFile()).size === 0) {
          const writable = await handle.createWritable()
          await writable.write(content)
          await writable.close()
        }
        return [handle]
      }
    },
    { content: body, settings: AI_SETTINGS },
  )
  await page.goto('/')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Open file' }).click()
  // The legacy fixture keeps hidden error shells for its other diagrams. The
  // recovery contract is about the error currently visible for this note.
  await expect(page.locator('.diagram-error:visible')).toHaveCount(1)
}

test('Copy places the language, error, and source on the clipboard', async ({ page }) => {
  await openNoteWithBrokenDiagram(page)
  await page.locator('.diagram-error:visible .diagram-error-copy').click()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toContain('Diagram type: mermaid')
  expect(text).toContain(BROKEN_MERMAID)
  expect(text).toContain('```mermaid')
})

test('Fix it retries until the diagram renders, updating the label on every attempt', async ({ page }) => {
  let calls = 0
  await page.route('https://ai-fix.test/v1/chat/completions', async (route) => {
    calls += 1
    // Still-broken syntax on the first two answers, valid on the third —
    // exercises the loop, the live "(N/3)" label, and the eventual success.
    // The unbalanced stadium-shape brackets mirror BROKEN_MERMAID's own
    // defect, so these answers are genuine Mermaid parse failures rather
    // than valid syntax that happens to look suspicious.
    const content = calls < 3 ? `flowchart TD\n  Still(["Broken (attempt ${calls}"]` : FIXED_MERMAID
    // A same-tick mock response resolves the whole 3-attempt loop inside a
    // handful of microtasks — faster than Playwright's poll can observe the
    // intermediate "(N/3)" label. A small delay gives each attempt its own
    // rendered frame, the same way a real network round trip would.
    await new Promise((resolve) => setTimeout(resolve, 75))
    await route.fulfill({ json: chatCompletionResponse(content) })
  })

  await openNoteWithBrokenDiagram(page)
  const fixButton = page.locator('.diagram-error:visible .diagram-error-fix')
  await fixButton.click()

  await expect(fixButton).toHaveText('Fixing… (1/3)')
  await expect(page.locator(`${EDITOR} .diagram-render svg`).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.diagram-error:visible')).toHaveCount(0)
  expect(calls).toBe(3)

  // The editor hands changes to the session on a 200ms debounce (see
  // MilkdownEditor.flushPendingChanges), so close that gap before reading
  // the session the same way Save and autosave do.
  await page.evaluate(() => window.simplemark!.flushPendingChanges())
  const saved = await page.evaluate(() => window.simplemark!.session.snapshot().markdown)
  expect(saved).toContain(FIXED_MERMAID)
})

test('a transport failure stops the loop immediately instead of spending all 3 attempts', async ({ page }) => {
  let calls = 0
  await page.route('https://ai-fix.test/v1/chat/completions', async (route) => {
    calls += 1
    await route.fulfill({ status: 401, body: 'unauthorized' })
  })

  await openNoteWithBrokenDiagram(page)
  await page.locator('.diagram-error:visible .diagram-error-fix').click()

  await expect(page.locator('.diagram-error-message')).toContainText('401', { timeout: 10_000 })
  expect(calls).toBe(1)
})

test('3 straight syntax-error answers leave the last attempt in the document and give up visibly', async ({ page }) => {
  let calls = 0
  await page.route('https://ai-fix.test/v1/chat/completions', async (route) => {
    calls += 1
    await route.fulfill({ json: chatCompletionResponse(`flowchart TD\n  Still(["Broken (attempt ${calls}"]`) })
  })

  await openNoteWithBrokenDiagram(page)
  await page.locator('.diagram-error:visible .diagram-error-fix').click()

  await expect(page.locator('.diagram-error-message')).toContainText("Couldn't auto-fix after 3 attempts", {
    timeout: 15_000,
  })
  expect(calls).toBe(3)

  await page.evaluate(() => window.simplemark!.flushPendingChanges())
  const saved = await page.evaluate(() => window.simplemark!.session.snapshot().markdown)
  expect(saved).toContain('attempt 3')
})
