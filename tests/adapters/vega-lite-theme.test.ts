import { describe, expect, it } from 'vitest'

import { CHART_CATEGORICAL, chartConfig } from '../../src/adapters/renderers/vega-lite-theme.js'
import { VegaLiteRenderer } from '../../src/adapters/renderers/vega-lite-renderer.js'

describe('chartConfig', () => {
  it('offers eight categorical hues per scheme, in a fixed order', () => {
    expect(CHART_CATEGORICAL.light).toHaveLength(8)
    expect(CHART_CATEGORICAL.dark).toHaveLength(8)
    expect(CHART_CATEGORICAL.light[0]).toBe('#2a78d6')
    expect(CHART_CATEGORICAL.dark[0]).toBe('#3987e5')
  })

  it('ranges categorical colour by scheme', () => {
    expect(chartConfig(false).range?.category).toEqual([...CHART_CATEGORICAL.light])
    expect(chartConfig(true).range?.category).toEqual([...CHART_CATEGORICAL.dark])
  })

  it('keeps the page showing through rather than painting its own paper', () => {
    expect(chartConfig(false).background).toBe('transparent')
    expect(chartConfig(true).background).toBe('transparent')
  })

  it('inks axes and legends differently in each scheme', () => {
    const light = chartConfig(false)
    const dark = chartConfig(true)
    expect(light.axis?.labelColor).not.toBe(dark.axis?.labelColor)
    expect(light.legend?.labelColor).not.toBe(dark.legend?.labelColor)
    expect(light.title?.color).not.toBe(dark.title?.color)
  })

  it('recesses the grid rather than drawing a cage', () => {
    const { axis } = chartConfig(false)
    expect(axis?.domain).toBe(false)
    expect(axis?.ticks).toBe(false)
    expect(axis?.gridOpacity).toBeLessThan(1)
  })

  it('rounds the data end of a bar and thins the line and point marks', () => {
    const config = chartConfig(false)
    expect(config.bar?.cornerRadiusEnd).toBe(4)
    expect(config.line?.strokeWidth).toBe(2)
    expect(config.point?.size).toBeGreaterThanOrEqual(64)
  })

  it('sizes the plot so charts in one note agree on their proportions', () => {
    const config = chartConfig(false)
    expect(config.view?.continuousWidth).toBeGreaterThan(0)
    expect(config.view?.continuousHeight).toBeGreaterThan(0)
    expect(config.view?.stroke).toBeNull()
  })
})

describe('VegaLiteRenderer applies the house config', () => {
  const ONE_SERIES = JSON.stringify({
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: [{ a: 1, b: 2 }] },
    mark: 'bar',
    encoding: { x: { field: 'a', type: 'ordinal' }, y: { field: 'b', type: 'quantitative' } },
  })

  it('paints an unstyled chart in the first house hue', async () => {
    const result = await new VegaLiteRenderer().render('vega-lite', ONE_SERIES)
    if (!result.ok) throw new Error(result.message)
    expect(result.markup).toContain(CHART_CATEGORICAL.light[0]!)
  }, 30_000)

  it('lets the chart’s own colour win over the house default', async () => {
    const styled = JSON.stringify({
      $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
      data: { values: [{ a: 1, b: 2 }] },
      mark: { type: 'bar', color: '#ff00ff' },
      encoding: { x: { field: 'a', type: 'ordinal' }, y: { field: 'b', type: 'quantitative' } },
    })
    const result = await new VegaLiteRenderer().render('vega-lite', styled)
    if (!result.ok) throw new Error(result.message)
    expect(result.markup).toContain('#ff00ff')
  }, 30_000)
})
