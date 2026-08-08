import { describe, expect, it } from 'vitest'

import { planTableDeferral } from '../../src/domain/index.js'

const table = (rows: number, columns = 3): string => {
  const header = Array.from({ length: columns }, (_, index) => ` Column ${index + 1} `).join('|')
  const divider = Array.from({ length: columns }, () => ' --- ').join('|')
  const body = Array.from(
    { length: rows },
    (_, row) => `|${Array.from({ length: columns }, (_, column) => ` ${row}-${column} `).join('|')}|`,
  )
  return `|${header}|\n|${divider}|\n${body.join('\n')}`
}

describe('planTableDeferral', () => {
  it('keeps normal documents fully live', () => {
    const markdown = `# A normal document\n\n${table(2)}\n\nClosing prose.`

    expect(planTableDeferral(markdown)).toMatchObject({
      liveCellCount: 9,
      liveTables: [{ rowCount: 3, columnCount: 3, cellCount: 9 }],
      deferredTables: [],
    })
  })

  it('defers the table that would cross the document-wide live-cell budget', () => {
    const first = table(2, 2)
    const second = table(3, 2)
    const markdown = `# Report\n\n${first}\n\n${second}`
    const plan = planTableDeferral(markdown, 6)

    expect(plan.liveTables).toHaveLength(1)
    expect(plan.liveCellCount).toBe(6)
    expect(plan.deferredTables).toHaveLength(1)
    expect(markdown.slice(plan.deferredTables[0]!.start, plan.deferredTables[0]!.end)).toBe(second)
  })

  it('keeps later tables deferred once a generated report crosses the budget', () => {
    const first = table(1, 2)
    const large = table(1_000, 2)
    const later = table(1, 2)
    const plan = planTableDeferral(`${first}\n\n${large}\n\n${later}`, 10)

    expect(plan.liveTables).toHaveLength(1)
    expect(plan.deferredTables).toHaveLength(2)
    expect(plan.deferredTables.map((item) => item.cellCount)).toEqual([2_002, 4])
  })

  it('does not mistake pipe-looking examples inside fenced code for tables', () => {
    const markdown = `# Notes\n\n\`\`\`markdown\n| Not | A real | Table |\n| --- | --- | --- |\n| Just | an | example |\n\`\`\`\n\n${table(1, 2)}`
    const plan = planTableDeferral(markdown)

    expect(plan.liveTables).toHaveLength(1)
    expect(plan.liveTables[0]).toMatchObject({ rowCount: 2, columnCount: 2, cellCount: 4 })
  })

  it('counts escaped pipes as content rather than new cells', () => {
    const markdown = '| A | B |\n| --- | --- |\n| left \\| still left | right |'
    expect(planTableDeferral(markdown).liveTables[0]).toMatchObject({ cellCount: 4, columnCount: 2 })
  })
})
