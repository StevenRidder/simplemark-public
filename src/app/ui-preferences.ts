/** Stable shell choices that belong to the person, never to Markdown. */
export type InfoTab = 'statistics' | 'contents'
export type PreviewDensity = 'small' | 'medium' | 'large'
export type NotesSort = 'modified' | 'created' | 'title'
export type FoldersSort = 'title' | 'count'
export type NoteFilter = 'all' | 'pinned'

export interface UiPreferences {
  readonly previewDensity: PreviewDensity
  readonly notesSort: NotesSort
  readonly newestOnTop: boolean
  readonly foldersSort: FoldersSort
  readonly foldersAtoZ: boolean
  readonly noteFilter: NoteFilter
  readonly historyNavigationVisible: boolean
  readonly wordCountVisible: boolean
  readonly infoTab: InfoTab | null
  readonly libraryColumnWidth: number | null
  readonly notesColumnWidth: number | null
}

export const UI_PREFERENCES_KEY = 'simplemark.ui-preferences'

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  previewDensity: 'medium',
  notesSort: 'modified',
  newestOnTop: true,
  foldersSort: 'title',
  foldersAtoZ: false,
  noteFilter: 'all',
  historyNavigationVisible: false,
  wordCountVisible: false,
  infoTab: null,
  libraryColumnWidth: null,
  notesColumnWidth: null,
}

const oneOf = <T extends string>(value: unknown, choices: readonly T[], fallback: T): T =>
  typeof value === 'string' && choices.includes(value as T) ? value as T : fallback

const boolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

const width = (value: unknown, minimum: number, maximum: number): number | null =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(minimum, Math.min(maximum, value)))
    : null

export function normaliseUiPreferences(value: unknown): UiPreferences {
  const record = typeof value === 'object' && value !== null
    ? value as Partial<Record<keyof UiPreferences, unknown>>
    : {}
  return {
    previewDensity: oneOf(record.previewDensity, ['small', 'medium', 'large'], 'medium'),
    notesSort: oneOf(record.notesSort, ['modified', 'created', 'title'], 'modified'),
    newestOnTop: boolean(record.newestOnTop, true),
    foldersSort: oneOf(record.foldersSort, ['title', 'count'], 'title'),
    foldersAtoZ: boolean(record.foldersAtoZ, false),
    noteFilter: oneOf(record.noteFilter, ['all', 'pinned'], 'all'),
    historyNavigationVisible: boolean(record.historyNavigationVisible, false),
    wordCountVisible: boolean(record.wordCountVisible, false),
    infoTab: record.infoTab === 'statistics' || record.infoTab === 'contents' ? record.infoTab : null,
    libraryColumnWidth: width(record.libraryColumnWidth, 160, 360),
    notesColumnWidth: width(record.notesColumnWidth, 205, 440),
  }
}

export function loadUiPreferences(storage: Pick<Storage, 'getItem'>): UiPreferences {
  try {
    const raw = storage.getItem(UI_PREFERENCES_KEY)
    return raw === null ? DEFAULT_UI_PREFERENCES : normaliseUiPreferences(JSON.parse(raw))
  } catch {
    return DEFAULT_UI_PREFERENCES
  }
}

export function saveUiPreferences(
  storage: Pick<Storage, 'setItem'>,
  preferences: UiPreferences,
): void {
  try {
    storage.setItem(UI_PREFERENCES_KEY, JSON.stringify(normaliseUiPreferences(preferences)))
  } catch {
    // Storage can be unavailable in private/embedded contexts. The live choice
    // still applies; a persistence failure must not break the editor.
  }
}
