import { describe, expect, it } from 'vitest'

import { TextCardRenderer } from '../../src/adapters/renderers/text-card-renderer.js'

/**
 * The paste-exhaust renderers return sanitised HTML through the same
 * DiagramRenderer contract as Mermaid and SVG: validate, then inert markup or
 * a message — never a throw. "Inert" is load-bearing: every fragment of the
 * source text must arrive escaped, because terminal output and JSON routinely
 * contain `<script>` and friends.
 */

const renderer = new TextCardRenderer()

describe('languages', () => {
  it('claims the five exhaust languages', () => {
    expect([...renderer.languages].sort()).toEqual(['ansi', 'diff', 'json', 'stacktrace', 'tree'])
  })
})

describe('ansi', () => {
  it('turns SGR codes into styled spans and escapes markup', async () => {
    const result = await renderer.render('ansi', '[32m✓ ok[0m <script>')
    if (!result.ok) throw new Error(result.message)
    // Colour detail lives in ansi-colour.test.ts; this pins the card contract.
    expect(result.markup).toContain('var(--ansi-2)')
    expect(result.markup).toContain('✓ ok')
    expect(result.markup).not.toContain('<script>')
    expect(result.markup).toContain('&lt;script&gt;')
  })
})

describe('diff', () => {
  it('classifies added, removed, and hunk lines', async () => {
    const result = await renderer.render(
      'diff',
      'diff --git a/x b/x\n@@ -1,2 +1,2 @@\n-old <b>\n+new\n context',
    )
    if (!result.ok) throw new Error(result.message)
    expect(result.markup).toContain('diff-hunk')
    expect(result.markup).toContain('diff-del')
    expect(result.markup).toContain('diff-add')
    expect(result.markup).toContain('&lt;b&gt;')
  })
})

describe('json', () => {
  it('renders an object as a collapsible tree', async () => {
    const result = await renderer.render('json', '{"name": "x", "tags": ["a", "b"]}')
    if (!result.ok) throw new Error(result.message)
    expect(result.markup).toContain('<details')
    expect(result.markup).toContain('&quot;name&quot;')
    expect(result.markup).toContain('&quot;a&quot;')
  })
  it('fails visibly on invalid JSON instead of guessing', async () => {
    const result = await renderer.render('json', '{ nope }')
    expect(result.ok).toBe(false)
  })
})

describe('tree and stacktrace', () => {
  it('renders a file tree as an escaped monospace card', async () => {
    const result = await renderer.render('tree', 'src\n├── a.ts\n└── <b>')
    if (!result.ok) throw new Error(result.message)
    expect(result.markup).toContain('├── a.ts')
    expect(result.markup).toContain('&lt;b&gt;')
  })
  it('collapses a stack trace behind its first line', async () => {
    const result = await renderer.render('stacktrace', 'Error: boom\n    at f (x.ts:1:2)')
    if (!result.ok) throw new Error(result.message)
    expect(result.markup).toContain('<summary')
    expect(result.markup).toContain('Error: boom')
    expect(result.markup).toContain('at f (x.ts:1:2)')
  })
})

describe('contract', () => {
  it('declines a language it does not own', async () => {
    const result = await renderer.render('mermaid', 'flowchart LR')
    expect(result.ok).toBe(false)
  })
})
