export const APP_ICON_IDS = [
  'original',
  'live-layers',
  'movable-blocks',
  'blue-trio',
  'electric-blocks',
  'midnight',
  'blue-page',
] as const

export type AppIconId = typeof APP_ICON_IDS[number]

export interface AppIconChoice {
  readonly id: AppIconId
  readonly label: string
  readonly source: string
}

export const APP_ICON_CHOICES = [
  {
    id: 'original',
    label: 'Original',
    source: new URL('../../src-tauri/icons/alternates/original.svg', import.meta.url).href,
  },
  {
    id: 'live-layers',
    label: 'Live Layers',
    source: new URL('../../src-tauri/icons/alternates/live-layers.svg', import.meta.url).href,
  },
  {
    id: 'movable-blocks',
    label: 'Movable Blocks',
    source: new URL('../../src-tauri/icons/alternates/movable-blocks.svg', import.meta.url).href,
  },
  {
    id: 'blue-trio',
    label: 'Blue Trio',
    source: new URL('../../src-tauri/icons/alternates/blue-trio.svg', import.meta.url).href,
  },
  {
    id: 'electric-blocks',
    label: 'Electric + Black',
    source: new URL('../../src-tauri/icons/alternates/electric-blocks.svg', import.meta.url).href,
  },
  {
    id: 'midnight',
    label: 'Midnight',
    source: new URL('../../src-tauri/icons/alternates/midnight.svg', import.meta.url).href,
  },
  {
    id: 'blue-page',
    label: 'Blue Page',
    source: new URL('../../src-tauri/icons/alternates/blue-page.svg', import.meta.url).href,
  },
] as const satisfies readonly AppIconChoice[]

export function normaliseAppIconId(value: unknown): AppIconId {
  return APP_ICON_IDS.find((id) => id === value) ?? 'original'
}
