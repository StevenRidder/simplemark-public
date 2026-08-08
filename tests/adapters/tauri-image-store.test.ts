import { describe, expect, it } from 'vitest'

import { TauriImageStore } from '../../src/adapters/filesystem/tauri-image-store.js'

/**
 * A thin transport. Its whole job is to send the right command with the right
 * arguments and to turn a refusal into `null` — a paste that could not store
 * its image keeps the remote URL rather than losing it (§4.4).
 */
describe('TauriImageStore', () => {
  it('downloads through the native command and returns the note-relative reference', async () => {
    const calls: Array<{ command: string; args: unknown }> = []
    const store = new TauriImageStore(async (command, args) => {
      calls.push({ command, args })
      return { src: 'assets/3f9a1c2b7d4e5f60.png' }
    })

    const stored = await store.store('/notes/a.md', 'https://example.com/a.png')

    expect(stored).toEqual({ src: 'assets/3f9a1c2b7d4e5f60.png' })
    expect(calls).toEqual([
      {
        command: 'download_note_image',
        args: { documentHandle: '/notes/a.md', url: 'https://example.com/a.png' },
      },
    ])
  })

  it('declines rather than throwing when the native side refuses', async () => {
    const store = new TauriImageStore(async () => {
      throw new Error('That image is on a private address, so it was not downloaded.')
    })
    await expect(store.store('/notes/a.md', 'http://127.0.0.1/a.png')).resolves.toBeNull()
  })

  it('refuses a reference the native side returned that is not note-relative', async () => {
    const store = new TauriImageStore(async () => ({ src: '/etc/passwd' }))
    await expect(store.store('/notes/a.md', 'https://example.com/a.png')).resolves.toBeNull()
  })

  it('reads an asset back as bytes and a media type', async () => {
    const calls: Array<{ command: string; args: unknown }> = []
    const store = new TauriImageStore(async (command, args) => {
      calls.push({ command, args })
      return { bytes: 'aGVsbG8=', mediaType: 'image/png' }
    })

    const loaded = await store.read('/notes/a.md', 'assets/a.png')

    expect(loaded?.mediaType).toBe('image/png')
    expect(new TextDecoder().decode(loaded?.bytes)).toBe('hello')
    expect(calls[0]).toEqual({
      command: 'read_note_asset',
      args: { documentHandle: '/notes/a.md', href: 'assets/a.png' },
    })
  })

  it('reports a missing asset as null, not an exception', async () => {
    const store = new TauriImageStore(async () => {
      throw new Error('Could not read assets/a.png: No such file or directory')
    })
    await expect(store.read('/notes/a.md', 'assets/a.png')).resolves.toBeNull()
  })
})
