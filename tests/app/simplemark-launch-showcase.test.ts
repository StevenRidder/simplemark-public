import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PATH = resolve('docs/showcase/simplemark-1.0-launch-plan.md')

describe('SimpleMark 1.0 launch showcase', () => {
  it('exists as a candid planning document', () => {
    expect(existsSync(PATH)).toBe(true)
    if (!existsSync(PATH)) return
    const source = readFileSync(PATH, 'utf8')
    expect(source).toContain('Planning document — not a shipped-product claim')
    for (const label of ['Current evidence', '1.0 gate', 'Target', 'Decision']) {
      expect(source).toContain(`**${label}**`)
    }
    expect(source).not.toMatch(/markmap|1\.0 is available|has launched|customer testimonial/iu)
  })

  it('keeps its repository evidence links portable', () => {
    if (!existsSync(PATH)) return
    const source = readFileSync(PATH, 'utf8')
    const links = [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
      .map((match) => match[1] ?? '')
      .filter((link) => !link.startsWith('#') && !/^[a-z]+:/iu.test(link))
    expect(links.length).toBeGreaterThan(5)
    for (const link of links) {
      expect(existsSync(resolve(dirname(PATH), link.split('#')[0] ?? '')), link).toBe(true)
    }
  })

  it('uses current renderers to carry decisions rather than catalogue features', () => {
    if (!existsSync(PATH)) return
    const source = readFileSync(PATH, 'utf8')
    expect(source).toContain('```dot')
    expect(source).toContain('```json')
    expect(source).toContain('```tree')
    expect(source).toContain('```bash')
    expect(source).toContain('| Risk |')
  })
})
