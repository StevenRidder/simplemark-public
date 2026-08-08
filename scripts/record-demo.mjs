/**
 * Records a realtime demo of SimpleMark and encodes it to an animated GIF.
 *
 * Drives a single continuous session and captures actual video, so pasting,
 * rendering and re-rendering are seen happening rather than implied.
 *
 *   npm run dev            # the app must be up on :5273
 *   node scripts/record-demo.mjs
 *
 * Output: docs/assets/simplemark-demo.gif (plus the raw .webm in .artifacts).
 */
import { mkdir, rm, readdir, copyFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const run = promisify(execFile)

const WORK = '.artifacts/demo'
const GIF = 'docs/assets/simplemark-demo.gif'
const EDITOR = '.milkdown .ProseMirror'
// localhost, not 127.0.0.1: vite binds ::1 by default, so the v4 literal is refused.
const URL = process.env.SIMPLEMARK_DEMO_URL ?? 'http://localhost:5273'

/** Viewport, and therefore the recorded frame. 16:10 keeps the note column centred. */
const SIZE = { width: 1280, height: 800 }

/** Typing cadence. Fast enough not to bore, slow enough to read. */
const KEYSTROKE_MS = 42

const MARKDOWN = `## What it does

Paste real Markdown and it becomes real formatting — not a code block.

| Input | SimpleMark shows | The file still holds |
| --- | --- | --- |
| Markdown | formatted prose | the same Markdown |
| Mermaid | a rendered diagram | the same fenced source |
| SVG | the picture | the same SVG |

- [x] tables, task lists, footnotes
- [ ] and the bytes never move unless you edit them

Diagrams work the same way.`

const MERMAID = `flowchart LR
  PASTE[Paste raw text] --> SNIFF{What is it?}
  SNIFF -->|Mermaid| DIAGRAM[Render a diagram]
  SNIFF -->|SVG| PICTURE[Render the picture]
  SNIFF -->|Markdown| PROSE[Render formatting]`

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 120">' +
  '<rect width="420" height="120" rx="24" fill="#e4f3ef"/>' +
  '<circle cx="70" cy="60" r="27" fill="#438b79"/>' +
  '<path d="M58 60l9 9 18-21" fill="none" stroke="white" stroke-width="7" ' +
  'stroke-linecap="round" stroke-linejoin="round"/>' +
  '<text x="120" y="69" fill="#173d34" font-family="Georgia, serif" font-size="26">' +
  'Raw SVG, rendered</text></svg>'

await rm(WORK, { recursive: true, force: true })
await mkdir(WORK, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: SIZE,
  deviceScaleFactor: 1,
  recordVideo: { dir: WORK, size: SIZE },
})
await context.grantPermissions(['clipboard-read', 'clipboard-write'])
const page = await context.newPage()

const beat = (ms) => page.waitForTimeout(ms)

async function caretToEnd() {
  await page.evaluate(() => window.simplemark.editor.focusEnd())
}

/**
 * Pastes as a person does: clipboard + the real key chord, so the sniffers run.
 *
 * focusEnd() opens a paragraph after a terminal rendered block rather than
 * dropping the caret into its source (BUG-2), so this no longer needs the
 * exitCode workaround it once carried.
 */
async function paste(text) {
  await caretToEnd()
  await page.keyboard.press('Enter')
  await page.evaluate((t) => navigator.clipboard.writeText(t), text)
  await page.keyboard.press('ControlOrMeta+v')
}

/** Smooth-scrolls so the eye follows the change instead of being teleported. */
async function reveal(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  await beat(700)
}

await page.goto(URL)
await page.waitForFunction(() => window.simplemark !== undefined)
await page.locator(EDITOR).waitFor()
await page.locator('.diagram .diagram-render svg').first().waitFor()
await beat(1400)

// 1 — ordinary typing, so it reads as an editor and not a viewer.
await caretToEnd()
await page.keyboard.press('Enter')
await page.keyboard.type('## Everything below was pasted', { delay: KEYSTROKE_MS })
await beat(900)

// 2 — Markdown becomes formatting, including a GFM table and task list.
await paste(MARKDOWN)
await reveal(page.locator(`${EDITOR} table`).last())
await beat(1600)

// 3 — bare Mermaid, no fence, no menu: recognised on paste.
await paste(MERMAID)
const diagram = page.locator('.diagram').last()
await diagram.locator('.diagram-render svg').waitFor({ timeout: 15_000 })
await reveal(diagram)
await beat(1800)

// 4 — edit the diagram's source and watch it re-render under the caret.
// The source editor is a sheet mounted on document.body, not a child of the
// diagram, so it is located globally rather than scoped to the figure.
await diagram.locator('.edit-source').click()
const source = page.locator('.diagram-source-sheet:not([hidden]) .diagram-source')
await source.waitFor()
await source.click()
await source.press('ControlOrMeta+a')
await page.keyboard.type(
  'flowchart LR\n  PASTE[Paste raw text] --> SNIFF{What is it?}\n' +
    '  SNIFF -->|Mermaid| DIAGRAM[Rendered, and still editable]',
  { delay: KEYSTROKE_MS },
)
await beat(1500)
await diagram.locator('.edit-source').click()
await beat(1400)

// 5 — raw SVG markup, same path.
await paste(SVG)
const picture = page.locator('.diagram').last()
await picture.locator('.diagram-render svg').waitFor({ timeout: 15_000 })
await reveal(picture)
await beat(1600)

// 6 — reader controls: typeface, size and background, applied to the whole document.
await page.getByRole('button', { name: 'Text formatting' }).click()
await beat(800)
await page.getByRole('button', { name: 'Larger text' }).click()
await beat(750)
await page.getByRole('button', { name: 'white background' }).click()
await beat(1500)
await page.getByRole('button', { name: 'Text formatting' }).click()
await beat(1500)

await page.close()
await context.close()
await browser.close()

// --- encode ------------------------------------------------------------------

const webm = (await readdir(WORK)).find((f) => f.endsWith('.webm'))
if (webm === undefined) throw new Error(`no video written to ${WORK}`)
const source_video = `${WORK}/${webm}`
await copyFile(source_video, `${WORK}/simplemark-demo.webm`)

// Two passes: a palette built from the whole clip, then applied with a light
// dither. Bayer keeps flat UI backgrounds from turning into noise, which both
// looks wrong and triples the file size.
// 10fps/760px/96 colours holds a README-sized file. The clip is mostly static
// prose, so stats_mode=diff spends the palette on what actually changes.
const filters =
  'fps=10,scale=760:-1:flags=lanczos,split[s0][s1];' +
  '[s0]palettegen=max_colors=96:stats_mode=diff[p];' +
  '[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle'

await mkdir('docs/assets', { recursive: true })
await run('ffmpeg', ['-y', '-i', source_video, '-vf', filters, '-loop', '0', GIF])

const { stdout } = await run('sh', ['-c', `ls -l ${GIF} | awk '{print $5}'`])
const bytes = Number(stdout.trim())
console.log(`${GIF} — ${(bytes / 1_048_576).toFixed(2)} MB`)
console.log(`source video kept at ${WORK}/simplemark-demo.webm`)
