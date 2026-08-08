const KEY = 'simplemark.workspace-pins.v1'

/** Shell preference storage. Pinning never mutates a Markdown file. */
export class WorkspacePins {
  #pins: Set<string>

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'>) {
    this.#pins = readPins(storage)
  }

  has(handle: string): boolean {
    return this.#pins.has(handle)
  }

  toggle(handle: string): boolean {
    if (this.#pins.has(handle)) this.#pins.delete(handle)
    else this.#pins.add(handle)
    this.storage.setItem(KEY, JSON.stringify([...this.#pins].sort()))
    return this.#pins.has(handle)
  }
}

function readPins(storage: Pick<Storage, 'getItem'>): Set<string> {
  try {
    const value: unknown = JSON.parse(storage.getItem(KEY) ?? '[]')
    if (!Array.isArray(value)) return new Set()
    return new Set(value.filter((item): item is string => typeof item === 'string'))
  } catch {
    return new Set()
  }
}
