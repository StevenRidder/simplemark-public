import { describe, expect, test } from 'vitest'

import { TABLE_CELL_BUDGET, planTableRendering } from '../../src/domain/index.js'

/**
 * The guard exists because rendering cost is superlinear in table cells.
 *
 * Measured on this repo (Chromium, real `BrowserFilePort` open path), a
 * PDF-converted Federal Reserve Z.1 release:
 *
 * | cells  | open time | µs/cell |
 * |--------|-----------|---------|
 * |  1,253 |     220ms |     176 |
 * |  5,495 |     632ms |     115 |
 * | 17,608 |   2,975ms |     169 |
 * | 36,525 |   9,625ms |     264 |
 * | 76,339 |  44,693ms |     585 |
 *
 * O(n^1.62): 13.9x the cells costs 71x the time. Forty-four seconds of blocked
 * main thread is a beachball, then "not responding", then a force quit.
 *
 * The decisive measurement is the distribution, not the total. That document's
 * *largest single table* is 770 cells and its median is 253 — a per-table cap
 * would never fire. 239 ordinary tables are what sink it, so the budget has to
 * be cumulative across the document.
 */
describe('planTableRendering', () => {
  test('renders every table live when the document fits the budget', () => {
    const plan = planTableRendering([100, 200, 300])

    expect(plan.renderLive).toEqual([true, true, true])
    expect(plan.deferredCount).toBe(0)
    expect(plan.totalCells).toBe(600)
  })

  test('defers the tables that fall past the cumulative budget', () => {
    // Three tables, each half the budget: the third crosses the line.
    const half = Math.ceil(TABLE_CELL_BUDGET / 2)

    const plan = planTableRendering([half, half, half])

    expect(plan.renderLive).toEqual([true, true, false])
    expect(plan.deferredCount).toBe(1)
  })

  test('defers a single table that exceeds the whole budget on its own', () => {
    const plan = planTableRendering([TABLE_CELL_BUDGET + 1])

    expect(plan.renderLive).toEqual([false])
    expect(plan.deferredCount).toBe(1)
  })

  test('keeps the document opening quickly even when hundreds of small tables follow', () => {
    // The real shape of the Z.1 corpus: 239 tables, ~330 cells each.
    const plan = planTableRendering(Array.from({ length: 239 }, () => 330))

    const liveCells = plan.renderLive.reduce((sum, live, i) => (live ? sum + 330 : sum), 0)

    expect(liveCells).toBeLessThanOrEqual(TABLE_CELL_BUDGET)
    expect(plan.deferredCount).toBeGreaterThan(0)
    expect(plan.totalCells).toBe(239 * 330)
  })

  test('an empty document defers nothing', () => {
    const plan = planTableRendering([])

    expect(plan.renderLive).toEqual([])
    expect(plan.deferredCount).toBe(0)
    expect(plan.totalCells).toBe(0)
  })
})
