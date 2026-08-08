import { describe, expect, it, vi } from 'vitest'

import { sampleWorkspaceOptions } from '../../src/app/sample-workspace.js'

describe('native sample workspace', () => {
  it('presents the two canonical samples with Welcome selected first', () => {
    const workspace = sampleWorkspaceOptions('welcome-to-simplemark', {
      onSelectNote: vi.fn(),
    })

    expect(workspace.collectionLabel).toBe('Samples')
    expect(workspace.activeNoteId).toBe('welcome-to-simplemark')
    expect(workspace.notes.map(({ id, title, pinned }) => ({ id, title, pinned }))).toEqual([
      {
        id: 'welcome-to-simplemark',
        title: 'Welcome to SimpleMark',
        pinned: true,
      },
      {
        id: 'project-tanoa-storm-atlas',
        title: 'Project Tanoa: Storm Atlas',
        pinned: false,
      },
    ])
  })

  it('routes a sample row selection through the shell callback', () => {
    const onSelectNote = vi.fn()
    const workspace = sampleWorkspaceOptions('welcome-to-simplemark', { onSelectNote })

    workspace.onSelectNote?.('project-tanoa-storm-atlas')

    expect(onSelectNote).toHaveBeenCalledOnce()
    expect(onSelectNote).toHaveBeenCalledWith('project-tanoa-storm-atlas')
  })
})
