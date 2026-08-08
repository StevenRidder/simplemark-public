const ACTIVE_COLLECTION_KEY = 'simplemark.active-collection'

export function loadActiveCollection(storage: Pick<Storage, 'getItem'>): string {
  try {
    const value = storage.getItem(ACTIVE_COLLECTION_KEY)
    return value === null || value.trim() === '' ? 'recent' : value
  } catch {
    return 'recent'
  }
}

export function saveActiveCollection(storage: Pick<Storage, 'setItem'>, collectionId: string): void {
  try {
    storage.setItem(ACTIVE_COLLECTION_KEY, collectionId)
  } catch {
    // The live collection still works if embedded storage is unavailable.
  }
}
