import type { FilePort, OpenedDocument } from '../../application/index.js'

/**
 * The portable browser fallback for Safari and other browsers without the File
 * System Access API. It opens a user-picked file and saves a replacement via a
 * download. It deliberately never claims to write back to the original path.
 */
export class BrowserUploadFilePort implements FilePort {
  readonly #files = new Map<string, File>()
  #nextId = 0
  #current: File | undefined

  constructor(
    private readonly pick: () => Promise<File>,
    private readonly download: (name: string, bytes: Uint8Array) => void,
  ) {}

  async open(): Promise<OpenedDocument> {
    const file = this.#current ?? (await this.pick())
    this.#current = file
    const id = `upload:${this.#nextId++}`
    this.#files.set(id, file)
    return { handle: id, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
  }

  async save(handle: string, bytes: Uint8Array): Promise<void> {
    const file = this.#files.get(handle)
    if (file === undefined) {
      throw new Error(
        `BrowserUploadFilePort was asked to save an unknown handle "${handle}". ` +
          'Only handles issued by this port can be downloaded.',
      )
    }
    this.download(file.name, bytes)
  }
}
