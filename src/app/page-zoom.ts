export const PAGE_ZOOM_KEY = 'simplemark.page-zoom'
export const MIN_PAGE_ZOOM = 0.2
export const MAX_PAGE_ZOOM = 5

export interface PageZoomController {
  readonly current: () => number
  readonly set: (zoom: number) => void
  /** Tracks a live native-gesture sample without writing local storage. */
  readonly preview: (zoom: number) => void
  /** Records the final native-gesture scale for the next launch. */
  readonly remember: (zoom: number) => void
}

export interface NativeMagnificationPort {
  /**
   * Turns on WKWebView's browser-style magnification. The document, app
   * controls, and navigation live inside this web view and scale together;
   * macOS's own window chrome remains outside it, just as in a browser.
   */
  readonly enable: () => void | Promise<void>
  /** Restores a saved scale or returns to Actual Size through WebKit. */
  readonly setMagnification: (zoom: number) => void | Promise<void>
  /**
   * Keeps the native macOS traffic lights on the same header baseline as the
   * magnified web view. Other platforms deliberately have no equivalent.
   */
  readonly syncTrafficLightPosition?: (zoom: number) => void | Promise<void>
}

export function clampPageZoom(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(MIN_PAGE_ZOOM, Math.min(MAX_PAGE_ZOOM, value))
}

export function loadPageZoom(storage: Pick<Storage, 'getItem'>): number {
  const raw = storage.getItem(PAGE_ZOOM_KEY)
  return raw === null ? 1 : clampPageZoom(Number(raw))
}

export function savePageZoom(storage: Pick<Storage, 'setItem'>, zoom: number): void {
  try {
    // Gesture samples are much finer than a percent. Retain enough precision
    // to reopen at the same scale, while avoiding a long floating-point string
    // in a human-inspectable local preference.
    storage.setItem(PAGE_ZOOM_KEY, String(Math.round(clampPageZoom(zoom) * 1000) / 1000))
  } catch {
    // The current zoom still works when embedded storage is unavailable.
  }
}

/**
 * Browser-style whole-page magnification used by the macOS shell.
 *
 * WebKit owns drawing, layout, scrolling, focus, and hit-testing, exactly as
 * it does in a browser. AppKit gesture samples only update the persisted
 * preference; they never make a competing DOM transform or layout zoom.
 */
export function createPageZoomController(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  native: NativeMagnificationPort,
): PageZoomController {
  let current = loadPageZoom(storage)
  void native.enable()
  void native.setMagnification(current)

  const preview = (zoom: number): void => {
    current = clampPageZoom(zoom)
    void native.syncTrafficLightPosition?.(current)
  }

  const remember = (zoom: number): void => {
    preview(zoom)
    savePageZoom(storage, current)
  }

  preview(current)

  return {
    current: () => current,
    set: (zoom) => {
      remember(zoom)
      void native.setMagnification(current)
    },
    preview,
    remember,
  }
}
