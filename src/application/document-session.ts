import { buildSourceMap, emitDocument } from '../domain/index.js'

import { dirtyBlocks } from './dirty-blocks.js'
import type { BlockBoundaryPort, FilePort } from './ports.js'

/**
 * The coordination authority for one open document (ADR-0002).
 *
 * Every change — from the editor today, from the MCP adapter later — reaches the
 * document through `apply`. Nothing else may mutate it, which is what makes
 * `expectedRevision` meaningful: it is the check that will later refuse an
 * agent's late write instead of letting it silently overwrite a human edit.
 *
 * This is the EDITOR-1 subset. Transactions carry whole-document Markdown rather
 * than structural steps, and there is no source baseline or dirty-block
 * serialization yet — those are FIDELITY-1's, and coarse whole-document
 * serialization is explicitly *not* a D7 fidelity claim. Run generations and
 * scoped agent transactions arrive with the live-agent deliverable. The shape of
 * the API is what matters now: one authority, one revision counter, one save.
 *
 * Pure: imports `domain` and its own ports only. No DOM, no ProseMirror, no
 * filesystem — the boundary check enforces it.
 */

export interface DocumentSnapshot {
  /** Monotonic, incremented by every accepted transaction. */
  readonly revision: number
  readonly markdown: string
  /** True when the document has accepted changes that are not yet saved. */
  readonly dirty: boolean
}

export interface DocumentTransaction {
  readonly actorId: string
  /** Human-readable label, surfaced in activity. */
  readonly name: string
  /** The revision the author believed it was editing. */
  readonly expectedRevision: number
  readonly markdown: string
}

export type ApplyResult =
  | { readonly ok: true; readonly revision: number }
  | {
      readonly ok: false
      readonly reason: 'stale-revision'
      readonly expected: number
      readonly actual: number
    }

export type SaveResult =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly reason: string }

export class DocumentSession {
  #revision = 0
  #dirty = false
  /**
   * The document's bytes as last read from or written to disk.
   *
   * Untouched blocks are re-emitted from this, never re-serialized, which is
   * what stops an edit to one paragraph renormalizing the whole file. Replaced
   * only by a successful save — never by `apply`, or an edit would become its
   * own baseline and preserve nothing.
   */
  #baseline: string

  private constructor(
    private readonly port: FilePort,
    private readonly handle: string,
    readonly name: string,
    private markdown: string,
    private readonly boundaries?: BlockBoundaryPort,
  ) {
    this.#baseline = markdown
  }

  static async open(port: FilePort, boundaries?: BlockBoundaryPort): Promise<DocumentSession> {
    const opened = await port.open()
    return new DocumentSession(
      port,
      opened.handle,
      opened.name,
      new TextDecoder().decode(opened.bytes),
      boundaries,
    )
  }

  snapshot(): DocumentSnapshot {
    return { revision: this.#revision, markdown: this.markdown, dirty: this.#dirty }
  }

  /** Opaque platform identity used only when another port resolves a link. */
  documentHandle(): string {
    return this.handle
  }

  apply(transaction: DocumentTransaction): ApplyResult {
    if (transaction.expectedRevision !== this.#revision) {
      return {
        ok: false,
        reason: 'stale-revision',
        expected: transaction.expectedRevision,
        actual: this.#revision,
      }
    }

    this.markdown = transaction.markdown
    this.#revision += 1
    this.#dirty = true
    return { ok: true, revision: this.#revision }
  }

  async save(force = false): Promise<SaveResult> {
    // Selecting another note asks the current session to save before it is
    // swapped out. A clean document has nothing to persist, and writing it
    // anyway changes the file's modification date just for having been read.
    if (!force && !this.#dirty) return { ok: true, revision: this.#revision }

    const bytes = this.#preservingSerialization()

    try {
      await this.port.save(this.handle, new TextEncoder().encode(bytes))
    } catch (error) {
      // Surface the real cause. A save that failed must never leave the document
      // looking clean, or the user trusts a file that was never written.
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }

    this.#dirty = false
    this.#baseline = bytes
    return { ok: true, revision: this.#revision }
  }

  /**
   * What to write: the baseline with only the changed blocks re-serialized.
   *
   * Falls back to the whole document — which renormalizes, exactly as every
   * save did before this existed — whenever the dirty set cannot be determined
   * honestly: no boundary port composed, a block added, removed or split, or a
   * changed preamble. A wrong preservation would corrupt the file; an honest
   * re-serialization only reformats it.
   */
  #preservingSerialization(): string {
    if (this.boundaries === undefined) return this.markdown

    const baselineMap = buildSourceMap(this.#baseline, this.boundaries.starts(this.#baseline))
    const nextMap = buildSourceMap(this.markdown, this.boundaries.starts(this.markdown))

    const boundaries = this.boundaries
    const dirty = dirtyBlocks(baselineMap, nextMap, (a, b) => boundaries.equivalent(a, b))
    if (dirty === null) return this.markdown

    return emitDocument(baselineMap, dirty)
  }
}
