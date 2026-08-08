import { defineConfig } from 'vitest/config'

// ADR-0001: `domain` and `application` must run without a DOM. The default
// environment is deliberately `node` so that a DOM dependency leaking into
// either module fails the suite rather than passing under a jsdom shim.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
