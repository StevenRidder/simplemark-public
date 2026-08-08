import type { FilePort, OpenedDocument } from '../../application/index.js'

/**
 * The native implementation of FilePort (APP-2).
 *
 * Identical contract to `BrowserFilePort`: open one Markdown file, hand back
 * its exact bytes, and write those bytes atomically. The atomicity guarantee
 * itself lives in Rust (temp file in the same directory, fsync, rename) — this
 * class is the transport, and it holds no document rule.
 *
 * `invoke` is injected rather than imported from `@tauri-apps/api` so the port
 * never names a global or a framework: the native entrypoint passes the real
 * one, and a test passes a fake. It is the same reason `BrowserFilePort` takes
 * its picker as an argument.
 *
 * Bytes cross the boundary as base64. The IPC channel is JSON, and a decoded
 * string would already have destroyed the evidence D7 is defined in — a lone
 * CR, an invalid sequence, a missing final newline.
 */

/** What Rust's `open_note` and `read_note_at` return. */
interface NativeNote {
  readonly handle: string
  readonly name: string
  readonly bytes: string
}

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

/** A cancelled picker, so the caller can leave the current document alone. */
export class OpenCancelled extends Error {
  constructor() {
    super('Open cancelled')
    this.name = 'OpenCancelled'
  }
}

export class TauriFilePort implements FilePort {
  /** The note this port is bound to, so reopen never re-prompts. */
  #current: string | undefined

  constructor(private readonly invoke: TauriInvoke) {}

  /** Whether this build is running inside the native shell at all. */
  static isSupported(target: object = globalThis): boolean {
    return '__TAURI_INTERNALS__' in target
  }

  async open(): Promise<OpenedDocument> {
    // Reopening the same file must not re-prompt — the person already chose
    // it, and a picker on the reopen path would be an unexplained dialog.
    const note =
      this.#current === undefined
        ? await this.invoke<NativeNote | null>('open_note')
        : await this.invoke<NativeNote>('read_note_at', { path: this.#current })

    if (note === null) throw new OpenCancelled()

    return this.#adopt(note)
  }

  /** Opens a path macOS already chose through Finder or `open`. */
  async openAt(path: string): Promise<OpenedDocument> {
    const note = await this.invoke<NativeNote>('read_note_at', { path })
    return this.#adopt(note)
  }

  /** Forget the current note so the next open() prompts again. */
  releaseCurrent(): void {
    this.#current = undefined
  }

  async save(handle: string, bytes: Uint8Array): Promise<void> {
    // Errors arrive as rejected promises carrying Rust's message, which the
    // shell shows verbatim. A failed write must never look like a success.
    await this.invoke<void>('save_note', { handle, bytes: encodeBase64(bytes) })
  }

  /**
   * Lets the native Save panel choose the first durable location for an
   * in-memory new document. Cancelling is an ordinary result: the draft stays
   * in the shared document session and no file has been created.
   */
  async saveNew(suggestedName: string, bytes: Uint8Array): Promise<OpenedDocument | null> {
    const note = await this.invoke<NativeNote | null>('save_new_note', {
      suggestedName,
      bytes: encodeBase64(bytes),
    })
    return note === null ? null : this.#adopt(note)
  }

  /** Renames one open Markdown file without ever replacing an existing note. */
  async rename(handle: string, name: string): Promise<OpenedDocument> {
    const note = await this.invoke<NativeNote>('rename_note', { handle, name })
    return this.#adopt(note)
  }

  /** Asks the native side to report when somebody else writes this note. */
  async watch(handle: string): Promise<void> {
    await this.invoke<void>('watch_note', { handle })
  }

  #adopt(note: NativeNote): OpenedDocument {
    this.#current = note.handle
    return { handle: note.handle, name: note.name, bytes: decodeBase64(note.bytes) }
  }
}

/** Chunked so a large note cannot blow the argument limit of `fromCharCode`. */
function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }
  return btoa(binary)
}

function decodeBase64(encoded: string): Uint8Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
