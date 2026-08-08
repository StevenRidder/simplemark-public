import type {
  AssetReferencePort,
  ClipboardPort,
  DiagramFixPort,
  DiagramRenderer,
  DocumentLinkPort,
  FilePort,
  ImageStorePort,
} from '../application/index.js'
import {
  codeFenceContent,
  markdownTableToCsv,
  markdownTableToHtml,
  markdownToPlainText,
} from '../domain/index.js'
import { DocumentSession } from '../application/index.js'
import { MilkdownEditor } from '../adapters/editor/milkdown-editor.js'
import type { DiagramController } from '../adapters/editor/milkdown-editor.js'
import { createWindowChrome } from './ui/window-chrome.js'
import { createFindBar } from './ui/find-bar.js'
import type { EditorCommand } from './ui/window-chrome.js'
import { COMMANDS } from '../application/index.js'
import type { BlockBoundaryPort, DocumentCommandId } from '../application/index.js'
import type { WindowChrome } from './ui/window-chrome.js'
import type { SaveState } from './ui/window-chrome.js'
import type { WorkspaceOptions } from './ui/window-chrome.js'
import type { WorkspaceMode } from './ui/window-chrome.js'
import type { StylesBarPosition } from './ui/window-chrome.js'
import {
  DEFAULT_PREFERENCES,
  nextScale,
  normalisePreferences,
  preferenceVariables,
} from './reader-preferences.js'
import type { ReaderPreferences } from './reader-preferences.js'
import { loadUiPreferences, saveUiPreferences } from './ui-preferences.js'
import type { UiPreferences } from './ui-preferences.js'
import type { AppIconChoice, AppIconId } from './app-icons.js'
import type { UpdateStatus } from './update-status.js'
import { documentStatistics } from './document-statistics.js'

/**
 * The composition root shared by every shell (ADR-0001).
 *
 * This is the only place that knows both a concrete adapter and the application.
 * `browser.ts` and, later, `tauri.ts` supply platform ports and call
 * `composeApp`; neither contains a document or editor rule, so a feature cannot
 * work in one shell and not the other.
 *
 * The wiring below is the architectural claim of EDITOR-1: an editor keystroke
 * becomes a serialised document, which becomes a named DocumentTransaction
 * carrying the revision it was built against, which the session accepts or
 * refuses. The editor never reaches a file, and the UI never reaches the
 * document.
 */

export interface AppPorts {
  readonly file: FilePort
  readonly assets?: AssetReferencePort
  readonly links?: DocumentLinkPort
  readonly clipboard?: ClipboardPort
  readonly diagrams: DiagramRenderer
  readonly diagramFix?: DiagramFixPort
  /**
   * Supplies the top-level block offsets that let a save preserve untouched
   * blocks. Absent means every save re-serializes the whole document, which is
   * what happened before FIDELITY-1 and remains the honest fallback.
   */
  readonly blockBoundaries?: BlockBoundaryPort
  /** Absent in hosts that cannot keep images beside the note. */
  readonly images?: ImageStorePort
}

export interface AppComposition {
  readonly element: HTMLElement
  readonly session: DocumentSession
  readonly editor: MilkdownEditor
  /**
   * §4 of the chip-chrome spec: the diagram verb surface, delegating to the
   * editor. Every verb answers `false` (or `null` for `kind()`) before the
   * editor mounts, the same honest-before-ready shape `run`/`commandState`
   * already keep.
   */
  readonly diagram: DiagramController
  /** Tears down the editor and presentation observers before remounting. */
  destroy(): Promise<void>
  /** Flushes any pending debounced save. `false` leaves the current document in place. */
  save(): Promise<boolean>
  /**
   * Brings the session up to date with the document on screen.
   *
   * The editor hands changes over on a debounce, so for a moment after the last
   * keystroke `session.snapshot()` still describes the previous document.
   * `save` already closes that gap for itself; this exists for the shell code
   * that *reads* the session to make a decision — is this draft untouched, what
   * do I put on the clipboard — because deciding on a stale snapshot throws away
   * whatever was typed last.
   */
  flushPendingChanges(): void
  /** Shows a truthful platform or file-reference limitation in the shell. */
  setStatus(state: SaveState, message: string): void
  /**
   * Runs any command in the shared registry.
   *
   * The macOS menubar is built from that registry and dispatches here, which is
   * what makes the menubar a complete command surface without owning a second
   * copy of the editing rules (application/commands.ts).
   */
  run(command: DocumentCommandId): void
  /** Runs a native context-menu export against the pre-AppKit selection. */
  runNativeContextCommand(command: DocumentCommandId): void
  /** Replaces one note row's subtitle in place, without reordering the list. */
  applyNoteSummary(handle: string, summary: string): void
  /** Whether the optional styles bar is showing, for the View menu checkmark. */
  stylesBarVisible(): boolean
  /**
   * Reports an update check to the library footer.
   *
   * The check itself belongs to the platform entrypoint — only it knows whether
   * there is a bundle to update — so the composition root just forwards.
   */
  setUpdateStatus(status: UpdateStatus): void
  /** Current availability and checkmark state for any shared command surface. */
  commandState(command: DocumentCommandId): { readonly enabled: boolean; readonly checked: boolean }
  /** Reconciles shell catalog state while preserving the mounted editor and its selection. */
  reconcileWorkspace(workspace: WorkspaceOptions): void
}

