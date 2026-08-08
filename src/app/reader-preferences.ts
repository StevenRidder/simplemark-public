/**
 * Document-level typography (DESIGN.md D6).
 *
 * > Per-selection font, size, and colour cannot be expressed in Markdown, so
 * > they do not exist. Bear works the same way: font family, size, line height,
 * > line width, and theme are preferences. The toolbar handles structure and
 * > emphasis only.
 *
 * These are app preferences, not document content: nothing here is ever written
 * to the `.md` file, and changing them cannot make a document dirty. That is the
 * whole reason this lives in `app` rather than `domain` — it is presentation
 * state, and the document does not know it exists.
 *
 * The Safari Reader model: choose a background, a face, and a size, and the
 * *whole* page follows. EDITOR-3 widens the set to Bear's full reader panel:
 * reading width, line height, paragraph spacing, and first-line indentation —
 * each a small set of curated steps, never a free slider, so every combination
 * has been looked at.
 *
 * Every one of these is also a View-menu command (application/commands.ts).
 * The "Aa" popover and the macOS menubar set the same fields through the same
 * router, which is why `TEXT_SCALES` and `nextScale` needed no change to become
 * Zoom In and Zoom Out — the menu found a preference that was already here.
 */

export const READER_THEMES = ['white', 'tan', 'night'] as const
export type ReaderTheme = (typeof READER_THEMES)[number]

/**
 * A curated set of text faces rather than a system font dump (§6).
 *
 * Serif first: long technical notes are read, and §10.4 puts serif body text at
 * the centre of the visual identity.
 */
export const FONT_FAMILIES = [
  {
    id: 'serif',
    label: 'Iowan',
    stack: "'Iowan Old Style', 'New York', Palatino, Georgia, serif",
  },
  {
    id: 'literata',
    label: 'Georgia',
    stack: "Georgia, 'Times New Roman', serif",
  },
  {
    id: 'sans',
    label: 'System',
    stack: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif",
  },
  {
    id: 'mono',
    label: 'Mono',
    stack: "'SFMono-Regular', Consolas, monospace",
  },
] as const
export type FontFamilyId = (typeof FONT_FAMILIES)[number]['id']

/**
 * Browser-like document zoom limits.
 *
 * Twenty-five to five hundred percent is deliberately much wider than the old
 * six-step reader palette. It keeps a damaged preference from making the page
 * disappear while allowing repeated shortcuts and trackpad pinches to keep
 * moving for as long as a person reasonably expects.
 */
export const MIN_TEXT_SCALE = 0.25
export const MAX_TEXT_SCALE = 5
export type TextScale = number

/** Reading width. `normal` is the approved wireframe's 680px column. */
export const READING_WIDTHS = [
  { id: 'narrow', label: 'Narrow', px: 560 },
  { id: 'normal', label: 'Normal', px: 680 },
  { id: 'wide', label: 'Wide', px: 860 },
] as const
export type ReadingWidthId = (typeof READING_WIDTHS)[number]['id']

/** Body line height. `normal` is the approved wireframe's 1.68 leading. */
export const LINE_HEIGHTS = [
  { id: 'tight', label: 'Tight', value: 1.45 },
  { id: 'normal', label: 'Normal', value: 1.68 },
  { id: 'open', label: 'Open', value: 1.9 },
] as const
export type LineHeightId = (typeof LINE_HEIGHTS)[number]['id']

/** Space between top-level blocks. `normal` is the wireframe's 21px rhythm. */
export const PARAGRAPH_SPACINGS = [
  { id: 'compact', label: 'Compact', px: 12 },
  { id: 'normal', label: 'Normal', px: 21 },
  { id: 'airy', label: 'Airy', px: 32 },
] as const
export type ParagraphSpacingId = (typeof PARAGRAPH_SPACINGS)[number]['id']

/**
 * First-line paragraph indentation, the book convention. Off by default: the
 * wireframe separates paragraphs by spacing, and both at once is neither
 * convention.
 */
export const INDENTATIONS = ['none', 'first-line'] as const
export type IndentationId = (typeof INDENTATIONS)[number]

