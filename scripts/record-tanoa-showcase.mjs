/** Record the 17-second Project Tanoa paste-and-edit demo in the current web UI. */
import { copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const run = promisify(execFile)
const URL = process.env.SIMPLEMARK_SHOWCASE_URL ?? 'http://localhost:5273'
const WORK = '.artifacts/tanoa-showcase'
const REPORT_PATH = 'docs/showcase/project-tanoa.md'
const GIF = 'docs/assets/project-tanoa-showcase.gif'
const SIZE = { width: 1000, height: 625 }
const DURATION_MS = 17_000
const PASTE_MARKER = '[simplemark-showcase-paste]: <simplemark:paste>'
const FINAL_MARKER = '[simplemark-showcase-final]: <simplemark:final>'

const report = await readFile(REPORT_PATH, 'utf8')
const pasteAt = report.indexOf(PASTE_MARKER)
const finalAt = report.indexOf(FINAL_MARKER)
if (pasteAt < 0 || finalAt < pasteAt) throw new Error('Project Tanoa beat markers are missing or out of order')

const opening = report.slice(0, pasteAt).trimEnd()
const middle = report.slice(pasteAt + PASTE_MARKER.length, finalAt).trim()
const ending = report.slice(finalAt + FINAL_MARKER.length).trim()
const beforeCorrection = middle.replace('"reserve_floor": 0.42', '"reserve_floor": 0.35')
if (beforeCorrection === middle) throw new Error('Project Tanoa JSON correction was not found')

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

await page.addInitScript(({ markdown }) => {
  window.showOpenFilePicker = async () => {
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle('project-tanoa.md', { create: true })
    const writable = await handle.createWritable()
    await writable.write(markdown)
    await writable.close()
    return [handle]
  }
}, { markdown: opening })

const videoStarted = Date.now()
await page.goto(URL)
await page.waitForFunction(() => window.simplemark !== undefined)
await page.getByRole('button', { name: 'Open file' }).click()
await page.getByRole('heading', { name: 'Holding the island through the storm' }).waitFor()
await page.locator('.diagram .diagram-render svg').first().waitFor({ timeout: 30_000 })
const readyOffsetSeconds = (Date.now() - videoStarted) / 1000
const started = Date.now()

const at = async (milliseconds) => {
  const wait = started + milliseconds - Date.now()
  if (wait > 0) await page.waitForTimeout(wait)
}

const paste = async (markdown) => {
  await page.evaluate(() => window.simplemark.editor.focusEnd())
  await page.keyboard.press('Enter')
  await page.evaluate((text) => navigator.clipboard.writeText(text), markdown)
  await page.keyboard.press('ControlOrMeta+v')
}

const reveal = async (locator) => {
  await locator.evaluate((element) => element.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  await page.waitForTimeout(450)
}

// Opening map and 14-minute decision clock.
await at(1_850)

// One real paste supplies the technical evidence and lets every renderer wake up.
await paste(beforeCorrection)
await page.locator('.diagram .diagram-render svg').nth(3).waitFor({ timeout: 30_000 })

await at(5_100)
await reveal(page.locator('h3').filter({ hasText: 'The forecast changed the arithmetic' }))

await at(7_500)
await reveal(page.locator('.ansi-card'))

// Contextual source edit: 0.35 becomes the approved 0.42 in view.
await at(9_500)
const json = page.locator('.diagram').filter({ has: page.locator('.diagram-label', { hasText: 'json' }) })
await reveal(json)
await json.getByRole('button', { name: 'Edit source' }).click()
const source = page.locator('.diagram-source-sheet:not([hidden]) .diagram-source')
const sourceText = await source.inputValue()
const oldFloor = sourceText.indexOf('0.35')
if (oldFloor < 0) throw new Error('The visible JSON source does not contain 0.35')
await source.evaluate((element, index) => {
  element.focus()
  element.setSelectionRange(index, index + 4)
}, oldFloor)
await page.waitForTimeout(300)
const correctedSource = sourceText.replace('"reserve_floor": 0.35', '"reserve_floor": 0.42')
if (correctedSource === sourceText) throw new Error('The JSON source correction could not be applied')
await source.fill(correctedSource)
await page.waitForTimeout(500)
if (await page.locator('.diagram-error:visible').count()) {
  throw new Error('The JSON correction produced a visible renderer error')
}
await page.getByRole('button', { name: 'Close source editor' }).click()
await page.locator('.json-card').filter({ hasText: '0.42' }).waitFor()

// The successful handover lands as the final paste and closes the story.
await at(13_100)
await paste(ending)
await page.getByRole('heading', { name: 'Island mode confirmed' }).waitFor()
await reveal(page.locator('.callout-tip').filter({ hasText: 'island is holding' }))
await at(DURATION_MS)

const video = page.video()
await page.close()
await context.close()
await browser.close()
if (!video) throw new Error('Playwright did not create a showcase video')
const recorded = await video.path()
const sourceVideo = `${WORK}/project-tanoa-showcase.webm`
await copyFile(recorded, sourceVideo)

const filters =
  'fps=6,scale=1000:625:flags=lanczos,split[s0][s1];'
  + '[s0]palettegen=max_colors=96:stats_mode=diff[p];'
  + '[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle'

await mkdir('docs/assets', { recursive: true })
await run('ffmpeg', [
  '-y', '-i', sourceVideo,
  '-ss', readyOffsetSeconds.toFixed(3), '-t', '17',
  '-filter_complex', filters,
  '-loop', '0', GIF,
], { maxBuffer: 8_000_000 })

const { stdout } = await run('ffprobe', [
  '-v', 'error', '-select_streams', 'v:0', '-count_frames',
  '-show_entries', 'stream=width,height,nb_read_frames:format=duration',
  '-of', 'json', GIF,
])
const metadata = JSON.parse(stdout)
const stream = metadata.streams?.[0]
const bytes = (await stat(GIF)).size
if (stream?.width !== 1000 || stream?.height !== 625) throw new Error('GIF is not 1000 × 625')
if (Number(stream?.nb_read_frames) !== 102) throw new Error(`GIF has ${stream?.nb_read_frames} frames, not 102`)
if (bytes > 5_242_880) throw new Error(`GIF is ${(bytes / 1_048_576).toFixed(2)} MB; the limit is 5 MB`)

const rawVideos = (await readdir(WORK)).filter((name) => name.endsWith('.webm'))
console.log(`${GIF} — ${(bytes / 1_048_576).toFixed(2)} MB · 1000 × 625 · 102 frames · 17 seconds`)
console.log(`source video: ${sourceVideo} (${rawVideos.length} recording file${rawVideos.length === 1 ? '' : 's'})`)