export interface ComposeOptions {
  readonly ports: AppPorts
  readonly filePath: string
  /** Where reader preferences are read from and written to. Defaults to localStorage. */
  readonly preferenceStorage?: Pick<Storage, 'getItem' | 'setItem'>
  /** Native whole-webview magnification; separate from document text size. */
  readonly pageZoom?: {
    readonly current: () => number
    readonly set: (zoom: number) => void
    readonly preview: (zoom: number) => void
    readonly remember: (zoom: number) => void
  }
  /** Debounce for save-on-pause. Zero disables the timer so tests drive save directly. */
  readonly autosaveMs?: number
  /** Honest confirmation for platforms that save a downloaded replacement. */
  readonly saveSuccessMessage?: string
  /**
   * Persists an otherwise in-memory new document after an explicit Save. A
   * cancelled destination picker returns false, so callers never throw the
   * draft away while switching notes or closing the window.
   */
  readonly onSaveDraft?: (markdown: string) => Promise<boolean>
  /**
   * Renames the current durable document. The platform owns the filesystem
   * operation; the shared composition only flushes the current transaction
   * before asking it to do so.
   */
  readonly onRenameDocument?: (name: string) => Promise<boolean>
  /**
   * Whether the optional styles bar starts visible when nothing is stored yet.
   * The native shell passes `false`: its menubar already carries every command,
   * so the bar would open as pure duplication.
   */
  readonly stylesBarDefault?: boolean
  /** Platform hook for opening a real file; absent when the platform cannot. */
  readonly onOpenFile?: () => void
  /**
   * Copies a large virtualised table through the host clipboard. The native
   * shell supplies NSPasteboard rather than making WKWebView marshal a large
   * payload on its UI thread.
   */
  readonly copyDeferredTable?: (markdown: string) => Promise<boolean>
  /** Shown on the disabled open control when onOpenFile is absent. */
  readonly openFileUnavailableReason?: string
  /**
   * Platform hook for handing the rendered document to the operating system's
   * print service. Both shells have one — the browser's own `window.print()`
   * and, on macOS, the native print panel — so this is wiring, not a
   * capability the shells differ on. What both then print is decided entirely
   * by `styles/print.css`, never here.
   */
  readonly onPrint?: () => void
  /** Acts on an offered update. Absent where there is no bundle to replace. */
  readonly onUpdate?: () => void
  /** Shared navigation supplied by the platform composition root. */
  readonly workspace?: WorkspaceOptions
  /** Which platform owns the application chrome around the shared workspace. */
  readonly chromeMode?: 'web' | 'macos'
  /** Native application icon capability; omitted by browser composition. */
  readonly appIcon?: AppIconId
  readonly appIconChoices?: readonly AppIconChoice[]
  readonly onAppIconChange?: (icon: AppIconId) => Promise<void>
  /** Supplies caret context before macOS opens WebKit's native right-click menu. */
  readonly onNativeContextMenu?: (
    shape: { readonly inTable: boolean; readonly inCode: boolean },
  ) => void
  /**
   * Passed straight through to `MilkdownEditor.mount` — see its own doc for
   * what "selection change" covers. The native shell is the one caller today:
   * the Format → Diagram submenu needs to repaint on this, not only on its
   * own commands running (final review Finding 1).
   */
  readonly onSelectionChange?: () => void
}

const STYLES_BAR_KEY = 'simplemark.styles-bar-visible'
const STYLES_BAR_POSITION_KEY = 'simplemark.styles-bar-position'
const WORKSPACE_MODE_KEY = 'simplemark.workspace-mode'

/**
 * §4 of the chip-chrome spec: the Format → Diagram submenu ids, and the two
 * refinements past "a diagram block is selected" that `commandState` applies
 * — float needs `svg` or a `generated` diagram (refused on `math` and the
 * paste-exhaust `text` kind alike), zoom needs a `generated` diagram.
 */
const DIAGRAM_COMMAND_IDS: ReadonlySet<DocumentCommandId> = new Set([
  'diagramEditSource',
  'diagramFloatLeft',
  'diagramFloatRight',
  'diagramFloatInline',
  'diagramDelete',
  'diagramZoomIn',
  'diagramZoomOut',
  'diagramZoomReset',
])
const DIAGRAM_FLOAT_COMMAND_IDS: ReadonlySet<DocumentCommandId> = new Set([
  'diagramFloatLeft',
  'diagramFloatRight',
  'diagramFloatInline',
])
const DIAGRAM_ZOOM_COMMAND_IDS: ReadonlySet<DocumentCommandId> = new Set([
  'diagramZoomIn',
  'diagramZoomOut',
  'diagramZoomReset',
])

