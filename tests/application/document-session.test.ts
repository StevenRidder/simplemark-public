import { describe, expect, test } from 'vitest'

import { DocumentSession } from '../../src/application/index.js'
import type { FilePort, OpenedDocument } from '../../src/application/index.js'

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

/** A file port that records what it was asked to save, and can be told to fail. */
function stubPort(initial: string, options: { failSave?: string } = {}) {
  const saved: string[] = []
  const port: FilePort = {
    async open(): Promise<OpenedDocument> {
      return { handle: 'fixture:test', name: 'test.md', bytes: encode(initial) }
    },
    async save(_handle: string, bytes: Uint8Array): Promise<void> {
      if (options.failSave !== undefined) {
        throw new Error(options.failSave)
      }
      saved.push(decode(bytes))
    },
  }
  return { port, saved }
}

describe('DocumentSession', () => {
  test('opens a document and exposes its markdown, clean, at the first revision', async () => {
    const { port } = stubPort('# Title\n\nbody\n')

    const session = await DocumentSession.open(port)

    expect(session.snapshot()).toEqual({ revision: 0, markdown: '# Title\n\nbody\n', dirty: false })
  })

  test('saving an untouched document is a no-op', async () => {
    const { port, saved } = stubPort('# Title\n')
    const session = await DocumentSession.open(port)

    await expect(session.save()).resolves.toEqual({ ok: true, revision: 0 })
    expect(saved).toEqual([])
    expect(session.snapshot().dirty).toBe(false)
  })

  test('a forced save can export an untouched document without making it dirty', async () => {
    const { port, saved } = stubPort('# Title\n')
    const session = await DocumentSession.open(port)

    await expect(session.save(true)).resolves.toEqual({ ok: true, revision: 0 })
    expect(saved).toEqual(['# Title\n'])
    expect(session.snapshot().dirty).toBe(false)
  })

  test('applying a transaction at the current revision advances it and marks the document dirty', async () => {
    const { port } = stubPort('# Title\n')
    const session = await DocumentSession.open(port)

    const result = session.apply({
      actorId: 'human',
      name: 'Type',
      expectedRevision: 0,
      markdown: '# Title\n\nnew paragraph\n',
    })

    expect(result).toEqual({ ok: true, revision: 1 })
    expect(session.snapshot()).toEqual({
      revision: 1,
      markdown: '# Title\n\nnew paragraph\n',
      dirty: true,
    })
  })

  // The expectedRevision check is the whole point of routing edits through the
  // session: it is what will later let an agent's late write be refused rather
  // than silently overwriting a human edit.
  test('a transaction built against a stale revision is refused and changes nothing', async () => {
    const { port } = stubPort('# Title\n')
    const session = await DocumentSession.open(port)
    session.apply({ actorId: 'human', name: 'Type', expectedRevision: 0, markdown: 'first\n' })

    const stale = session.apply({
      actorId: 'agent',
      name: 'Late write',
      expectedRevision: 0,
      markdown: 'clobbered\n',
    })

    expect(stale).toEqual({ ok: false, reason: 'stale-revision', expected: 0, actual: 1 })
    expect(session.snapshot().markdown).toBe('first\n')
  })

  test('saving writes the current markdown through the port and leaves the document clean', async () => {
    const { port, saved } = stubPort('# Title\n')
    const session = await DocumentSession.open(port)
    session.apply({ actorId: 'human', name: 'Type', expectedRevision: 0, markdown: 'edited\n' })

    const result = await session.save()

    expect(result).toEqual({ ok: true, revision: 1 })
    expect(saved).toEqual(['edited\n'])
    expect(session.snapshot().dirty).toBe(false)
  })

  // A failed write must never look like a successful one, or the user trusts a
  // file that was never written.
  test('a failed save reports the error and keeps the document dirty', async () => {
    const { port, saved } = stubPort('# Title\n', { failSave: 'disk full' })
    const session = await DocumentSession.open(port)
    session.apply({ actorId: 'human', name: 'Type', expectedRevision: 0, markdown: 'edited\n' })

    const result = await session.save()

    expect(result).toEqual({ ok: false, reason: 'disk full' })
    expect(saved).toEqual([])
    expect(session.snapshot().dirty).toBe(true)
  })
})
