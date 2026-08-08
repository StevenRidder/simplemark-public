import type { FilePort, OpenedDocument } from '../../application/index.js'

/**
 * An in-memory FilePort backed by a committed fixture.
 *
 * This is the gate that keeps EDITOR-1 honest. The Phase 0–1 plan is explicit:
 * "Before the fidelity verdict, the visible harness opens committed fixtures
 * through an in-memory file port. Writing an arbitrary real file remains gated
 * by the fidelity decision." Until FIDELITY-1 returns a verdict, no code path in
 * the browser build can reach a real file, so a serializer bug cannot damage
 * anything a person cares about.
 *
 * Saves are real, just not durable: they land in memory and are readable back,
 * which is enough to exercise the full open → edit → save → reopen cycle.
 * APP-1 replaces this with the File System Access implementation.
 */
export class FixtureFilePort implements FilePort {
  #bytes: Uint8Array

  constructor(
    private readonly fixtureName: string,
    initialMarkdown: string,
  ) {
    this.#bytes = new TextEncoder().encode(initialMarkdown)
  }

  async open(): Promise<OpenedDocument> {
    return {
      handle: `fixture:${this.fixtureName}`,
      name: this.fixtureName,
      bytes: this.#bytes,
    }
  }

  async save(handle: string, bytes: Uint8Array): Promise<void> {
    // Fail loudly on a handle this port did not issue rather than writing
    // somewhere unexpected.
    if (handle !== `fixture:${this.fixtureName}`) {
      throw new Error(
        `FixtureFilePort was asked to save an unknown handle "${handle}". ` +
          `This port only owns "fixture:${this.fixtureName}".`,
      )
    }
    this.#bytes = bytes
  }

  /** Current bytes, for tests and for the reopen check. */
  peek(): string {
    return new TextDecoder().decode(this.#bytes)
  }
}