export async function composeApp(options: ComposeOptions): Promise<AppComposition> {
  const { ports } = options
  const session = await DocumentSession.open(ports.file, ports.blockBoundaries)

  // Reader preferences are app state, never document content (D6). They are
  // applied to the document root so one multiplier and one palette drive the
  // whole page rather than any selection.
  const storage = options.preferenceStorage ?? readPreferenceStorage()
  const stylesBarKey = `${STYLES_BAR_KEY}.${options.chromeMode ?? 'web'}`
  const stylesBarPositionKey = `${STYLES_BAR_POSITION_KEY}.${options.chromeMode ?? 'web'}`
  let preferences = loadPreferences(storage)
  let uiPreferences: UiPreferences = loadUiPreferences(storage)
  let workspaceMode = singlePaneWorkspaceMode(options.workspace) ?? loadWorkspaceMode(storage)
  let stylesBarVisible = loadStylesBarVisible(storage, stylesBarKey, options.stylesBarDefault ?? true)
  let stylesBarPosition = loadStylesBarPosition(storage, stylesBarPositionKey)
  applyPreferences(preferences)

  let editor: MilkdownEditor | undefined
  let nativeContextSelection: ReturnType<MilkdownEditor['contextSelection']> | undefined
  let chrome: WindowChrome
  /**
   * Routes a registry id to whoever executes it (application/commands.ts).
   *
   * This is the single dispatch both shells share: the web toolbar, the styles
   * bar, and the macOS menubar all arrive here, so a command can never mean two
   * different things in two shells. Adding a surface is wiring; adding a
   * command is a registry entry plus one case.
  */
  function runCommand(id: DocumentCommandId): void {
    if (!commandState(id).enabled) return
    if (COMMANDS[id].target === 'editor') {
      // Async and interactive, so it cannot be a plain forwarded command.
      if (id === 'convertToDiagram') {
        // A refusal carries the reason the block did not convert — an empty
        // block, unrecognised source, or a renderer that failed. Dropping it
        // left the command looking broken rather than declined (§4.4 rule 3).
        void editor?.convertBlockToDiagram().then(
          (result) => {
            if (!result.ok) chrome.setStatus('error', `Not converted — ${result.reason}`)
          },
          // The method guards its render gate, but building or dispatching the
          // transaction can still throw — and in an async method that arrives
          // here as a rejection. Saying so is the whole point of the command.
          (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error)
            chrome.setStatus('error', `Not converted — ${message}`)
          },
        )
        return
      }
      // §4 of the chip-chrome spec: these route to the diagram controller —
      // the one behavior surface the chips and the app API also call —
      // rather than the editor's own EditorCommandName switch.
      switch (id) {
        case 'diagramEditSource':
          editor?.diagram.editSource()
          return
        case 'diagramFloatLeft':
          editor?.diagram.setFloat('left')
          return
        case 'diagramFloatRight':
          editor?.diagram.setFloat('right')
          return
        case 'diagramFloatInline':
          editor?.diagram.setFloat(null)
          return
        case 'diagramDelete':
          editor?.diagram.delete()
          return
        case 'diagramZoomIn':
          editor?.diagram.zoomIn()
          return
        case 'diagramZoomOut':
          editor?.diagram.zoomOut()
          return
        case 'diagramZoomReset':
          editor?.diagram.zoomReset()
          return
      }
      editor?.runCommand(id as Parameters<MilkdownEditor['runCommand']>[0])
      return
    }

    switch (id) {
      case 'openFile':
        options.onOpenFile?.()
        return
      case 'openFolder':
        return
      case 'newNote':
        options.workspace?.onCreateNote?.()
        return
      case 'save':
        void save(true)
        return
      case 'saveAs':
        void options.workspace?.onSaveNoteAs?.(options.workspace?.activeNoteId ?? '')
        return
      case 'print':
        options.onPrint?.()
        return
      case 'moveToTrash':
        void options.workspace?.onTrashNote?.(options.workspace?.activeNoteId ?? '')
        return
      case 'insertAsset':
        void insertAsset()
        return
      case 'copyAsMarkdown':
      case 'copyAsPlainText':
      case 'copyAsRichText':
      case 'copyAsHtml':
      case 'copyCode':
      case 'copyTableAsMarkdown':
      case 'copyTableAsHtml':
      case 'copyTableAsCsv':
        void copySelection(id)
        return
      case 'pasteAsPlainText':
        void pasteAsPlainText()
        return
      case 'find':
        findBar.open()
        return
      case 'toggleStatistics':
        chrome.toggleInfoTab('statistics')
        return
      case 'contents':
        chrome.toggleInfoTab('contents')
        return
      case 'toggleWordCount':
        chrome.toggleWordCount()
        return
      case 'toggleStylesBar':
        chrome.toggleStylesBar()
        return
      case 'toggleHistoryNavigation':
        chrome.toggleHistoryNavigation()
        return
      case 'showAllPanes':
        chrome.setWorkspaceMode('all')
        return
      case 'showNotesAndEditor':
        chrome.setWorkspaceMode('notes')
        return
      case 'showEditorOnly':
        chrome.setWorkspaceMode('editor')
        return
      case 'togglePinned':
        chrome.togglePinned(options.workspace?.activeNoteId ?? '')
        return
      case 'historyBack':
        options.workspace?.onHistoryBack?.()
        return
      case 'historyForward':
        options.workspace?.onHistoryForward?.()
        return
      case 'previousNote':
        chrome.stepNote(-1)
        return
      case 'nextNote':
        chrome.stepNote(1)
        return
      case 'previewSmall':
        chrome.setPreviewDensity('small')
        return
      case 'previewMedium':
        chrome.setPreviewDensity('medium')
        return
      case 'previewLarge':
        chrome.setPreviewDensity('large')
        return
      case 'hideAttachments':
        return
      case 'sortByModified':
        chrome.setNotesSort('modified')
        return
      case 'sortByCreated':
        chrome.setNotesSort('created')
        return
      case 'sortByTitle':
        chrome.setNotesSort('title')
        return
      case 'toggleNewestOnTop':
        chrome.toggleNewestOnTop()
        return
      case 'sortFoldersByTitle':
        chrome.setFoldersSort('title')
        return
      case 'sortFoldersByCount':
        chrome.setFoldersSort('count')
        return
      case 'toggleFoldersAtoZ':
        chrome.toggleFoldersAtoZ()
        return
      case 'zoomIn':
        setPreferences({ ...preferences, scale: nextScale(preferences.scale, 'up') })
        return
      case 'zoomOut':
        setPreferences({ ...preferences, scale: nextScale(preferences.scale, 'down') })
        return
      case 'actualSize':
        setPreferences({ ...preferences, scale: 1 })
        options.pageZoom?.set(1)
        return
      case 'toggleFirstLineIndent':
        setPreferences({
          ...preferences,
          indent: preferences.indent === 'first-line' ? 'none' : 'first-line',
        })
        return
    }

    const readerChange = READER_COMMANDS[id]
    if (readerChange !== undefined) setPreferences({ ...preferences, ...readerChange })
  }

  /**
   * The View menu's typography commands, as the preference each one sets.
   *
   * A table rather than twenty switch cases: every entry is the same shape, so
   * a lookup states the rule once and cannot drift into twenty near-copies.
   */
  const READER_COMMANDS: Partial<Record<DocumentCommandId, Partial<ReaderPreferences>>> = {
    themeWhite: { theme: 'white' },
    themeTan: { theme: 'tan' },
    themeNight: { theme: 'night' },
    fontIowan: { family: 'serif' },
    fontGeorgia: { family: 'literata' },
    fontSystem: { family: 'sans' },
    fontMono: { family: 'mono' },
    widthNarrow: { width: 'narrow' },
    widthNormal: { width: 'normal' },
    widthWide: { width: 'wide' },
    leadingTight: { leading: 'tight' },
    leadingNormal: { leading: 'normal' },
    leadingOpen: { leading: 'open' },
    spacingCompact: { spacing: 'compact' },
    spacingNormal: { spacing: 'normal' },
    spacingAiry: { spacing: 'airy' },
  }

  /** Applies, persists, and repaints — the one path preference changes take. */
  function setPreferences(next: ReaderPreferences): void {
    preferences = next
    applyPreferences(next)
    savePreferences(storage, next)
    chrome.setPreferences(next)
  }

  function commandState(id: DocumentCommandId): { enabled: boolean; checked: boolean } {
    const modeFor = (command: DocumentCommandId): WorkspaceMode | undefined => {
      if (command === 'showAllPanes') return 'all'
      if (command === 'showNotesAndEditor') return 'notes'
      if (command === 'showEditorOnly') return 'editor'
      return undefined
    }
    const requestedMode = modeFor(id)
    if (requestedMode !== undefined) {
      return {
        enabled: options.workspace !== undefined,
        checked: options.workspace !== undefined && chrome.workspaceMode() === requestedMode,
      }
    }
    if (id === 'openFolder') return { enabled: false, checked: false }
    if (id === 'openFile') return { enabled: options.onOpenFile !== undefined, checked: false }
    if (id === 'print') return { enabled: options.onPrint !== undefined, checked: false }
    if (id === 'insertAsset') return { enabled: ports.assets !== undefined, checked: false }
    if (id === 'newNote') return { enabled: options.workspace?.onCreateNote !== undefined, checked: false }
    if (id === 'togglePinned') {
      const active = options.workspace?.notes.find((note) => note.id === options.workspace?.activeNoteId)
      return {
        enabled: options.workspace?.onTogglePinned !== undefined && active !== undefined,
        checked: active === undefined ? false : chrome.isPinned(active.id),
      }
    }
    if (id === 'saveAs') {
      const active = options.workspace?.notes.find((note) => note.id === options.workspace?.activeNoteId)
      return { enabled: options.workspace?.onSaveNoteAs !== undefined && active !== undefined, checked: false }
    }
    if (id === 'moveToTrash') {
      const active = options.workspace?.notes.find((note) => note.id === options.workspace?.activeNoteId)
      return { enabled: options.workspace?.onTrashNote !== undefined && active !== undefined, checked: false }
    }
    // A greyed-out Back is the honest answer when there is nowhere behind you,
    // and the menubar is where most people will discover these exist at all.
    if (id === 'historyBack') {
      return { enabled: options.workspace?.canHistoryBack?.() === true, checked: false }
    }
    if (id === 'historyForward') {
      return { enabled: options.workspace?.canHistoryForward?.() === true, checked: false }
    }
    if (id === 'previousNote' || id === 'nextNote') {
      // Two notes is the smallest list with a previous and a next in it.
      const notes = options.workspace?.notes.length ?? 0
      return { enabled: options.workspace?.onSelectNote !== undefined && notes > 1, checked: false }
    }
    if (id === 'toggleStylesBar') return { enabled: true, checked: chrome.stylesBarVisible() }
    if (id === 'toggleWordCount') return { enabled: true, checked: chrome.wordCountVisible() }
    if (id === 'toggleStatistics') return { enabled: true, checked: chrome.infoTab() === 'statistics' }
    if (id === 'contents') return { enabled: true, checked: chrome.infoTab() === 'contents' }
    if (id === 'toggleHistoryNavigation') {
      return { enabled: true, checked: chrome.historyNavigationVisible() }
    }

    // §4 of the chip-chrome spec: enabled only while a diagram block is
    // selected, refined by which verbs that diagram's kind supports — float
    // is unavailable on `math`, zoom needs a `generated` diagram.
    if (DIAGRAM_COMMAND_IDS.has(id)) {
      const kind = editor?.diagram.kind() ?? null
      if (kind === null) return { enabled: false, checked: false }
      // Final review Finding 2: float (and, by the identical rule,
      // `MilkdownEditor#diagram.setWidth`) only ever acts on svg or a
      // zoomable generated diagram. `kind === 'math'` alone used to be the
      // whole check, back when 'math' was the only kind besides those two —
      // now that a paste-exhaust text card (json, ansi, …) is its own 'text'
      // kind rather than falling through to 'generated', it needs the same
      // refusal math already got.
      if (DIAGRAM_FLOAT_COMMAND_IDS.has(id) && kind !== 'svg' && kind !== 'generated') {
        return { enabled: false, checked: false }
      }
      if (DIAGRAM_ZOOM_COMMAND_IDS.has(id) && kind !== 'generated') return { enabled: false, checked: false }
      return { enabled: true, checked: false }
    }

    // Reader typography: always available, since the document is always there.
    // Each entry is a thunk rather than a value — building the whole table
    // eagerly would read note-list state on the way to answering about `bold`,
    // and the chrome is not necessarily built when the first question arrives.
    const readerChecks: Partial<Record<DocumentCommandId, () => boolean>> = {
      themeWhite: () => preferences.theme === 'white',
      themeTan: () => preferences.theme === 'tan',
      themeNight: () => preferences.theme === 'night',
      fontIowan: () => preferences.family === 'serif',
      fontGeorgia: () => preferences.family === 'literata',
      fontSystem: () => preferences.family === 'sans',
      fontMono: () => preferences.family === 'mono',
      widthNarrow: () => preferences.width === 'narrow',
      widthNormal: () => preferences.width === 'normal',
      widthWide: () => preferences.width === 'wide',
      leadingTight: () => preferences.leading === 'tight',
      leadingNormal: () => preferences.leading === 'normal',
      leadingOpen: () => preferences.leading === 'open',
      spacingCompact: () => preferences.spacing === 'compact',
      spacingNormal: () => preferences.spacing === 'normal',
      spacingAiry: () => preferences.spacing === 'airy',
      toggleFirstLineIndent: () => preferences.indent === 'first-line',
    }
    const readerCheck = readerChecks[id]
    if (readerCheck !== undefined) return { enabled: true, checked: readerCheck() }

    // Zoom stops where the curated steps stop, so the menu says when a further
    // step is not on offer instead of appearing to do nothing.
    if (id === 'zoomIn') {
      return { enabled: nextScale(preferences.scale, 'up') !== preferences.scale, checked: false }
    }
    if (id === 'zoomOut') {
      return { enabled: nextScale(preferences.scale, 'down') !== preferences.scale, checked: false }
    }
    if (id === 'actualSize') {
      return {
        enabled: preferences.scale !== 1 || (options.pageZoom?.current() ?? 1) !== 1,
        checked: false,
      }
    }

    // Note-list view state needs a note list. Without a catalog these describe
    // nothing, so they are visibly unavailable rather than quietly inert.
    const noteListChecks: Partial<Record<DocumentCommandId, () => boolean>> = {
      previewSmall: () => chrome.previewDensity() === 'small',
      previewMedium: () => chrome.previewDensity() === 'medium',
      previewLarge: () => chrome.previewDensity() === 'large',
      sortByModified: () => chrome.notesSort() === 'modified',
      sortByCreated: () => chrome.notesSort() === 'created',
      sortByTitle: () => chrome.notesSort() === 'title',
      toggleNewestOnTop: () => chrome.newestOnTop(),
    }
    const noteListCheck = noteListChecks[id]
    if (noteListCheck !== undefined) {
      // Sorting by a date the catalog never reported would silently do nothing,
      // so the order that cannot be produced is the one that goes grey.
      const notes = options.workspace?.notes
      const stamped = (of: 'createdAt' | 'updatedAt'): boolean =>
        notes !== undefined && notes.every((note) => note[of] !== undefined)
      const available =
        id === 'sortByCreated'
          ? stamped('createdAt')
          : id === 'sortByModified' || id === 'toggleNewestOnTop'
            ? stamped('updatedAt')
            : notes !== undefined
      return { enabled: available, checked: noteListCheck() }
    }
    if (id === 'hideAttachments') {
      // SimpleMark links files rather than embedding them, so there is nothing
      // to hide. Named and unavailable, matching Bear's own disabled row.
      return { enabled: false, checked: false }
    }
    if (id === 'sortFoldersByTitle') return { enabled: false, checked: chrome.foldersSort() === 'title' }
    if (id === 'sortFoldersByCount') return { enabled: false, checked: chrome.foldersSort() === 'count' }
    if (id === 'toggleFoldersAtoZ') return { enabled: false, checked: chrome.foldersAtoZ() }

    return { enabled: true, checked: false }
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const autosaveMs = options.autosaveMs ?? 900
  const save = async (force = false): Promise<boolean> => {
    clearTimeout(saveTimer)
    // The editor hands changes over on a debounce, so the session can be a
    // couple of hundred milliseconds behind the document on screen. Saving what
    // the session happens to hold would drop the last thing typed and still say
    // "Saved" — worst of all on the save that runs while closing a note.
    editor?.flushPendingChanges()

    if (options.onSaveDraft !== undefined) {
      try {
        const saved = await options.onSaveDraft(session.snapshot().markdown)
        if (!saved) chrome.setStatus('dirty', 'Not saved')
        return saved
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        chrome.setStatus('error', `Not saved — ${message}`)
        return false
      }
    }

    const result = await session.save(force)
    if (result.ok) {
      chrome.setStatus('saved', options.saveSuccessMessage)
      return true
    }
    chrome.setStatus('error', `Not saved — ${result.reason}`)
    return false
  }

  const renameDocument = async (name: string): Promise<boolean> => {
    editor?.flushPendingChanges()
    const result = await session.save()
    if (!result.ok) {
      chrome.setStatus('error', `Not renamed — ${result.reason}`)
      return false
    }
    try {
      return await options.onRenameDocument?.(name) ?? false
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      chrome.setStatus('error', `Not renamed — ${message}`)
      return false
    }
  }

  chrome = createWindowChrome({
    chromeMode: options.chromeMode ?? 'web',
    fileName: session.name,
    filePath: options.filePath,
    onOpenFile: options.onOpenFile,
    openFileUnavailableReason: options.openFileUnavailableReason,
    workspace: options.workspace,
    initialWorkspaceMode: workspaceMode,
    onWorkspaceModeChange: (mode) => {
      workspaceMode = mode
      saveWorkspaceMode(storage, mode)
    },
    uiPreferences,
    onUiPreferencesChange: (next) => {
      uiPreferences = next
      saveUiPreferences(storage, next)
    },
    ...(options.appIcon === undefined
      || options.appIconChoices === undefined
      || options.onAppIconChange === undefined
      ? {}
      : {
          appIcon: options.appIcon,
          appIconChoices: options.appIconChoices,
          onAppIconChange: options.onAppIconChange,
        }),
    onSave: () => void save(true),
    ...(options.onRenameDocument === undefined ? {} : { onRenameDocument: renameDocument }),
    onInsertAsset: ports.assets === undefined
      ? undefined
      : () => void insertAsset(),
    stylesBarVisible,
    onStylesBarVisibleChange: (visible) => {
      stylesBarVisible = visible
      saveStylesBarVisible(storage, stylesBarKey, visible)
    },
    stylesBarPosition,
    onStylesBarPositionChange: (position) => {
      stylesBarPosition = position
      saveStylesBarPosition(storage, stylesBarPositionKey, position)
    },
    preferences,
    onPreferences: (next) => {
      preferences = next
      applyPreferences(next)
      savePreferences(storage, next)
    },
    // Measured from the session rather than the editor: the session is the one
    // that knows what the document currently is.
    getStatistics: () => documentStatistics(session.snapshot().markdown),
    onUpdate: options.onUpdate,
    onClipboardExport: ports.clipboard === undefined
      ? undefined
      : (command) => runCommand(command as DocumentCommandId),
    // The same pure predicates the exports use, so the menu can never offer an
    // item that the command would then refuse.
    getSelectionShape: () => {
      const markdown = editor?.selectionMarkdown() ?? ''
      return {
        inTable: markdownTableToCsv(markdown) !== null,
        inCode: codeFenceContent(markdown) !== null,
      }
    },
    ...(options.onNativeContextMenu === undefined
      ? {}
      : {
          onNativeContextMenu: (
            shape: { readonly inTable: boolean; readonly inCode: boolean },
            target: Node | null,
          ) => {
            nativeContextSelection = editor?.contextSelection(target)
            options.onNativeContextMenu?.(shape)
          },
        }),
    onContinueWriting: () => editor?.continueAfterLastBlock(),
    // The temporary contents popover (EDITOR-3) reads the outline fresh on
    // every open and navigates through the editor — the chrome itself never
    // holds document state.
    getOutline: () => editor?.outline() ?? [],
    onNavigate: (pos) => editor?.navigateToHeading(pos),
    onCommand: (command: EditorCommand) => runCommand(command),
  })

  editor = await MilkdownEditor.mount({
    mount: chrome.editorHost,
    initialMarkdown: session.snapshot().markdown,
    renderer: ports.diagrams,
    ...(ports.clipboard === undefined ? {} : { clipboard: ports.clipboard }),
    ...(ports.diagramFix === undefined ? {} : { diagramFix: ports.diagramFix }),
    ...(options.onSelectionChange === undefined ? {} : { onSelectionChange: options.onSelectionChange }),
    onCopyDeferredTable: async (source) => {
      try {
        if (options.copyDeferredTable !== undefined) return await options.copyDeferredTable(source)
        return await (ports.clipboard?.write({ 'text/plain': source }) ?? Promise.resolve(false))
      } catch {
        return false
      }
    },
    ...(ports.links === undefined ? {} : {
      onOpenLink: async (href: string) => {
          try {
            await ports.links!.open(session.documentHandle(), href)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            chrome.setStatus('error', `Could not open link — ${message}`)
          }
        },
    }),
    // The document handle is bound at call time, not at construction: the open
    // note changes under a long-lived port, and a handle captured once would
    // resolve every later capture against whichever note was open at startup.
    ...(ports.images === undefined ? {} : {
      images: {
        store: (url: string) => ports.images!.store(session.documentHandle(), url),
        read: (href: string) => ports.images!.read(session.documentHandle(), href),
      },
    }),
    onMarkdownChanged: (markdown) => {
      const before = session.snapshot()
      const result = session.apply({
        actorId: 'human',
        name: 'Edit',
        expectedRevision: before.revision,
        markdown,
      })

      if (!result.ok) {
        // The editor raced the session. Say so rather than pretending the edit
        // landed; the live-agent deliverable is what makes this recoverable.
        chrome.setStatus('error', 'Edit refused — document moved underneath the editor')
        return
      }

      chrome.setStatus('dirty')
      chrome.refreshStatistics()
      if (autosaveMs > 0 && options.onSaveDraft === undefined) {
        // Debounced save on pause, never per keystroke (DESIGN.md §8).
        clearTimeout(saveTimer)
        saveTimer = setTimeout(() => void save(), autosaveMs)
      }
    },
  })

  chrome.refreshStatistics()
  if (uiPreferences.infoTab !== null) chrome.openInfoTab(uiPreferences.infoTab)

  // In-document find (EDITOR-7): a temporary overlay in the editor section,
  // never a titlebar control. Cmd/Ctrl+F opens it wherever focus is inside the
  // app; the browser's own page-find is deliberately overridden because the
  // page IS the document.
  const findBar = createFindBar({
    onQuery: (query) => editor?.setFindQuery(query) ?? { count: 0, active: -1 },
    onStep: (direction) => editor?.findStep(direction) ?? { count: 0, active: -1 },
  })
  chrome.editorHost.parentElement?.append(findBar.element)
  chrome.element.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      findBar.open()
    }
  })

  /**
   * Moving between notes on ⌘⌥ plus an arrow.
   *
   * The same double surface `find` uses, and for the same reason: the browser
   * shell has no menubar, so a DOM listener is the only way the shortcut exists
   * there at all. It does not double-fire in the native app — AppKit's native
   * bridge claims the chord before the webview's responder chain sees it, so
   * exactly one of the two paths runs on each platform. That matters more here
   * than it does for `find`, which is idempotent; going back twice on one
   * keypress would not be.
   */
  const NOTE_NAVIGATION: Readonly<Record<string, DocumentCommandId>> = {
    ArrowLeft: 'historyBack',
    ArrowRight: 'historyForward',
    ArrowUp: 'previousNote',
    ArrowDown: 'nextNote',
  }
  chrome.element.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || !event.altKey || event.shiftKey) return
    const command = NOTE_NAVIGATION[event.key]
    if (command === undefined) return
    // Only claim the keystroke once the command is actually available, so a
    // dead end falls through to whatever the platform would otherwise do
    // rather than being silently swallowed.
    if (!commandState(command).enabled) return
    event.preventDefault()
    runCommand(command)
  })

  /**
   * Copy As, in every flavour (EDITOR-10).
   *
   * The selection is converted by the shared `domain` rules and only then
   * handed to a platform clipboard, so a browser and the native shell produce
   * identical bytes. Nothing here writes to the document: copy never mutates
   * the file.
   *
   * A refused clipboard is reported. Browsers can decline a write for reasons
   * the document cannot control, and a success message for something that did
   * not happen is exactly the silent-wrong-state this product refuses.
   */
  async function copySelection(
    id: DocumentCommandId,
    snapshot?: { readonly markdown: string; readonly html: string },
  ): Promise<void> {
    const port = ports.clipboard
    if (port === undefined || editor === undefined) return
    const markdown = snapshot?.markdown ?? editor.selectionMarkdown()

    let payload: { 'text/plain': string; 'text/html'?: string } | null = null
    let describe = 'Copied'

    switch (id) {
      case 'copyAsMarkdown':
        payload = { 'text/plain': markdown }
        describe = 'Copied as Markdown'
        break
      case 'copyAsPlainText':
        payload = { 'text/plain': markdownToPlainText(markdown) }
        describe = 'Copied as plain text'
        break
      case 'copyAsRichText':
        payload = {
          'text/plain': markdownToPlainText(markdown),
          'text/html': snapshot?.html ?? editor.selectionHtml(),
        }
        describe = 'Copied as rich text'
        break
      case 'copyAsHtml':
        // The markup itself is the payload here, so it travels as text.
        payload = { 'text/plain': snapshot?.html ?? editor.selectionHtml() }
        describe = 'Copied as HTML'
        break
      case 'copyCode': {
        const code = codeFenceContent(markdown)
        if (code === null) {
          chrome.setStatus('error', 'Copy Code needs a code block — put the caret inside one')
          return
        }
        payload = { 'text/plain': code }
        describe = 'Copied code'
        break
      }
      case 'copyTableAsMarkdown':
      case 'copyTableAsHtml':
      case 'copyTableAsCsv': {
        const table =
          id === 'copyTableAsCsv'
            ? markdownTableToCsv(markdown)
            : id === 'copyTableAsHtml'
              ? markdownTableToHtml(markdown)
              : markdownTableToCsv(markdown) === null
                ? null
                : markdown
        if (table === null) {
          chrome.setStatus('error', 'Copy Table needs a table — put the caret inside one')
          return
        }
        payload = { 'text/plain': table }
        describe = `Copied table as ${id === 'copyTableAsCsv' ? 'CSV' : id === 'copyTableAsHtml' ? 'HTML' : 'Markdown'}`
        break
      }
      default:
        return
    }

    const ok = await port.write(payload)
    chrome.setStatus(ok ? 'saved' : 'error', ok ? describe : 'Clipboard refused the copy')
  }

  /** Paste that deliberately drops any rich flavour the source offered. */
  async function pasteAsPlainText(): Promise<void> {
    const port = ports.clipboard
    if (port === undefined || editor === undefined) return
    const text = await port.readText()
    if (text === null) {
      chrome.setStatus('error', 'Clipboard unavailable — paste needs permission')
      return
    }
    editor.insertPlainText(text)
  }

  async function insertAsset(): Promise<void> {
    try {
      const reference = await ports.assets?.chooseReference()
      if (reference === null || reference === undefined) return
      editor?.insertAsset(reference)
      chrome.setStatus('dirty', reference.notice ?? 'Portable reference added')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not choose a file'
      chrome.setStatus('error', `File not linked — ${message}`)
    }
  }

  return {
    element: chrome.element,
    run: runCommand,
    diagram: {
      kind: () => editor?.diagram.kind() ?? null,
      setWidth: (px: number | null) => editor?.diagram.setWidth(px) ?? false,
      setFloat: (side: 'left' | 'right' | null) => editor?.diagram.setFloat(side) ?? false,
      delete: () => editor?.diagram.delete() ?? false,
      editSource: () => editor?.diagram.editSource() ?? false,
      zoomIn: () => editor?.diagram.zoomIn() ?? false,
      zoomOut: () => editor?.diagram.zoomOut() ?? false,
      zoomReset: () => editor?.diagram.zoomReset() ?? false,
    },
    applyNoteSummary: (handle, summary) => chrome.applyNoteSummary(handle, summary),
    runNativeContextCommand: (command) => {
      void copySelection(command, nativeContextSelection)
    },
    stylesBarVisible: () => chrome.stylesBarVisible(),
    setUpdateStatus: (status) => chrome.setUpdateStatus(status),
    commandState,
    reconcileWorkspace: (workspace) => chrome.reconcileWorkspace(workspace),
    session,
    editor,
    async destroy() {
      clearTimeout(saveTimer)
      chrome.dispose()
      await editor.destroy()
    },
    save,
    flushPendingChanges: () => editor?.flushPendingChanges(),
    setStatus: (state, message) => chrome.setStatus(state, message),
  }
}

