import { describe, expect, it } from 'vitest'

import { VisitHistory, WorkspaceHistoryStore } from '../../src/app/workspace-history.js'
import type { Visit } from '../../src/app/workspace-history.js'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

const visit = (handle: string, collectionId = 'recent'): Visit => ({ handle, collectionId })

/** Walks a route so a test reads like the note-hopping it describes. */
const walk = (...handles: readonly string[]): VisitHistory => {
  const history = new VisitHistory()
  for (const handle of handles) history.visit(visit(handle))
  return history
}

describe('VisitHistory', () => {
  it('goes nowhere until somewhere has been visited', () => {
    const history = new VisitHistory()
    expect(history.canBack()).toBe(false)
    expect(history.canForward()).toBe(false)
    expect(history.back()).toBeUndefined()
    expect(history.forward()).toBeUndefined()
    expect(history.current()).toBeUndefined()
  })

  it('has nowhere to go back to from the only note ever opened', () => {
    const history = walk('/a.md')
    expect(history.current()).toEqual(visit('/a.md'))
    expect(history.canBack()).toBe(false)
    expect(history.canForward()).toBe(false)
  })

  it('retraces the order notes were opened in, not their recency', () => {
    // The distinction from a most-recently-used list: after A → B → C, going
    // back twice reaches A. An MRU would have reordered itself on each visit
    // and oscillated between the last two notes instead.
    const history = walk('/a.md', '/b.md', '/c.md')
    expect(history.back()).toEqual(visit('/b.md'))
    expect(history.back()).toEqual(visit('/a.md'))
    expect(history.canBack()).toBe(false)
    expect(history.forward()).toEqual(visit('/b.md'))
    expect(history.forward()).toEqual(visit('/c.md'))
    expect(history.canForward()).toBe(false)
  })

  it('discards the forward branch when a new note is opened mid-stack', () => {
    const history = walk('/a.md', '/b.md', '/c.md')
    history.back()
    expect(history.canForward()).toBe(true)

    history.visit(visit('/d.md'))

    expect(history.canForward()).toBe(false)
    expect(history.entries()).toEqual([visit('/a.md'), visit('/b.md'), visit('/d.md')])
    expect(history.back()).toEqual(visit('/b.md'))
  })

  it('ignores reopening the note already showing', () => {
    const history = walk('/a.md', '/b.md')
    history.visit(visit('/b.md'))
    history.visit(visit('/b.md'))
    expect(history.entries()).toHaveLength(2)
    expect(history.back()).toEqual(visit('/a.md'))
  })

  it('treats the same note in a different collection as a different place', () => {
    // Going back has to restore the list you were browsing as well as the note,
    // so the collection is part of the entry's identity rather than a decoration.
    const history = new VisitHistory()
    history.visit(visit('/a.md', 'recent'))
    history.visit(visit('/a.md', '/Work'))
    expect(history.entries()).toHaveLength(2)
    expect(history.back()).toEqual(visit('/a.md', 'recent'))
  })

  it('keeps a bounded stack, dropping the oldest visits first', () => {
    const history = new VisitHistory()
    for (let index = 0; index < 260; index += 1) history.visit(visit(`/note-${index}.md`))
    const entries = history.entries()
    expect(entries).toHaveLength(200)
    expect(entries[0]).toEqual(visit('/note-60.md'))
    expect(history.current()).toEqual(visit('/note-259.md'))
    expect(history.canForward()).toBe(false)
  })

  it('drops entries the workspace can no longer reach, holding the cursor back', () => {
    const history = walk('/a.md', '/gone.md', '/b.md', '/c.md')
    history.back() // now on /b.md
    history.retain((entry) => entry.handle !== '/gone.md')

    expect(history.entries()).toEqual([visit('/a.md'), visit('/b.md'), visit('/c.md')])
    expect(history.current()).toEqual(visit('/b.md'))
    expect(history.back()).toEqual(visit('/a.md'))
    expect(history.forward()).toEqual(visit('/b.md'))
  })

  it('survives every entry becoming unreachable', () => {
    const history = walk('/a.md', '/b.md')
    history.retain(() => false)
    expect(history.entries()).toEqual([])
    expect(history.canBack()).toBe(false)
    expect(history.canForward()).toBe(false)
    expect(history.current()).toBeUndefined()
  })
})

describe('WorkspaceHistoryStore', () => {
  it('carries the stack and the cursor across app instances', () => {
    const storage = new MemoryStorage()
    const history = walk('/a.md', '/b.md', '/c.md')
    history.back()
    new WorkspaceHistoryStore(storage).save(history)

    const restored = new WorkspaceHistoryStore(storage).load()
    expect(restored.current()).toEqual(visit('/b.md'))
    expect(restored.canBack()).toBe(true)
    expect(restored.canForward()).toBe(true)
    expect(restored.forward()).toEqual(visit('/c.md'))
  })

  it('treats a corrupt blob as an empty history rather than failing a launch', () => {
    const storage = new MemoryStorage()
    storage.setItem('simplemark.workspace-history.v1', '{bad json')
    expect(new WorkspaceHistoryStore(storage).load().entries()).toEqual([])
  })

  it('discards entries that are not visits and clamps a cursor beyond the stack', () => {
    const storage = new MemoryStorage()
    storage.setItem('simplemark.workspace-history.v1', JSON.stringify({
      entries: [visit('/a.md'), { handle: 42 }, null, { handle: '', collectionId: 'recent' }],
      cursor: 99,
    }))
    const restored = new WorkspaceHistoryStore(storage).load()
    expect(restored.entries()).toEqual([visit('/a.md')])
    expect(restored.current()).toEqual(visit('/a.md'))
    expect(restored.canForward()).toBe(false)
  })

  it('keeps working when storage refuses to accept a write', () => {
    const readOnly = {
      getItem: (): string | null => null,
      setItem: (): void => { throw new Error('quota exceeded') },
    }
    const history = walk('/a.md', '/b.md')
    expect(() => new WorkspaceHistoryStore(readOnly).save(history)).not.toThrow()
    expect(history.back()).toEqual(visit('/a.md'))
  })
})