export interface ReaderPreferences {
  readonly theme: ReaderTheme
  readonly family: FontFamilyId
  readonly scale: TextScale
  readonly width: ReadingWidthId
  readonly leading: LineHeightId
  readonly spacing: ParagraphSpacingId
  readonly indent: IndentationId
}

/**
 * Plain paper, serif body, no zoom.
 *
 * White rather than the wireframe's tan: a first run should look like the
 * document, not like a filter over it, and tan is one menu item away for anyone
 * who wants the warmer page.
 */
export const DEFAULT_PREFERENCES: ReaderPreferences = {
  theme: 'white',
  family: 'serif',
  scale: 1,
  width: 'normal',
  leading: 'normal',
  spacing: 'normal',
  indent: 'none',
}

/** Clamps and rounds one app-provided or persisted scale. */
export function normaliseScale(value: unknown): TextScale {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PREFERENCES.scale
  return Math.round(Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, value)) * 1000) / 1000
}

/**
 * Steps by ten percent, like a browser zoom control, clamping only at the wide
 * safety limits above. Multiplication keeps the visual change proportional at
 * both tiny and very large sizes; rounding makes up followed by down stable.
 */
export function nextScale(current: number, direction: 'up' | 'down'): TextScale {
  const safe = normaliseScale(current)
  return normaliseScale(direction === 'up' ? safe * 1.1 : safe / 1.1)
}

/** Applies a continuous trackpad magnification ratio through the same limits. */
export function scaleBy(current: number, factor: number): TextScale {
  if (!Number.isFinite(factor) || factor <= 0) return normaliseScale(current)
  return normaliseScale(normaliseScale(current) * factor)
}

/**
 * Validates whatever came out of storage.
 *
 * Persisted preferences are untrusted input — a stale build, a hand-edited
 * localStorage, or a future version can all produce nonsense. Each field is
 * validated on its own and falls back to its own default: adding a preference
 * in a release must never wipe the choices a person already made, and one
 * corrupt field is no reason to lose the other six.
 *
 * The pre-EDITOR-3 dark theme was stored as `black`; it maps to `night` so an
 * existing choice survives the rename.
 */
export function normalisePreferences(value: unknown): ReaderPreferences {
  if (typeof value !== 'object' || value === null) return DEFAULT_PREFERENCES

  const candidate = value as Partial<Record<keyof ReaderPreferences, unknown>>
  const theme = candidate.theme === 'black' ? 'night' : candidate.theme

  return {
    theme: READER_THEMES.find((known) => known === theme) ?? DEFAULT_PREFERENCES.theme,
    family:
      FONT_FAMILIES.find((known) => known.id === candidate.family)?.id ??
      DEFAULT_PREFERENCES.family,
    scale: normaliseScale(candidate.scale),
    width:
      READING_WIDTHS.find((known) => known.id === candidate.width)?.id ??
      DEFAULT_PREFERENCES.width,
    leading:
      LINE_HEIGHTS.find((known) => known.id === candidate.leading)?.id ??
      DEFAULT_PREFERENCES.leading,
    spacing:
      PARAGRAPH_SPACINGS.find((known) => known.id === candidate.spacing)?.id ??
      DEFAULT_PREFERENCES.spacing,
    indent:
      INDENTATIONS.find((known) => known === candidate.indent) ?? DEFAULT_PREFERENCES.indent,
  }
}

/** Resolves preferences to the CSS custom properties the stylesheet reads. */
export function preferenceVariables(preferences: ReaderPreferences): Record<string, string> {
  const family = FONT_FAMILIES.find((candidate) => candidate.id === preferences.family)
  const width = READING_WIDTHS.find((candidate) => candidate.id === preferences.width)
  const leading = LINE_HEIGHTS.find((candidate) => candidate.id === preferences.leading)
  const spacing = PARAGRAPH_SPACINGS.find((candidate) => candidate.id === preferences.spacing)
  return {
    '--reader-body': family?.stack ?? FONT_FAMILIES[0].stack,
    '--reader-scale': String(preferences.scale),
    '--reader-width': `${width?.px ?? 680}px`,
    '--reader-leading': String(leading?.value ?? 1.68),
    '--reader-para-space': `${spacing?.px ?? 21}px`,
    '--reader-indent': preferences.indent === 'first-line' ? '1.4em' : '0',
  }
}
