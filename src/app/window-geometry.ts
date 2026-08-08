export const WINDOW_GEOMETRY_KEY = 'simplemark.window-geometry'

export interface WindowGeometry {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly maximized: boolean
}

export function normaliseWindowGeometry(value: unknown): WindowGeometry | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Partial<Record<keyof WindowGeometry, unknown>>
  const numbers = [record.x, record.y, record.width, record.height]
  if (!numbers.every((item) => typeof item === 'number' && Number.isFinite(item))) return null
  const x = record.x as number
  const y = record.y as number
  const width = record.width as number
  const height = record.height as number
  if (Math.abs(x) > 10_000 || Math.abs(y) > 10_000 || width < 620 || height < 460) return null
  if (width > 8_000 || height > 8_000) return null
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    maximized: record.maximized === true,
  }
}

export function loadWindowGeometry(storage: Pick<Storage, 'getItem'>): WindowGeometry | null {
  try {
    const raw = storage.getItem(WINDOW_GEOMETRY_KEY)
    return raw === null ? null : normaliseWindowGeometry(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveWindowGeometry(
  storage: Pick<Storage, 'setItem'>,
  geometry: WindowGeometry,
): void {
  const normalised = normaliseWindowGeometry(geometry)
  if (normalised === null) return
  try {
    storage.setItem(WINDOW_GEOMETRY_KEY, JSON.stringify(normalised))
  } catch {
    // Native storage failure must not make the window unusable.
  }
}
