import { describe, expect, it } from 'vitest'

import { WorkspacePins } from '../../src/app/workspace-pins.js'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

describe('WorkspacePins', () => {
  it('persists path identity across app instances without touching Markdown', () => {
    const storage = new MemoryStorage()
    const first = new WorkspacePins(storage)

    expect(first.toggle('/notes/a.md')).toBe(true)
    expect(first.has('/notes/a.md')).toBe(true)
    expect(new WorkspacePins(storage).has('/notes/a.md')).toBe(true)
    expect(first.toggle('/notes/a.md')).toBe(false)
    expect(new WorkspacePins(storage).has('/notes/a.md')).toBe(false)
  })

  it('treats corrupt preference data as an empty pin set', () => {
    const storage = new MemoryStorage()
    storage.setItem('simplemark.workspace-pins.v1', '{bad json')
    expect(new WorkspacePins(storage).has('/notes/a.md')).toBe(false)
  })
})
