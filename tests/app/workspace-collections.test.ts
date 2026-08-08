import { describe, expect, it } from 'vitest'

import type { WorkspaceCatalog, WorkspaceCatalogEntry } from '../../src/application/index.js'
import {
  WorkspaceCollections,
  WorkspaceFolderStore,
  WorkspaceHiddenStore,
  WorkspaceRecentStore,
} from '../../src/app/workspace-collections.js'

const note = (handle: string): WorkspaceCatalogEntry => ({
  handle,
  name: handle.split('/').pop()!,
  modifiedMs: 1,
  createdMs: 1,
})

const folder = (handle: string, ...names: string[]): WorkspaceCatalog => ({
  handle,
  name: handle.split('/').pop()!,
  notes: names.map((name) => note(`${handle}/${name}`)),
})

describe('WorkspaceCollections', () => {
  it('keeps Recent Notes isolated from every adopted folder', () => {
    const collections = new WorkspaceCollections()
    collections.rememberRecent(note('/one/a.md'))
    collections.rememberRecent(note('/two/b.md'))
    collections.addFolder(folder('/project-a', 'a.md', 'b.md', 'c.md'))
    collections.addFolder(folder('/research', 'x.md', 'y.md'))

    expect(collections.recentNotes('/two').notes.map((entry) => entry.handle)).toEqual([
      '/two/b.md',
      '/one/a.md',
    ])
    expect(collections.folder('/project-a')?.notes).toHaveLength(3)
    expect(collections.folders().map((entry) => entry.name)).toEqual(['project-a', 'research'])
  })

  it('reopening a file makes it recent without duplicating it', () => {
    const collections = new WorkspaceCollections()
    collections.rememberRecent(note('/one/a.md'))
    collections.rememberRecent(note('/two/b.md'))
    collections.rememberRecent(note('/one/a.md'))

    expect(collections.recentCount()).toBe(2)
    expect(collections.recentNotes('/one').notes.map((entry) => entry.handle)).toEqual([
      '/one/a.md',
      '/two/b.md',
    ])
  })

  it('switches collections without copying unopened folder notes into Recent Notes', () => {
    const collections = new WorkspaceCollections()
    collections.rememberRecent(note('/loose.md'))
    collections.addFolder(folder('/project-a', 'one.md', 'two.md'))

    expect(collections.collection('/project-a', '/').notes).toHaveLength(2)
    expect(collections.collection('recent', '/').notes.map((entry) => entry.handle)).toEqual([
      '/loose.md',
    ])
  })

  it('forgets a Recent Notes entry without removing it from an adopted folder', () => {
    const collections = new WorkspaceCollections()
    collections.rememberRecent(note('/project-a/a.md'))
    collections.rememberRecent(note('/loose.md'))
    collections.addFolder(folder('/project-a', 'a.md', 'b.md'))

    collections.forgetRecent('/project-a/a.md')

    expect(collections.recentNotes('/').notes.map((entry) => entry.handle)).toEqual(['/loose.md'])
    expect(collections.folder('/project-a')?.notes.map((entry) => entry.handle)).toContain('/project-a/a.md')
  })

  it('keeps an explicitly hidden folder note out of every folder repaint', () => {
    const collections = new WorkspaceCollections()
    collections.addFolder(folder('/project-a', 'a.md', 'b.md'))

    collections.hideFromFolders('/project-a/a.md')
    collections.addFolder(folder('/project-a', 'a.md', 'b.md', 'c.md'))

    expect(collections.folder('/project-a')?.notes.map((entry) => entry.handle)).toEqual([
      '/project-a/b.md',
      '/project-a/c.md',
    ])
    expect(collections.hiddenHandles()).toEqual(['/project-a/a.md'])
  })

  it('does not treat a hidden on-disk note as a new member on every refresh', () => {
    const collections = new WorkspaceCollections()
    collections.addFolder(folder('/project-a', 'a.md', 'b.md'))
    collections.hideFromFolders('/project-a/a.md')

    const first = collections.refreshFolder(folder('/project-a', 'a.md', 'b.md'))
    const second = collections.refreshFolder(folder('/project-a', 'a.md', 'b.md'))

    expect(first.membershipChanged).toBe(false)
    expect(second.membershipChanged).toBe(false)
    expect(second.previous?.notes.map((entry) => entry.handle)).toEqual(['/project-a/b.md'])
    expect(second.current.notes.map((entry) => entry.handle)).toEqual(['/project-a/b.md'])
  })

  it('still reports a real visible add or removal exactly once', () => {
    const collections = new WorkspaceCollections()
    collections.addFolder(folder('/project-a', 'a.md', 'b.md'))
    collections.hideFromFolders('/project-a/a.md')

    const added = collections.refreshFolder(folder('/project-a', 'a.md', 'b.md', 'c.md'))
    const stable = collections.refreshFolder(folder('/project-a', 'a.md', 'b.md', 'c.md'))
    const removed = collections.refreshFolder(folder('/project-a', 'a.md', 'c.md'))

    expect(added.membershipChanged).toBe(true)
    expect(stable.membershipChanged).toBe(false)
    expect(removed.membershipChanged).toBe(true)
  })
})

describe('WorkspaceFolderStore', () => {
  it('persists only unique adopted folder handles', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value) },
    }
    const store = new WorkspaceFolderStore(storage)

    store.save(['/project-a', '/research', '/project-a'])

    expect(store.load()).toEqual(['/project-a', '/research'])
  })

  it('treats corrupt or obsolete persisted data as empty', () => {
    const storage = {
      getItem: (): string | null => '{not-json',
      setItem: (): void => {},
    }

    expect(new WorkspaceFolderStore(storage).load()).toEqual([])
  })
})

describe('WorkspaceRecentStore', () => {
  it('persists deduplicated history in most-recent-first order', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value) },
    }
    const store = new WorkspaceRecentStore(storage)

    store.save(['/two.md', '/one.md', '/two.md'])

    expect(store.load()).toEqual(['/two.md', '/one.md'])
  })

  it('treats corrupt history as empty', () => {
    const storage = {
      getItem: (): string | null => '{not-json',
      setItem: (): void => {},
    }

    expect(new WorkspaceRecentStore(storage).load()).toEqual([])
  })
})

describe('WorkspaceHiddenStore', () => {
  it('persists folder-view exclusions without storing note content', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value) },
    }
    const store = new WorkspaceHiddenStore(storage)

    store.save(['/project/a.md', '/project/b.md', '/project/a.md'])

    expect(store.load()).toEqual(['/project/a.md', '/project/b.md'])
  })
})