/** A shell preference, never part of the Markdown document. */
function loadStylesBarVisible(
  storage: Pick<Storage, 'getItem'>,
  key: string,
  fallback: boolean,
): boolean {
  try {
    const saved = storage.getItem(key)
    return saved === null ? fallback : saved === 'true'
  } catch {
    return fallback
  }
}

function saveStylesBarVisible(
  storage: Pick<Storage, 'setItem'>,
  key: string,
  visible: boolean,
): void {
  try {
    storage.setItem(key, String(visible))
  } catch {
    // The app remains usable in private or restricted storage contexts.
  }
}

function loadStylesBarPosition(
  storage: Pick<Storage, 'getItem'>,
  key: string,
): StylesBarPosition | undefined {
  try {
    const saved = storage.getItem(key)
    if (saved === null || saved === '') return undefined
    const value = JSON.parse(saved) as Partial<StylesBarPosition>
    if (
      typeof value.x !== 'number' || !Number.isFinite(value.x) || value.x < 0 || value.x > 1 ||
      typeof value.y !== 'number' || !Number.isFinite(value.y) || value.y < 0 || value.y > 1
    ) return undefined
    return { x: value.x, y: value.y }
  } catch {
    return undefined
  }
}

function saveStylesBarPosition(
  storage: Pick<Storage, 'setItem'>,
  key: string,
  position: StylesBarPosition | undefined,
): void {
  try {
    storage.setItem(key, position === undefined ? '' : JSON.stringify(position))
  } catch {
    // Moving optional chrome must never interfere with editing.
  }
}

