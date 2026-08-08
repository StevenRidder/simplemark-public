import type {
  OpenedDocument,
  WorkspaceCatalog,
  WorkspaceCatalogPort,
} from '../../application/index.js'
import type { TauriInvoke } from './tauri-file-port.js'

interface NativeWorkspaceCatalog {
  readonly handle: string
  readonly name: string
  readonly notes: WorkspaceCatalog['notes']
}

interface NativeNote {
  readonly handle: string
  readonly name: string
  readonly bytes: string
}

/** Thin native transport for the folder catalog; it contains no UI state. */
export class TauriWorkspaceCatalogPort implements WorkspaceCatalogPort {
  constructor(private readonly invoke: TauriInvoke) {}

  async inspect(documentHandle: string): Promise<WorkspaceCatalog> {
    return this.invoke<NativeWorkspaceCatalog>('inspect_workspace_note', {
      handle: documentHandle,
    })
  }

  async chooseFolder(): Promise<WorkspaceCatalog | null> {
    return this.invoke<NativeWorkspaceCatalog | null>('open_workspace_folder')
  }

  async listAround(documentHandle: string): Promise<WorkspaceCatalog> {
    return this.invoke<NativeWorkspaceCatalog>('list_workspace', { handle: documentHandle })
  }

  async listFolder(workspaceHandle: string): Promise<WorkspaceCatalog> {
    return this.invoke<NativeWorkspaceCatalog>('list_workspace_folder', {
      handle: workspaceHandle,
    })
  }

  async create(workspaceHandle: string): Promise<OpenedDocument> {
    const note = await this.invoke<NativeNote>('create_note', { workspaceHandle })
    return {
      handle: note.handle,
      name: note.name,
      bytes: decodeBase64(note.bytes),
    }
  }
}

function decodeBase64(encoded: string): Uint8Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
