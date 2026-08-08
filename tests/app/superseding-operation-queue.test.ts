import { describe, expect, it, vi } from 'vitest'

import { SupersedingOperationQueue } from '../../src/app/superseding-operation-queue.js'

describe('SupersedingOperationQueue', () => {
  it('opens only the newest note when several middle-panel selections queue', async () => {
    const opened: string[] = []
    const queue = new SupersedingOperationQueue(() => {})
    let releaseSave!: () => void
    const saving = new Promise<void>((resolve) => { releaseSave = resolve })

    const first = queue.enqueueLatest('note', async (isCurrent) => {
      await saving
      if (isCurrent()) opened.push('A.md')
    })
    const second = queue.enqueueLatest('note', async () => { opened.push('B.md') })
    const third = queue.enqueueLatest('note', async () => { opened.push('C.md') })

    releaseSave()
    await Promise.all([first, second, third])

    expect(opened).toEqual(['C.md'])
  })

  it('lets the active note supersede a pending switch back to itself', async () => {
    const opened: string[] = []
    const queue = new SupersedingOperationQueue(() => {})
    let releaseSave!: () => void
    const saving = new Promise<void>((resolve) => { releaseSave = resolve })

    const switchToB = queue.enqueueLatest('note', async (isCurrent) => {
      await saving
      if (isCurrent()) opened.push('B.md')
    })
    const redirectToA = queue.enqueueLatest('note', async () => { opened.push('A.md') })

    releaseSave()
    await Promise.all([switchToB, redirectToA])

    expect(opened).toEqual(['A.md'])
  })

  it('keeps unrelated filesystem operations in order', async () => {
    const order: string[] = []
    const queue = new SupersedingOperationQueue(() => {})

    await Promise.all([
      queue.enqueue(async () => { order.push('save') }),
      queue.enqueue(async () => { order.push('trash') }),
    ])

    expect(order).toEqual(['save', 'trash'])
  })

  it('reports a failure and lets the next operation continue', async () => {
    const onError = vi.fn()
    const queue = new SupersedingOperationQueue(onError)

    await queue.enqueue(async () => { throw new Error('read failed') })
    await queue.enqueue(async () => {})

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[0]).toEqual(new Error('read failed'))
  })
})