const PREFERENCES_KEY = 'simplemark.reader-preferences'

/**
 * The width below which the note list and the document cannot share a row.
 *
 * Must equal the `max-width: 620px` breakpoint in `app.css`, where
 * `.document-surface` is hidden outright.
 */
const SINGLE_PANE_WIDTH = 620

/**
 * Which pane a single-pane viewport is showing — navigation, not a preference.
 *
 * Below the breakpoint the list and the document are two screens rather than a
 * split view that got narrow, so "which one am I on" follows from whether a note
 * is open: reading one means you are on it, and having none means you are in the
 * list. Deciding it here rather than in the chrome is what makes it survive —
 * opening a note tears the composition down and builds a new one, so a mode
 * written onto the old DOM is gone moments later.
 *
 * Returns undefined on a viewport that can show both, where the mode really is
 * a remembered preference.
 */
function singlePaneWorkspaceMode(workspace: WorkspaceOptions | undefined): WorkspaceMode | undefined {
  const singlePane = globalThis.matchMedia?.(`(max-width: ${SINGLE_PANE_WIDTH}px)`).matches === true
  if (!singlePane || workspace === undefined) return undefined
  return workspace.activeNoteId === '' ? 'all' : 'editor'
}

function loadWorkspaceMode(storage: Pick<Storage, 'getItem'>): WorkspaceMode {
  try {
    const stored = storage.getItem(WORKSPACE_MODE_KEY)
    return stored === 'all' || stored === 'notes' || stored === 'editor' ? stored : 'all'
  } catch {
    return 'all'
  }
}

