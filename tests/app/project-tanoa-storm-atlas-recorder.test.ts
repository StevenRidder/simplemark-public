import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const recorder = resolve('scripts/record-tanoa-storm-atlas.mjs')

describe('Project Tanoa Storm Atlas recorder', () => {
  it('prepares two graphical source edits and a 22-second final cut', () => {
    const result = spawnSync(process.execPath, [recorder, '--verify-content'], {
      cwd: resolve('.'),
      encoding: 'utf8',
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('opening: storm map')
    expect(result.stdout).toContain('mermaid: battery branch → deferred before shelter')
    expect(result.stdout).toContain('vega: reserve floor 35% → 42%')
    expect(result.stdout).toContain('final: island mode holding')
    expect(result.stdout).toContain('duration: 22 seconds')
  })
})
