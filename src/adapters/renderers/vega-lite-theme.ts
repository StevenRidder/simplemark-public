/**
 * The house look for every chart: one palette, one set of axis inks, one
 * layout. A note full of charts written by different agents on different days
 * should read as one document rather than a scrapbook.
 *
 * Applied as Vega-Lite `config`, which is the layer a spec's own settings
 * override. So this is a floor, not a cage: a chart that names its own colour
 * keeps it, and a chart that names nothing gets the house one.
 *
 * A rendered chart bakes its colours into the SVG and cannot follow CSS, which
 * is why the values are duplicated here from the design tokens rather than
 * referenced as `var(--ink)`. `DiagramNodeView` repaints on a scheme change,
 * the same hook Mermaid diagrams already use.
 */

/**
 * Eight categorical hues in fixed order, never cycled.
 *
 * Validated rather than chosen by eye — `scripts/validate_palette.js` against
 * all three SimpleMark grounds. Every hard gate passes on white (#ffffff), tan
 * (#f8f1e0) and night (#0d0d0d): worst adjacent colourblind separation ΔE 9.1
 * light and 8.4 dark against a target of 8, worst normal-vision separation 19.6
 * and 19.3 against a floor of 15.
 *
 * The dark column is the same eight hues re-stepped for a dark ground, not a
 * different palette — so a chart keeps its identity when the reader switches
 * to night.
 *
 * On white and tan, three of the light hues sit below 3:1 against the paper.
 * That is a documented relief case, not a failure: Vega-Lite always draws a
 * legend for two or more series, and the chart's own source — data included —
 * is one click beneath the block, which is the table view the rule asks for.
 */
export const CHART_CATEGORICAL = {
  light: [
    '#2a78d6', // blue
    '#eb6834', // orange
    '#1baf7a', // aqua
    '#eda100', // yellow
    '#e87ba4', // magenta
    '#008300', // green
    '#4a3aa7', // violet
    '#e34948', // red
  ],
  dark: [
    '#3987e5',
    '#d95926',
    '#199e70',
    '#c98500',
    '#d55181',
    '#008300',
    '#9085e9',
    '#e66767',
  ],
} as const

/** The token inks a chart borrows, per scheme (tokens.css §Reader themes). */
const INK = {
  light: { strong: '#1a1a1a', soft: '#5f5f5f', line: '#e6e6e6' },
  dark: { strong: '#ececec', soft: '#a6a6a6', line: '#2a2a2a' },
} as const

/** The shape of the config this renderer supplies. Structural on purpose: it
 * keeps the vega-lite types out of the eager import graph, which matters
 * because the whole library is meant to load on demand. */
export interface ChartConfig {
  background: string
  font?: string
  range?: { category: string[] }
  view?: { continuousWidth: number; continuousHeight: number; stroke: null }
  axis?: {
    labelColor: string
    titleColor: string
    gridColor: string
    gridOpacity: number
    domain: boolean
    ticks: boolean
    labelFontSize: number
    titleFontSize: number
    titlePadding: number
  }
  legend?: { labelColor: string; titleColor: string; labelFontSize: number; symbolType: string }
  title?: { color: string; fontSize: number; fontWeight: number; anchor: string; offset: number }
  mark?: { color: string }
  bar?: { cornerRadiusEnd: number }
  line?: { strokeWidth: number }
  point?: { size: number; filled: boolean }
}

export function chartConfig(dark: boolean): ChartConfig {
  const ink = dark ? INK.dark : INK.light
  const category = dark ? CHART_CATEGORICAL.dark : CHART_CATEGORICAL.light

  return {
    // The paper shows through. A chart that paints its own white ground is a
    // bright rectangle on night paper, which is the defect contract rule 3
    // exists to prevent.
    background: 'transparent',
    font: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
    range: { category: [...category] },
    view: { continuousWidth: 360, continuousHeight: 220, stroke: null },
    axis: {
      labelColor: ink.soft,
      titleColor: ink.strong,
      gridColor: ink.line,
      // Recessive: the grid orients the eye, it does not compete with the data.
      gridOpacity: 0.6,
      domain: false,
      ticks: false,
      labelFontSize: 11,
      titleFontSize: 12,
      titlePadding: 8,
    },
    legend: { labelColor: ink.soft, titleColor: ink.strong, labelFontSize: 11, symbolType: 'square' },
    title: { color: ink.strong, fontSize: 13, fontWeight: 600, anchor: 'start', offset: 10 },
    // A single-series chart never touches the categorical range — Vega-Lite
    // only reaches for it when something is encoded by colour. Without this a
    // lone bar chart would render in Vega's default blue, so the first house
    // hue would only ever appear on charts that had two series.
    mark: { color: category[0]! },
    bar: { cornerRadiusEnd: 4 },
    line: { strokeWidth: 2 },
    point: { size: 64, filled: true },
  }
}
