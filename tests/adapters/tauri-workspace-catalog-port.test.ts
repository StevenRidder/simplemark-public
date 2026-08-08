import { describe, expect, it } from 'vitest'

import { TauriWorkspaceCatalogPort } from '../../src/adapters/filesystem/tauri-workspace-catalog-port.js'
import type { TauriInvoke } from '../../src/adapters/filesystem/tauri-file-port.js'

describe('TauriWorkspaceCatalogPort', () => {
  it('inspects only the explicitly opened note for Recent Notes', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    const invoke: TauriInvoke = async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, ...(args === undefined ? {} : { args }) })
      return {
        handle: '/Downloads',
        name: 'Downloads',
        notes: [{ handle: '/Downloads/opened.md', name: 'opened.md', modifiedMs: 20, createdMs: 10 }],
      } as T
    }

    const catalog = await new TauriWorkspaceCatalogPort(invoke).inspect('/Downloads/opened.md')

    expect(catalog.notes.map((note) => note.handle)).toEqual(['/Downloads/opened.md'])
    expect(calls).toEqual([
      { command: 'inspect_workspace_note', args: { handle: '/Downloads/opened.md' } },
    ])
  })

  it('lists the real sibling catalog without inventing UI state', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    const invoke: TauriInvoke = async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, ...(args === undefined ? {} : { args }) })
      return {
        handle: '/notes',
        name: 'notes',
        notes: [
          { handle: '/notes/a.md', name: 'a.md', modifiedMs: 20, createdMs: 10 },
          { handle: '/notes/b.markdown', name: 'b.markdown', modifiedMs: 10, createdMs: 5 },
        ],
      } as T
    }

    const catalog = await new TauriWorkspaceCatalogPort(invoke).listAround('/notes/a.md')

    expect(catalog.notes.map((note) => note.handle)).toEqual(['/notes/a.md', '/notes/b.markdown'])
    expect(calls).toEqual([{ command: 'list_workspace', args: { handle: '/notes/a.md' } }])
  })

  it('refreshes an already adopted folder by its own handle', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    const invoke: TauriInvoke = async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, ...(args === undefined ? {} : { args }) })
      return { handle: '/notes', name: 'notes', notes: [] } as T
    }

    await new TauriWorkspaceCatalogPort(invoke).listFolder('/notes')

    expect(calls).toEqual([{ command: 'list_workspace_folder', args: { handle: '/notes' } }])
  })

  it('adopts every Markdown note only after an explicit folder choice', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    const invoke: TauriInvoke = async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, ...(args === undefined ? {} : { args }) })
      return {
        handle: '/notes',
        name: 'notes',
        notes: [
          { handle: '/notes/a.md', name: 'a.md', modifiedMs: 20, createdMs: 10 },
          { handle: '/notes/b.md', name: 'b.md', modifiedMs: 10, createdMs: 5 },
        ],
      } as T
    }

    const catalog = await new TauriWorkspaceCatalogPort(invoke).chooseFolder()

    expect(catalog?.notes).toHaveLength(2)
    expect(calls).toEqual([{ command: 'open_workspace_folder' }])
  })

  it('treats cancelling the folder picker as an ordinary outcome', async () => {
    const invoke: TauriInvoke = async <T>() => null as T

    await expect(new TauriWorkspaceCatalogPort(invoke).chooseFolder()).resolves.toBeNull()
  })

  it('creates through the native collision-safe command and preserves exact bytes', async () => {
    const invoke: TauriInvoke = async <T>() => ({
      handle: '/notes/Untitled 2.md',
      name: 'Untitled 2.md',
      bytes: btoa('# New note\n\n'),
    }) as T

    const created = await new TauriWorkspaceCatalogPort(invoke).create('/notes')

    expect(created.handle).toBe('/notes/Untitled 2.md')
    expect(new TextDecoder().decode(created.bytes)).toBe('# New note\n\n')
  })
})
