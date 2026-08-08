import { describe, expect, it } from 'vitest'

import { OpenCancelled, TauriFilePort } from '../../src/adapters/filesystem/tauri-file-port.js'

/**
 * The native shell is not present in the test runtime, so the port is exercised
 * through the seam the Tauri build uses: an injected `invoke`. That is the same
 * reason `BrowserFilePort` takes its picker as an argument — a port that read a
 * global could not be tested without the platform it names.
 *
 * What matters here is the boundary, not the dialog: base64 must carry bytes a
 * string would destroy, and a cancelled dialog must be distinguishable from a
 * failure so the shell can leave the open document alone.
 */

/** Base64 of the exact bytes, computed the way the Rust side does. */
function encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function fakeInvoke(responses: Record<string, unknown>) {
  const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = []
  const invoke = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
    calls.push({ command, args })
    if (!(command in responses)) throw new Error(`unexpected command ${command}`)
    const reply = responses[command]
    if (reply instanceof Error) throw reply
    return reply as T
  }
  return { invoke, calls }
}

/** A lone CR, a four-byte emoji, an invalid byte, and no final newline. */
const AWKWARD = new Uint8Array([0x61, 0x0d, 0xf0, 0x9f, 0x92, 0xa9, 0xff])

describe('TauriFilePort', () => {
  it('returns the file bytes exactly, including what a string would destroy', async () => {
    const { invoke } = fakeInvoke({
      open_note: { handle: '/notes/awkward.md', name: 'awkward.md', bytes: encode(AWKWARD) },
    })
    const port = new TauriFilePort(invoke)

    const opened = await port.open()

    expect(opened.name).toBe('awkward.md')
    expect(opened.handle).toBe('/notes/awkward.md')
    expect([...opened.bytes]).toEqual([...AWKWARD])
  })

  it('reports a cancelled dialog as OpenCancelled rather than a failure', async () => {
    // A cancelled picker must leave the current document exactly as it was,
    // which the entrypoint can only do if it can tell cancel from error.
    const { invoke } = fakeInvoke({ open_note: null })
    await expect(new TauriFilePort(invoke).open()).rejects.toBeInstanceOf(OpenCancelled)
  })

  it('reopens the same note without prompting again', async () => {
    const note = { handle: '/notes/a.md', name: 'a.md', bytes: encode(AWKWARD) }
    const { invoke, calls } = fakeInvoke({ open_note: note, read_note_at: note })
    const port = new TauriFilePort(invoke)

    await port.open()
    await port.open()

    expect(calls.map((call) => call.command)).toEqual(['open_note', 'read_note_at'])
    expect(calls[1]?.args).toEqual({ path: '/notes/a.md' })
  })

  it('opens a Finder-provided path without showing the picker', async () => {
    const note = { handle: '/notes/from-finder.md', name: 'from-finder.md', bytes: encode(AWKWARD) }
    const { invoke, calls } = fakeInvoke({ read_note_at: note })
    const port = new TauriFilePort(invoke)

    const opened = await port.openAt('/notes/from-finder.md')

    expect(opened).toEqual({ handle: note.handle, name: note.name, bytes: AWKWARD })
    expect(calls).toEqual([
      { command: 'read_note_at', args: { path: '/notes/from-finder.md' } },
    ])
  })

  it('prompts again after the current note is released', async () => {
    const note = { handle: '/notes/a.md', name: 'a.md', bytes: encode(AWKWARD) }
    const { invoke, calls } = fakeInvoke({ open_note: note, read_note_at: note })
    const port = new TauriFilePort(invoke)

    await port.open()
    port.releaseCurrent()
    await port.open()

    expect(calls.map((call) => call.command)).toEqual(['open_note', 'open_note'])
  })

  it('sends bytes to the native writer unchanged', async () => {
    const { invoke, calls } = fakeInvoke({ save_note: undefined })
    await new TauriFilePort(invoke).save('/notes/a.md', AWKWARD)

    expect(calls[0]?.command).toBe('save_note')
    expect(calls[0]?.args).toEqual({ handle: '/notes/a.md', bytes: encode(AWKWARD) })
  })

  it('asks native Save As to persist a new draft and adopts its selected path', async () => {
    const saved = { handle: '/notes/Project plan.md', name: 'Project plan.md', bytes: encode(AWKWARD) }
    const { invoke, calls } = fakeInvoke({ save_new_note: saved })
    const port = new TauriFilePort(invoke)

    await expect(port.saveNew('Project plan.md', AWKWARD)).resolves.toEqual({
      handle: saved.handle,
      name: saved.name,
      bytes: AWKWARD,
    })
    expect(calls).toEqual([{
      command: 'save_new_note',
      args: { suggestedName: 'Project plan.md', bytes: encode(AWKWARD) },
    }])
  })

  it('keeps a new draft in memory when the Save As panel is cancelled', async () => {
    const { invoke } = fakeInvoke({ save_new_note: null })
    await expect(new TauriFilePort(invoke).saveNew('Untitled.md', AWKWARD)).resolves.toBeNull()
  })

  it('renames through native code and adopts the new opaque handle', async () => {
    const renamed = { handle: '/notes/Renamed.md', name: 'Renamed.md', bytes: encode(AWKWARD) }
    const { invoke, calls } = fakeInvoke({ rename_note: renamed })
    const port = new TauriFilePort(invoke)

    await expect(port.rename('/notes/original.md', 'Renamed')).resolves.toEqual({
      handle: renamed.handle,
      name: renamed.name,
      bytes: AWKWARD,
    })
    expect(calls).toEqual([{
      command: 'rename_note',
      args: { handle: '/notes/original.md', name: 'Renamed' },
    }])
  })

  it('round-trips a note larger than one encoding chunk', async () => {
    // The encoder walks the array in 0x8000 blocks; a note bigger than one
    // block is where a naive fromCharCode(...bytes) would throw.
    const large = new Uint8Array(0x8000 * 2 + 17).map((_, index) => index % 251)
    const { invoke, calls } = fakeInvoke({ save_note: undefined })
    await new TauriFilePort(invoke).save('/notes/big.md', large)

    const sent = (calls[0]?.args as { bytes: string }).bytes
    expect([...Buffer.from(sent, 'base64')]).toEqual([...large])
  })

  it('lets a failed write reject rather than reporting success', async () => {
    // "Not saved" must reach the person. A swallowed error here is the exact
    // failure the atomic-write contract exists to prevent.
    const { invoke } = fakeInvoke({ save_note: new Error('Not saved — /notes/a.md: disk full') })
    await expect(new TauriFilePort(invoke).save('/notes/a.md', AWKWARD)).rejects.toThrow(
      /Not saved/,
    )
  })

  it('detects the native shell by its runtime marker, not a user agent', () => {
    expect(TauriFilePort.isSupported({})).toBe(false)
    expect(TauriFilePort.isSupported({ __TAURI_INTERNALS__: {} })).toBe(true)
  })
})
