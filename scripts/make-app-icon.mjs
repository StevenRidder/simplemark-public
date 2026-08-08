#!/usr/bin/env node
/**
 * Builds the macOS app icon from one SVG source.
 *
 * The icon is a generated artifact with a recipe in the repo rather than a
 * binary somebody once exported and nobody can reproduce. Run it after editing
 * `src-tauri/icons/icon.svg`:
 *
 *   node scripts/make-app-icon.mjs
 *
 * Chromium renders the SVG (the same engine the app ships in) and macOS
 * `iconutil` packs the sizes into `icon.icns`.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const iconsDir = resolve(root, 'src-tauri/icons')
const iconset = resolve(iconsDir, 'icon.iconset')

/** The iconset names macOS requires, with the pixel size each one needs. */
const VARIANTS = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

const svg = readFileSync(resolve(iconsDir, 'icon.svg'), 'utf8')

rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [name, size] of VARIANTS) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<body style="margin:0">${svg.replace('<svg', `<svg width="${size}" height="${size}"`)}</body>`,
  )
  await page.screenshot({ path: resolve(iconset, name), omitBackground: true })
}
// Tauri also wants a plain PNG for non-macOS bundles and the dev icon.
await page.setViewportSize({ width: 512, height: 512 })
await page.setContent(`<body style="margin:0">${svg.replace('<svg', '<svg width="512" height="512"')}</body>`)
await page.screenshot({ path: resolve(iconsDir, 'icon.png'), omitBackground: true })
await browser.close()

execFileSync('iconutil', ['-c', 'icns', iconset, '-o', resolve(iconsDir, 'icon.icns')], {
  stdio: 'inherit',
})
rmSync(iconset, { recursive: true, force: true })
console.log('icon.icns and icon.png rebuilt from icon.svg')
