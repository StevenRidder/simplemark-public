import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

/**
 * Builds the EDITOR-17 CSP spike as a production bundle rather than serving it
 * from the dev server. The dev server injects an inline HMR script, which the
 * packaged policy would block for reasons that have nothing to do with Vega —
 * a failure that would tell us nothing. A built bundle loads one module script
 * from the same origin, exactly like the packaged app.
 */
export default defineConfig({
  // Resolved from this file, so `vite build --config vite.spike.config.ts`
  // works from the repo root. Run it from elsewhere and the preview server
  // serves the wrong directory.
  root: fileURLToPath(new URL('spike/vega-csp', import.meta.url)),
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  preview: { port: 5399, strictPort: true },
})