function saveWorkspaceMode(
  storage: Pick<Storage, 'setItem'>,
  mode: WorkspaceMode,
): void {
  try {
    storage.setItem(WORKSPACE_MODE_KEY, mode)
  } catch {
    // Losing optional shell state must never interfere with editing.
  }
}

function readPreferenceStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  // Private-browsing and sandboxed contexts throw on access rather than
  // returning null, so a missing store must not take the editor down with it.
  try {
    return window.localStorage
  } catch {
    return { getItem: () => null, setItem: () => {} }
  }
}

function loadPreferences(storage: Pick<Storage, 'getItem'>): ReaderPreferences {
  try {
    const raw = storage.getItem(PREFERENCES_KEY)
    return raw === null ? DEFAULT_PREFERENCES : normalisePreferences(JSON.parse(raw))
  } catch {
    return DEFAULT_PREFERENCES
  }
}

function savePreferences(
  storage: Pick<Storage, 'setItem'>,
  preferences: ReaderPreferences,
): void {
  try {
    storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences))
  } catch {
    // A preference that cannot be persisted is not worth failing an edit over.
  }
}

function applyPreferences(preferences: ReaderPreferences): void {
  const root = document.documentElement
  root.dataset['readerTheme'] = preferences.theme
  for (const [name, value] of Object.entries(preferenceVariables(preferences))) {
    root.style.setProperty(name, value)
  }
}
