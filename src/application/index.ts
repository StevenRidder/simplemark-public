/**
 * Public entry point for `application` — use cases and the ports adapters
 * implement. Imports `domain` only.
 *
 * `DocumentSession` (open, save, invoke agent, apply transaction, leave note,
 * redirect, stop, revert) lands here in the local-editor and live-agent
 * deliverables. Today the module publishes its port contracts.
 */
export type {
  FilePort,
  OpenedDocument,
  WorkspaceCatalogEntry,
  WorkspaceCatalog,
  WorkspaceCatalogPort,
  AssetKind,
  AssetReference,
  AssetReferencePort,
  DocumentLinkPort,
  ChartDataReader,
  StoredImage,
  LoadedImage,
  ImageStorePort,
  NoteImageStore,
  DiagramRenderer,
  RenderedDiagram,
  ClipboardPayload,
  ClipboardPort,
  NoteSummary,
  NoteSummaryPort,
  DiagramFixResult,
  DiagramFixPort,
  AiSettings,
  BlockBoundaryPort,
} from './ports.js'
export { isAiConfigured } from './ports.js'
export { DocumentSession } from './document-session.js'
export { dirtyBlocks } from './dirty-blocks.js'
export type {
  DocumentSnapshot,
  DocumentTransaction,
  ApplyResult,
  SaveResult,
} from './document-session.js'
export { COMMANDS, MENUS, menuCommandIds } from './commands.js'
export type {
  DocumentCommandId,
  CommandDefinition,
  CommandTarget,
  CommandSubmenu,
  MenuEntry,
  MenuSpec,
} from './commands.js'
