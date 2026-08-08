import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The shell's CSP, asserted as a policy rather than as a string.
 *
 * This file exists because of a failure the rest of the suite structurally
 * cannot see. Vitest runs in Node and the Playwright suite drives the Vite dev
 * server; neither applies this CSP, so every renderer test passes in an
 * environment with no policy at all while the packaged app refuses to run the
 * Graphviz wasm. The bug was invisible until someone opened a `dot` block in
 * the desktop build.
 *
 * A lock here is the cheap half of the answer — it cannot prove WebKit honours
 * the directive, only that nobody removed it by accident. The other half is
 * running the real shell, which `docs/RENDERERS.md` §4.6 now asks for.
 */

interface NativeConfig {
  app: { security: { csp: string } }
}

const config = JSON.parse(
  readFileSync(join(process.cwd(), 'src-tauri', 'tauri.conf.json'), 'utf8'),
) as NativeConfig

const directives = new Map(
  config.app.security.csp
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive !== '')
    .map((directive) => {
      const [name, ...sources] = directive.split(/\s+/)
      return [name as string, sources] as const
    }),
)

describe('shell content security policy', () => {
  it('lets the Graphviz wasm compile', () => {
    // Without this, WebKit refuses the module and every ```dot block in the
    // document reports an engine failure instead of drawing a graph.
    expect(directives.get('script-src')).toContain("'wasm-unsafe-eval'")
  })

  it('buys wasm without buying eval', () => {
    // 'unsafe-eval' would also unblock Graphviz, and would hand back eval() and
    // new Function() across the whole document to do it. 'wasm-unsafe-eval' is
    // the narrow grant: wasm compilation, nothing else.
    const scriptSrc = directives.get('script-src') ?? []
    expect(scriptSrc).toContain("'self'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
    expect(scriptSrc).not.toContain("'unsafe-inline'")
  })

  it('keeps the default closed and admits no remote origin', () => {
    expect(directives.get('default-src')).toEqual(["'self'"])

    const remote = [...directives.values()]
      .flat()
      .filter((source) => /^(https?:)?\/\//.test(source))
      .filter((source) => !source.endsWith('.localhost'))
    expect(remote).toEqual([])
    expect([...directives.values()].flat()).not.toContain('*')
  })
})
