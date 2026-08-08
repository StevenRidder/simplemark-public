import { describe, expect, it } from 'vitest'

import { DocumentSession } from '../../src/application/index.js'
import type { FilePort, OpenedDocument } from '../../src/application/index.js'
import { MdastBlockBoundaries } from '../../src/adapters/editor/mdast-block-boundaries.js'

/** Captures what a save actually wrote, which is the only thing under test. */
class CapturingPort implements FilePort {
  written: string | undefined

  constructor(private readonly markdown: string) {}

  async open(): Promise<OpenedDocument> {
    return {
      handle: '/notes/doc.md',
      name: 'doc.md',
      bytes: new TextEncoder().encode(this.markdown),
    }
  }

  async save(_handle: string, bytes: Uint8Array): Promise<void> {
    this.written = new TextDecoder().decode(bytes)
  }
}

async function editAndSave(source: string, edited: string): Promise<string> {
  const port = new CapturingPort(source)
  const session = await DocumentSession.open(port, new MdastBlockBoundaries())

  const applied = session.apply({
    actorId: 'test',
    name: 'edit',
    expectedRevision: 0,
    markdown: edited,
  })
  expect(applied.ok).toBe(true)

  const saved = await session.save()
  expect(saved.ok).toBe(true)

  return port.written ?? ''
}

describe('saving preserves untouched blocks', () => {
  // The defect, exactly as it happened. The editor does not hand back the
  // author's bytes — it hands back what remark-stringify produced, with `-`
  // turned into `*` and `---` into `***` across the whole document. Passing
  // already-correct Markdown here would test nothing, since the old code wrote
  // whatever it was given.
  it('restores markers the serializer renormalized in untouched blocks', async () => {
    const source =
      '# Title\n\n- **Status:** draft\n- **Date:** today\n\n---\n\n## Section\n\nOriginal body.\n'
    // What the editor returns after one paragraph is edited: every block
    // renormalized, including the two the author never touched.
    const serialized =
      '# Title\n\n* **Status:** draft\n* **Date:** today\n\n***\n\n## Section\n\nEdited body.\n'

    const written = await editAndSave(source, serialized)

    // Untouched blocks come from the baseline, so the author's markers survive.
    expect(written).toContain('- **Status:** draft')
    expect(written).not.toContain('* **Status:**')
    expect(written).toContain('\n---\n')
    expect(written).not.toContain('***')
    // The edited block is the one thing that does change.
    expect(written).toContain('Edited body.')
  })

  it('writes the baseline byte-for-byte apart from the edited block', async () => {
    const source = '# Title\n\nAlpha.\n\nBravo.\n\nCharlie.\n'
    const serialized = '# Title\n\nAlpha.\n\nBravo changed.\n\nCharlie.\n'

    expect(await editAndSave(source, serialized)).toBe(
      '# Title\n\nAlpha.\n\nBravo changed.\n\nCharlie.\n',
    )
  })

  // The honest boundary. A block added means index n is no longer the same
  // block on both sides, so the whole document is written — which is what
  // every save did before this existed.
  it('falls back to the whole document when a block is added', async () => {
    const source = '# Title\n\nAlpha.\n'
    const edited = '# Title\n\nAlpha.\n\nBravo.\n'

    expect(await editAndSave(source, edited)).toBe(edited)
  })

  // Composition must stay optional: the browser shell may not supply a parser,
  // and a session without one has to keep working.
  it('writes the whole document when no boundary port is composed', async () => {
    const port = new CapturingPort('# Title\n\nAlpha.\n')
    const session = await DocumentSession.open(port)

    session.apply({ actorId: 't', name: 'e', expectedRevision: 0, markdown: '# Title\n\nBeta.\n' })
    await session.save()

    expect(port.written).toBe('# Title\n\nBeta.\n')
  })
})
