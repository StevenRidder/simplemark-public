/**
 * How much table a document may render live before the main thread stalls.
 *
 * ProseMirror gives every table cell a node and a DOM element, and the cost of
 * that is superlinear — measured at O(n^1.62) over this repo's PDF-converted
 * corpus. A 208-page Federal Reserve release took 44.7 seconds to open and
 * built 169,082 DOM nodes; the same file sliced to a fifth took 632ms. Blocking
 * that long is indistinguishable from a crash: the window beachballs, macOS
 * marks the app unresponsive, and the reader force-quits.
 *
 * The budget is cumulative over the document, not per table, because the
 * measurement said so. In that same file the largest single table holds 770
 * cells and the median holds 253 — every table is individually reasonable and
 * there are 239 of them. A per-table cap would never have fired.
 *
 * Tables render in document order until the budget is spent; the rest are
 * deferred for the editor to show as a placeholder the reader can open. Once
 * the budget is gone it stays gone, so the deferred region is one contiguous
 * tail rather than holes scattered through the document.
 *
 * Deferring changes rendering only. The source map (`buildSourceMap` /
 * `emitDocument`) re-emits every block the reader did not edit from the
 * original bytes, so a deferred table is byte-identical on save by
 * construction — DESIGN.md §12 holds without this module knowing about it.
 *
 * Pure: counts in, decisions out. No parser, no DOM, no editor.
 */

/**
 * Cells a document may render live.
 *
 * Chosen from the measured curve: 1,253 cells opened in 220ms and 5,495 in
 * 632ms, so 2,000 lands near 300ms in Chromium. Tauri runs WKWebView, which is
 * slower than Chromium here, and the reader feels the whole budget on every
 * open — so the number is deliberately conservative rather than the largest one
 * that "worked" in a benchmark.
 */
export const TABLE_CELL_BUDGET = 2_000

export interface TableRenderPlan {
  /** Live-render decision per table, in document order. */
  readonly renderLive: readonly boolean[]
  /** How many tables were held back. */
  readonly deferredCount: number
  /** Every cell the document contains, rendered or not. */
  readonly totalCells: number
}

/**
 * Decides which tables render live, given each table's cell count in document
 * order.
 *
 * A table renders only if it fits entirely within what is left of the budget.
 * The first table that does not fit exhausts it, and everything after is
 * deferred — including tables small enough to fit, so that the rendered region
 * is a prefix the reader can trust rather than an arbitrary subset.
 */
export function planTableRendering(
  cellCounts: readonly number[],
  budget: number = TABLE_CELL_BUDGET,
): TableRenderPlan {
  const renderLive: boolean[] = []
  let spent = 0
  let exhausted = false

  for (const cells of cellCounts) {
    const fits = !exhausted && spent + cells <= budget
    if (fits) {
      spent += cells
    } else {
      exhausted = true
    }
    renderLive.push(fits)
  }

  return {
    renderLive,
    deferredCount: renderLive.filter((live) => !live).length,
    totalCells: cellCounts.reduce((sum, cells) => sum + cells, 0),
  }
}
