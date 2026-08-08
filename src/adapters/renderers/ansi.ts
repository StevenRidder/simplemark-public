/**
 * ANSI SGR → inert HTML.
 *
 * The state machine, the 6×6×6 colour-cube maths and the greyscale ramp are
 * adapted from livemark's `source/plugins/remark-ansi.ts`
 * (https://github.com/datisthq/livemark, MIT © 2025 Evgeny Karev).
 *
 * SimpleMark's first attempt handled only the 16-colour codes and treated every
 * other parameter as a standalone SGR code. That was worse than incomplete: for
 * `38;2;R;G;B` it consumed the `2` as *dim* and discarded the colour, so real CI
 * output rendered with actively wrong styling. Consuming the parameters of
 * `38`/`48` is the whole fix.
 *
 * Colour policy, which differs deliberately from livemark's:
 *
 * - **Indices 0–15** (and the `30–37`/`90–97`/`40–47`/`100–107` shorthands)
 *   resolve to `var(--ansi-N)`. They are *names* — "green" — and a terminal
 *   green must stay legible on both reader grounds (RENDERERS.md contract rule
 *   3: output legible on both is required, not optional).
 * - **Indices 16–255 and truecolor** are absolute values the tool actually
 *   chose, so they are emitted verbatim. Fidelity wins over theming there, and
 *   they cannot be expressed as classes anyway — 16.7M combinations.
 *
 * Everything that is not an SGR sequence (cursor moves, erase) is dropped: a
 * paste renders the text, not the animation.
 */

/** Foreground/background colour: a theme variable or an absolute value. */
type Colour = string

const themeColour = (index: number): Colour => `var(--ansi-${index})`

/**
 * xterm-256 index → colour.
 *
 * 0–15 are the named palette. 16–231 are a 6×6×6 cube whose channel levels are
 * 0, 95, 135, 175, 215, 255. 232–255 are a 24-step greyscale ramp from 8 by 10.
 */
function colour256(n: number): Colour | undefined {
  if (n < 0 || n > 255) return undefined
  if (n < 16) return themeColour(n)
  if (n < 232) {
    const index = n - 16
    const r = Math.floor(index / 36)
    const g = Math.floor((index % 36) / 6)
    const b = index % 6
    const level = (v: number): string => (v === 0 ? 0 : 55 + v * 40).toString(16).padStart(2, '0')
    return `#${level(r)}${level(g)}${level(b)}`
  }
  const grey = (8 + (n - 232) * 10).toString(16).padStart(2, '0')
  return `#${grey}${grey}${grey}`
}

const channel = (v: number): string => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')

interface SgrState {
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  fg: Colour | undefined
  bg: Colour | undefined
}

const EMPTY: SgrState = {
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strikethrough: false,
  fg: undefined,
  bg: undefined,
}

function isPlain(state: SgrState): boolean {
  return (
    !state.bold &&
    !state.dim &&
    !state.italic &&
    !state.underline &&
    !state.strikethrough &&
    state.fg === undefined &&
    state.bg === undefined
  )
}

function styleOf(state: SgrState): string {
  const parts: string[] = []
  if (state.fg !== undefined) parts.push(`color:${state.fg}`)
  if (state.bg !== undefined) parts.push(`background:${state.bg}`)
  if (state.bold) parts.push('font-weight:bold')
  if (state.dim) parts.push('opacity:0.65')
  if (state.italic) parts.push('font-style:italic')
  const decorations: string[] = []
  if (state.underline) decorations.push('underline')
  if (state.strikethrough) decorations.push('line-through')
  if (decorations.length > 0) parts.push(`text-decoration:${decorations.join(' ')}`)
  return parts.join(';')
}

/** Applies one SGR parameter list to the running state. */
function applySgr(state: SgrState, params: readonly number[]): SgrState {
  const next = { ...state }
  for (let i = 0; i < params.length; i += 1) {
    const code = params[i]!
    if (code === 0) {
      Object.assign(next, EMPTY)
    } else if (code === 1) next.bold = true
    else if (code === 2) next.dim = true
    else if (code === 3) next.italic = true
    else if (code === 4) next.underline = true
    else if (code === 9) next.strikethrough = true
    else if (code === 22) {
      next.bold = false
      next.dim = false
    } else if (code === 23) next.italic = false
    else if (code === 24) next.underline = false
    else if (code === 29) next.strikethrough = false
    else if (code >= 30 && code <= 37) next.fg = themeColour(code - 30)
    else if (code >= 90 && code <= 97) next.fg = themeColour(code - 90 + 8)
    else if (code >= 40 && code <= 47) next.bg = themeColour(code - 40)
    else if (code >= 100 && code <= 107) next.bg = themeColour(code - 100 + 8)
    else if (code === 39) next.fg = undefined
    else if (code === 49) next.bg = undefined
    else if (code === 38 || code === 48) {
      // The bug this module exists to fix: these carry their own parameters,
      // and skipping past them is mandatory or the next loop reads a colour
      // channel as a style code.
      const kind = params[i + 1]
      if (kind === 5) {
        const resolved = colour256(params[i + 2] ?? -1)
        if (code === 38) next.fg = resolved
        else next.bg = resolved
        i += 2
      } else if (kind === 2) {
        const resolved = `#${channel(params[i + 2] ?? 0)}${channel(params[i + 3] ?? 0)}${channel(params[i + 4] ?? 0)}`
        if (code === 38) next.fg = resolved
        else next.bg = resolved
        i += 4
      }
    }
  }
  return next
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** All CSI sequences; the `m` final byte is SGR, everything else is dropped. */
// eslint-disable-next-line no-control-regex
const CSI = /\[([0-9;]*)([A-Za-z])/g

/** Converts a terminal capture into escaped HTML carrying its styling. */
export function ansiToHtml(source: string): string {
  let out = ''
  let state: SgrState = { ...EMPTY }
  let last = 0

  const emit = (text: string): void => {
    if (text === '') return
    const escaped = escapeHtml(text)
    if (isPlain(state)) {
      out += escaped
      return
    }
    out += `<span style="${styleOf(state)}">${escaped}</span>`
  }

  for (let match = CSI.exec(source); match !== null; match = CSI.exec(source)) {
    emit(source.slice(last, match.index))
    last = match.index + match[0].length
    if (match[2] !== 'm') continue // cursor movement, erase, etc. — dropped
    const raw = match[1] ?? ''
    const params = raw === '' ? [0] : raw.split(';').map((part) => Number(part) || 0)
    state = applySgr(state, params)
  }
  emit(source.slice(last))

  return out
}
