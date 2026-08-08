/**
 * The fence info tail — everything after the language in ```` ```svg width=320 ````.
 *
 * D7 makes these the user's bytes: an untouched block round-trips
 * byte-identically, so layout edits may rewrite only their own `key=value`
 * token and must carry every other token through verbatim, in order.
 * Separators normalise to a single space; token content is never altered.
 */

export interface FenceLayout {
  readonly width: number | undefined
  readonly float: 'left' | 'right' | undefined
}

function tokens(meta: string): string[] {
  return meta.trim() === '' ? [] : meta.trim().split(/\s+/)
}

export function parseFenceLayout(meta: string): FenceLayout {
  let width: number | undefined
  let float: 'left' | 'right' | undefined
  for (const token of tokens(meta)) {
    const widthMatch = /^width=(\d+)$/.exec(token)
    if (widthMatch !== null) {
      const value = Number(widthMatch[1])
      if (Number.isInteger(value) && value > 0) width = value
      continue
    }
    const floatMatch = /^float=(left|right)$/.exec(token)
    if (floatMatch !== null) float = floatMatch[1] as 'left' | 'right'
  }
  return { width, float }
}

export function withFenceMetaKey(meta: string, key: string, value: string | null): string {
  const prefix = `${key}=`
  const kept = tokens(meta).filter((token) => !token.startsWith(prefix))
  const replaced = tokens(meta).map((token) =>
    token.startsWith(prefix) && value !== null ? `${prefix}${value}` : token,
  )
  if (value === null) return kept.join(' ')
  if (tokens(meta).some((token) => token.startsWith(prefix))) {
    // Drop duplicate occurrences beyond the first, which now carries the value.
    let seen = false
    return replaced
      .filter((token) => {
        if (!token.startsWith(prefix)) return true
        if (seen) return false
        seen = true
        return true
      })
      .join(' ')
  }
  return [...kept, `${prefix}${value}`].join(' ')
}
