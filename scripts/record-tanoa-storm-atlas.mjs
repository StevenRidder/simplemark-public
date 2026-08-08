/** Record the 22-second Project Tanoa Storm Atlas paste-and-edit demo. */
import { copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const run = promisify(execFile)
const URL = process.env.SIMPLEMARK_SHOWCASE_URL ?? 'http://localhost:5273'
const WORK = '.artifacts/tanoa-storm-atlas'
const REPORT_PATH = process.env.SIMPLEMARK_STORM_ATLAS_REPORT
  ?? 'docs/showcase/project-tanoa-storm-atlas.md'
const GIF = process.env.SIMPLEMARK_STORM_ATLAS_GIF
  ?? 'docs/assets/project-tanoa-storm-atlas.gif'
const CANDIDATE_GIF = `${WORK}/project-tanoa-storm-atlas.gif`
const SIZE = { width: 1000, height: 625 }
const DURATION_MS = 22_000
const PASTE_MARKER = '<!-- simplemark-storm-atlas:paste -->'
const FINAL_MARKER = '<!-- simplemark-storm-atlas:final -->'

const report = await readFile(REPORT_PATH, 'utf8')
const markerCount = (marker) => report.split(marker).length - 1
if (markerCount(PASTE_MARKER) !== 1 || markerCount(FINAL_MARKER) !== 1) {
  throw new Error('Storm Atlas beat markers must each occur exactly once')
}

const pasteAt = report.indexOf(PASTE_MARKER)
const finalAt = report.indexOf(FINAL_MARKER)
if (finalAt < pasteAt) throw new Error('Storm Atlas beat markers are out of order')

const opening = report.slice(0, pasteAt).trimEnd()
const middle = report.slice(pasteAt + PASTE_MARKER.length, finalAt).trim()
const ending = report.slice(finalAt + FINAL_MARKER.length).trim()
const acceptedMermaidFlow = 'Commissioning load,Deferred before shelter,2.5'
const unsafeMermaidFlow = 'Battery,Commissioning load,2.5'
const acceptedVegaFloor = '"floor":42'
const staleVegaFloor = '"floor":35'
const acceptedMermaidCount = middle.split(acceptedMermaidFlow).length - 1
const acceptedVegaCount = middle.split(acceptedVegaFloor).length - 1
if (acceptedMermaidCount !== 1 || acceptedVegaCount !== 1) {
  throw new Error(
    `Storm Atlas paste needs one Mermaid flow and one Vega floor; found ${acceptedMermaidCount} and ${acceptedVegaCount}`,
  )
}
const beforeCorrection = middle
  .replace(acceptedMermaidFlow, unsafeMermaidFlow)
  .replace(acceptedVegaFloor, staleVegaFloor)

if (!opening.includes('# Project Tanoa: the storm atlas') || !opening.includes('```vega-lite')) {
  throw new Error('Storm Atlas opening must contain the title and storm map')
}
if (!middle.includes('```ansi') || !middle.includes('The safe model')) {
  throw new Error('Storm Atlas paste must contain the reserve and terminal evidence')
}
if (beforeCorrection === middle
  || beforeCorrection.includes(acceptedMermaidFlow)
  || beforeCorrection.includes(acceptedVegaFloor)) {
  throw new Error('Storm Atlas must prepare one unsafe Mermaid branch and one 35% Vega floor')
}
if (!ending.includes('## VI. Island mode') || !ending.includes('```svg')) {
  throw new Error('Storm Atlas ending must contain the island-mode panel')
}

console.log('opening: storm map')
console.log('mermaid: battery branch → deferred before shelter')
console.log('vega: reserve floor 35% → 42%')
console.log('final: island mode holding')
console.log('duration: 22 seconds')

if (process.argv.includes('--verify-content')) process.exit(0)

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
    const handle = await root.getFileHandle('project-tanoa-storm-atlas.md', { create: true })
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
await page.getByRole('heading', { name: 'Project Tanoa: the storm atlas' }).waitFor()
const stormMap = page.locator('.diagram').filter({
  has: page.locator('.diagram-label', { hasText: 'vega-lite' }),
}).first()
await stormMap.locator('.diagram-render svg').waitFor({ timeout: 30_000 })
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

// Establish the place first: title, then the sourced coastline and storm field.
await at(650)
await reveal(stormMap)

// One real paste brings in the committee decision and its technical evidence.
await at(2_350)
await paste(beforeCorrection)
const sankey = page.locator('.diagram').filter({
  has: page.locator('.diagram-label', { hasText: 'mermaid' }),
}).first()
await sankey.locator('.diagram-render svg').waitFor({ timeout: 30_000 })
const reserveChart = page.locator('.diagram').filter({
  has: page.locator('.diagram-label', { hasText: 'vega-lite' }),
}).nth(1)
await reserveChart.locator('.diagram-render svg').waitFor({ timeout: 30_000 })

await at(4_400)
await reveal(sankey)

// The Mermaid source edit visibly reroutes the optional commissioning branch.
await at(5_400)
await sankey.getByRole('button', { name: 'Edit source' }).click()
let source = page.locator('.diagram-source-sheet:not([hidden]) .diagram-source')
let sourceText = await source.inputValue()
const unsafeFlowAt = sourceText.indexOf(unsafeMermaidFlow)
if (unsafeFlowAt < 0) throw new Error('The visible Mermaid source does not contain the unsafe battery branch')
await source.evaluate((element, selection) => {
  element.focus()
  element.setSelectionRange(selection.start, selection.end)
  element.scrollTop = element.scrollHeight
}, { start: unsafeFlowAt, end: unsafeFlowAt + unsafeMermaidFlow.length })
await page.waitForTimeout(300)
await page.keyboard.type(acceptedMermaidFlow, { delay: 42 })
await page.waitForTimeout(250)
if (!((await source.inputValue()).includes(acceptedMermaidFlow))) {
  throw new Error('The Mermaid source edit did not defer the commissioning load')
}
await page.getByRole('button', { name: 'Close source editor' }).click()
await sankey.locator('.diagram-render').filter({ hasText: 'Deferred before shelter' }).waitFor({ timeout: 30_000 })
await at(8_400)
await reveal(sankey)

await at(9_800)
await reveal(reserveChart)

// The Vega source edit moves both the floor rule and its generated label.
await at(11_000)
await reserveChart.getByRole('button', { name: 'Edit source' }).click()
source = page.locator('.diagram-source-sheet:not([hidden]) .diagram-source')
sourceText = await source.inputValue()
const staleFloorAt = sourceText.indexOf(staleVegaFloor)
if (staleFloorAt < 0) throw new Error('The visible Vega source does not contain the 35% reserve floor')
const floorDigitsAt = staleFloorAt + staleVegaFloor.indexOf('35')
await source.evaluate((element, index) => {
  element.focus()
  element.setSelectionRange(index, index + 2)
  element.scrollTop = element.scrollHeight
}, floorDigitsAt)
await page.waitForTimeout(300)
await page.keyboard.type('42', { delay: 170 })
await page.waitForTimeout(350)
if (!((await source.inputValue()).includes(acceptedVegaFloor))) {
  throw new Error('The visible Vega correction did not produce the 42% floor')
}
if (await page.locator('.diagram-error:visible').count()) {
  throw new Error('A Storm Atlas graphical edit produced a visible renderer error')
}
await page.getByRole('button', { name: 'Close source editor' }).click()
await reserveChart.locator('.diagram-render').filter({ hasText: 'community floor · 42%' }).waitFor({ timeout: 30_000 })
await page.keyboard.press('Escape')
await at(13_100)
await reveal(reserveChart)

await at(14_700)
await reveal(page.locator('.ansi-card'))

// The final paste lands the calm, full-width island-mode status panel.
await at(16_700)
await paste(ending)
await page.getByRole('heading', { name: 'VI. Island mode' }).waitFor()
const finalPanel = page.locator('.diagram').filter({
  has: page.locator('.diagram-label', { hasText: /^svg$/ }),
})
await finalPanel.locator('.diagram-render svg').waitFor({ timeout: 30_000 })
await reveal(finalPanel)
await at(DURATION_MS)

const visibleErrors = await page.locator('.diagram-error:visible').count()
if (visibleErrors !== 0) throw new Error(`Storm Atlas finished with ${visibleErrors} renderer errors`)

const video = page.video()
await page.close()
await context.close()
await browser.close()
if (!video) throw new Error('Playwright did not create a Storm Atlas video')
const recorded = await video.path()
const sourceVideo = `${WORK}/project-tanoa-storm-atlas.webm`
await copyFile(recorded, sourceVideo)

const filters =
  'fps=6,scale=1000:625:flags=lanczos,split[s0][s1];'
  + '[s0]palettegen=max_colors=48:stats_mode=diff[p];'
  + '[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle'

await mkdir('docs/assets', { recursive: true })
await run('ffmpeg', [
  '-y', '-i', sourceVideo,
  '-ss', readyOffsetSeconds.toFixed(3), '-t', '22',
  '-filter_complex', filters,
  '-loop', '0', CANDIDATE_GIF,
], { maxBuffer: 8_000_000 })

const { stdout } = await run('ffprobe', [
  '-v', 'error', '-select_streams', 'v:0', '-count_frames',
  '-show_entries', 'stream=width,height,nb_read_frames:format=duration',
  '-of', 'json', CANDIDATE_GIF,
])
const metadata = JSON.parse(stdout)
const stream = metadata.streams?.[0]
const bytes = (await stat(CANDIDATE_GIF)).size
if (stream?.width !== 1000 || stream?.height !== 625) throw new Error('Storm Atlas GIF is not 1000 × 625')
if (Number(stream?.nb_read_frames) !== 132) {
  throw new Error(`Storm Atlas GIF has ${stream?.nb_read_frames} frames, not 132`)
}
if (bytes > 5_242_880) {
  throw new Error(`Storm Atlas GIF is ${(bytes / 1_048_576).toFixed(2)} MB; the limit is 5 MB`)
}

await copyFile(CANDIDATE_GIF, GIF)
const rawVideos = (await readdir(WORK)).filter((name) => name.endsWith('.webm'))
console.log(`${GIF} — ${(bytes / 1_048_576).toFixed(2)} MB · 1000 × 625 · 132 frames · 22 seconds`)
console.log(`source video: ${sourceVideo} (${rawVideos.length} recording file${rawVideos.length === 1 ? '' : 's'})`)
