import { resolve } from 'node:path'

import { defineConfig } from 'vite'

// One build for both shells. `index.html` loads the browser entrypoint and
// `tauri.html` the native one; every module beneath them is shared (ADR-0001).
export default defineConfig({
  server: { port: 5273, strictPort: true },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        // The spike is built alongside the app so it always exercises the same
        // modules; it is never linked from the product entrypoint.
        main: resolve(__dirname, 'index.html'),
        // The native shell's entrypoint. Same modules, same build — only the
        // port wiring differs (ADR-0001 §Web and native shells).
        tauri: resolve(__dirname, 'tauri.html'),
        fidelity: resolve(__dirname, 'spike/fidelity/index.html'),
      },
    },
  },
})
