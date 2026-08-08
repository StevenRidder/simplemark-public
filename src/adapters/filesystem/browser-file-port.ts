import type { FilePort, OpenedDocument } from '../../application/index.js'

/**
 * The File System Access implementation of FilePort (APP-1).
 *
 * The picker is injected rather than read from `window` so the port itself
 * never names a global: the browser entrypoint passes `showOpenFilePicker`,
 * tests pass a fake, and the unsupported-browser decision happens once at the
 * composition root via `isSupported()` — a browser without the API gets an
 * honestly disabled control, never a broken one (DESIGN.md: absent or visibly
 * disabled, never fake).
 *
 * Atomicity: `createWritable()` writes to a staging area and nothing touches
 * the real file until `close()` resolves — the same guarantee the port
 * contract words as temp-file-then-rename. A save that throws mid-write
 * leaves the original bytes untouched.
 */
export class BrowserFilePort implements FilePort {
  /** Handles issued by this port, keyed by the opaque string given out. */
  readonly #handles = new Map<string, FileSystemFileHandle>()
  #nextId = 0
  /** The most recently opened handle, so reopen() can skip the picker. */
  #current: FileSystemFileHandle | undefined

  constructor(private readonly pick: () => Promise<FileSystemFileHandle>) {}

  /** Whether this browser exposes the File System Access API at all. */
  static isSupported(target: object = globalThis): boolean {
    return typeof (target as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function'
  }

  async open(): Promise<OpenedDocument> {
    // Reopening the same file (close → open cycle) must not re-prompt: the
    // person already granted this handle, and the picker requires a user
    // gesture the reopen path does not have.
    const handle = this.#current ?? (await this.pick())
    this.#current = handle

    const file = await handle.getFile()
    const bytes = new Uint8Array(await file.arrayBuffer())

    const id = `fsa:${this.#nextId++}`
    this.#handles.set(id, handle)
    return { handle: id, name: handle.name, bytes }
  }

  /** Forget the current file so the next open() prompts again. */
  releaseCurrent(): void {
    this.#current = undefined
  }

  async save(handle: string, bytes: Uint8Array): Promise<void> {
    const fsHandle = this.#handles.get(handle)
    if (fsHandle === undefined) {
      throw new Error(
        `BrowserFilePort was asked to save an unknown handle "${handle}". ` +
          `Only handles issued by this port's open() are writable.`,
      )
    }
    const writable = await fsHandle.createWritable()
    try {
      // Copy into a plain ArrayBuffer-backed view: the port contract allows any
      // Uint8Array, but FileSystemWritableFileStream rejects SharedArrayBuffer.
      await writable.write(new Uint8Array(bytes) as Uint8Array<ArrayBuffer>)
    } catch (error) {
      // Abort discards the staging file; the on-disk note is untouched.
      await writable.abort?.()
      throw error
    }
    await writable.close()
  }
}
