import { describe, expect, it, vi } from 'vitest'
import { UnavailableNoteSummaryPort } from '../../src/adapters/intelligence/index.js'

describe('the unavailable note summary port', () => {
  // This is the path taken by the browser shell, every Intel Mac, every Mac
  // on macOS 25 or earlier, and anyone with Apple Intelligence off. It is
  // load-bearing, not a stub.
  it('reports that summaries are unavailable', async () => {
    await expect(new UnavailableNoteSummaryPort().available()).resolves.toBe(false)
  })

  it('accepts a request and does nothing', async () => {
    await expect(new UnavailableNoteSummaryPort().request(['a.md'])).resolves.toBeUndefined()
  })

  it('never calls a listener, and unsubscribing is safe', () => {
    const listener = vi.fn()
    const unsubscribe = new UnavailableNoteSummaryPort().onSummary(listener)
    unsubscribe()
    unsubscribe()
    expect(listener).not.toHaveBeenCalled()
  })
})
