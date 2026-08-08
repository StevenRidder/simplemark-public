import { expect, test } from '@playwright/test'

/**
 * BUG-5, end to end: a long Markdown document containing an ASCII diagram must
 * paste as Markdown.
 *
 * Reported against a real note — headings, a table, lists and a fenced
 * architecture diagram. Four box-drawing lines inside the fence were enough for
 * the file-tree sniffer to claim the whole document and render it as one card.
 */

const DOCUMENT = `## What you get once it's built

You get a **local connector gateway** inside the Atlas image:

- **Breadth for ordinary SaaS** without a bespoke client per app
- **Depth for industrial systems** stays native

| Outcome | When |
|---|---|
| Composio private mode | Own-cloud stack passes every hard gate |
| Neither | Keep the provider seam |

\`\`\`text
Workflow / Agent
       │
       ▼
 Local Atlas Connector Gateway
   ├── Native industrial adapters
   ├── Official cloud SDK adapters
   ├── Catalog provider adapter
   └── Restricted CLI runner
\`\`\`

Everything normalizes to Atlas **FQTN + ToolResult**.`

async function paste(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.goto('/?fixture=legacy')
  await page.waitForFunction(() => window.simplemark !== undefined)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => window.simplemark!.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.evaluate((t) => navigator.clipboard.writeText(t), text)
  await page.keyboard.press('ControlOrMeta+v')
}

test('a document containing an ASCII diagram pastes as Markdown, not as one card', async ({
  page,
}) => {
  await paste(page, DOCUMENT)

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.editor.serialize()), {
      timeout: 30_000,
    })
    .toContain('## What you get once it')

  const markdown = await page.evaluate(() => window.simplemark!.editor.serialize())

  // The whole point: the document is not wrapped in a tree card.
  expect(markdown).not.toContain('```tree')
  // Its structure survived the paste. The table is matched loosely because
  // remark re-serialises it with aligned padding rather than the source widths.
  expect(markdown).toMatch(/\|\s*Outcome\s*\|\s*When\s*\|/)
  expect(markdown).toMatch(/\|\s*Composio private mode\s*\|/)
  expect(markdown).toContain('**Breadth for ordinary SaaS**')
  // The diagram stays inside its own fenced block.
  expect(markdown).toContain('├── Native industrial adapters')
})

test('a bare tree pasted on its own still becomes a tree card', async ({ page }) => {
  await paste(page, 'src\n├── domain\n│   └── paste\n└── adapters\n    └── renderers')

  await expect
    .poll(async () => page.evaluate(() => window.simplemark!.editor.serialize()), {
      timeout: 30_000,
    })
    .toContain('```tree')
})
