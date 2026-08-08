import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SCENARIO_PATH = resolve('docs/showcase/data/project-tanoa-scenario.json')
const REPORT_PATH = resolve('docs/showcase/project-tanoa.md')
const MAP_PATH = resolve('docs/showcase/assets/fulaga-map.svg')

interface Scenario {
  readonly schema: string
  readonly fictional: boolean
  readonly clock: {
    readonly decisionMinutes: number
  }
  readonly geography: {
    readonly name: string
    readonly osmRelation: number
  }
  readonly battery: {
    readonly capacityKwh: number
    readonly isolationSoc: number
    readonly approvedReserveFloor: number
    readonly staleReserveFloor: number
  }
  readonly load: {
    readonly commissioningKw: number
    readonly priorityKw: number
    readonly flexibleKw: number
    readonly priorityCircuits: readonly string[]
  }
  readonly autonomy: {
    readonly requiredHours: number
    readonly safeBeforeHours: number
    readonly falseControllerHours: number
    readonly acceptedHours: number
    readonly gapHours: number
  }
  readonly final: {
    readonly frequencyHz: number
    readonly reservePct: number
    readonly priorityCircuitsHolding: number
  }
  readonly forecast: readonly {
    readonly hour: number
    readonly generationKw: number
    readonly commissioningReservePct: number
    readonly acceptedReservePct: number
  }[]
}

const oneDecimal = (value: number): number => Math.round(value * 10) / 10

function scenario(): Scenario {
  return JSON.parse(readFileSync(SCENARIO_PATH, 'utf8')) as Scenario
}

function report(): string {
  return readFileSync(REPORT_PATH, 'utf8')
}

describe('Project Tanoa scenario', () => {
  it('provides a checked scenario fixture for every public number', () => {
    expect(existsSync(SCENARIO_PATH), 'the Project Tanoa scenario fixture should exist').toBe(true)
  })

  it('provides the final portable report and its sourced map asset', () => {
    expect(existsSync(REPORT_PATH), 'the Project Tanoa report should exist').toBe(true)
    expect(existsSync(MAP_PATH), 'the sourced Fulaga SVG should exist').toBe(true)
  })

  it('keeps the sourced map self-contained and visibly attributed', () => {
    const map = readFileSync(MAP_PATH, 'utf8')
    expect(map).toContain('data-osm-relation="3521053"')
    expect(map).toContain('Map data © OpenStreetMap contributors')
    expect(map).toContain('https://www.openstreetmap.org/copyright')
    expect(map).not.toMatch(/<image\b|data:image|<script\b|<foreignObject\b/i)
  })

  it('packages three deterministic recorder beats around one source correction', () => {
    const beats = report().split(/^\[simplemark-showcase-(?:paste|final)\]: <simplemark:[^>]+>$/mu)
    expect(beats).toHaveLength(3)
    const [opening, paste, final] = beats
    expect(opening).toContain('data-osm-relation="3521053"')
    for (const source of ['```vega-lite', '$$', '```ansi', '```dot', '```json']) {
      expect(paste).toContain(source)
    }
    expect(paste?.match(/"reserve_floor": 0\.42/gu)).toHaveLength(1)
    expect(final).toContain('50.0 Hz')
    expect(final).toContain('78%')
    expect(final).toContain('3/3')
  })

  it('keeps every local document link portable', () => {
    const links = [...report().matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
      .map((match) => match[1] ?? '')
      .filter((link) => !link.startsWith('#') && !/^[a-z]+:/iu.test(link))
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(existsSync(resolve(dirname(REPORT_PATH), link.split('#')[0] ?? '')), link).toBe(true)
    }
  })

  it('defines the sourced place, battery, load, autonomy, and final state', () => {
    expect(scenario()).toEqual(expect.objectContaining({
      schema: 'simplemark.project-tanoa.v1',
      fictional: true,
      geography: expect.objectContaining({ name: 'Fulaga', osmRelation: 3521053 }),
      battery: expect.any(Object),
      load: expect.any(Object),
      autonomy: expect.any(Object),
      final: expect.any(Object),
    }))
  })

  it('makes the stale floor produce a false pass while the approved floor reveals the gap', () => {
    const fixture = scenario()
    const safeEnergy = fixture.battery.capacityKwh
      * (fixture.battery.isolationSoc - fixture.battery.approvedReserveFloor)
    const staleEnergy = fixture.battery.capacityKwh
      * (fixture.battery.isolationSoc - fixture.battery.staleReserveFloor)

    expect(oneDecimal(safeEnergy / fixture.load.commissioningKw)).toBe(11.2)
    expect(fixture.autonomy.safeBeforeHours).toBe(11.2)
    expect(oneDecimal(staleEnergy / fixture.load.commissioningKw)).toBe(13.1)
    expect(fixture.autonomy.falseControllerHours).toBe(13.1)
    expect(oneDecimal(fixture.autonomy.requiredHours - fixture.autonomy.safeBeforeHours)).toBe(1.8)
    expect(fixture.autonomy.gapHours).toBe(1.8)
  })

  it('closes the gap by deferring only flexible load', () => {
    const fixture = scenario()
    expect(fixture.load.commissioningKw - fixture.load.flexibleKw).toBe(11)
    expect(fixture.load.priorityKw).toBe(11)
    const safeEnergy = fixture.battery.capacityKwh
      * (fixture.battery.isolationSoc - fixture.battery.approvedReserveFloor)
    expect(oneDecimal(safeEnergy / fixture.load.priorityKw)).toBe(13.7)
    expect(fixture.autonomy.acceptedHours).toBe(13.7)
    expect(fixture.load.priorityCircuits).toEqual(['clinic', 'communications', 'water'])
    expect(fixture.final.priorityCircuitsHolding).toBe(3)
    expect(fixture.final.reservePct).toBeGreaterThan(42)
    expect(fixture.final.frequencyHz).toBe(50)
  })

  it('carries a conservative reserve trajectory derived from the two load plans', () => {
    const fixture = scenario()
    expect(fixture.forecast?.map(({ hour, commissioningReservePct, acceptedReservePct }) => ({
      hour,
      commissioningReservePct,
      acceptedReservePct,
    }))).toEqual([
      { hour: 0, commissioningReservePct: 84, acceptedReservePct: 84 },
      { hour: 3, commissioningReservePct: 72.8, acceptedReservePct: 74.8 },
      { hour: 6, commissioningReservePct: 61.5, acceptedReservePct: 65.7 },
      { hour: 9, commissioningReservePct: 50.3, acceptedReservePct: 56.5 },
      { hour: 11.2, commissioningReservePct: 42, acceptedReservePct: 49.8 },
      { hour: 13, commissioningReservePct: 35.3, acceptedReservePct: 44.3 },
    ])
  })

  it('publishes the fixture values in the rendered evidence', () => {
    const fixture = scenario()
    const source = report()
    const chartSource = source.match(/```vega-lite\n([\s\S]*?)\n```/u)?.[1]
    const configSource = source.match(/```json\n([\s\S]*?)\n```/u)?.[1]
    expect(chartSource, 'the report should contain a Vega-Lite chart').toBeDefined()
    expect(configSource, 'the report should contain its corrected JSON profile').toBeDefined()

    const chart = JSON.parse(chartSource ?? '{}') as {
      readonly data?: { readonly values?: readonly Record<string, number | string>[] }
    }
    const expectedChartRows = [
      ...fixture.forecast.map((point) => ({
        hour: point.hour,
        series: 'Commissioning plan',
        reserve: point.commissioningReservePct,
        generation: point.generationKw,
      })),
      ...fixture.forecast.map((point) => ({
        hour: point.hour,
        series: 'Priority plan',
        reserve: point.acceptedReservePct,
        generation: point.generationKw,
      })),
    ]
    expect(chart.data?.values).toEqual(expectedChartRows)

    const config = JSON.parse(configSource ?? '{}') as Record<string, unknown>
    expect(config).toEqual(expect.objectContaining({
      battery_capacity_kwh: fixture.battery.capacityKwh,
      priority_load_kw: fixture.load.priorityKw,
      flexible_load_kw: 0,
      priority_circuits: fixture.load.priorityCircuits,
      reserve_floor: fixture.battery.approvedReserveFloor,
    }))

    const isolationPct = fixture.battery.isolationSoc * 100
    const reservePct = fixture.battery.approvedReserveFloor * 100
    const stalePct = fixture.battery.staleReserveFloor * 100
    const safeEnergy = fixture.battery.capacityKwh
      * (fixture.battery.isolationSoc - fixture.battery.approvedReserveFloor)

    expect(source).toContain(`**${fixture.clock.decisionMinutes} minutes to the isolation decision.**`)
    expect(source).toContain(`BAT["${fixture.battery.capacityKwh} kWh battery\\n${isolationPct}% at isolation"]`)
    expect(source).toContain(String.raw`E_{safe}=${fixture.battery.capacityKwh}\,\mathrm{kWh}\,(${fixture.battery.isolationSoc}-${fixture.battery.approvedReserveFloor})=${safeEnergy.toFixed(1)}\,\mathrm{kWh}`)
    expect(source).toContain(String.raw`t_{before}=\frac{${safeEnergy.toFixed(1)}\,\mathrm{kWh}}{${fixture.load.commissioningKw}\,\mathrm{kW}}=${fixture.autonomy.safeBeforeHours.toFixed(1)}\,\mathrm{h}`)
    expect(source).toContain(String.raw`t_{accepted}=\frac{${safeEnergy.toFixed(1)}\,\mathrm{kWh}}{${fixture.load.priorityKw.toFixed(1)}\,\mathrm{kW}}=${fixture.autonomy.acceptedHours.toFixed(1)}\,\mathrm{h}`)
    expect(source).toContain(`✓ battery link ............... ${fixture.battery.capacityKwh} kWh · ${isolationPct}%`)
    expect(source).toContain(`✗ reserve_floor .............. ${fixture.battery.staleReserveFloor} · expected ${fixture.battery.approvedReserveFloor}`)
    expect(source).toContain(`! controller estimate ........ ${fixture.autonomy.falseControllerHours.toFixed(1)} h · FALSE PASS`)
    expect(source).toContain(`! safe-model estimate ........ ${fixture.autonomy.safeBeforeHours.toFixed(1)} h · SHORT BY ${fixture.autonomy.gapHours.toFixed(1)} h`)
    expect(source).toContain(`| Continue commissioning load | ${fixture.final.priorityCircuitsHolding}/${fixture.load.priorityCircuits.length} | ${fixture.autonomy.safeBeforeHours.toFixed(1)} h | honour ${reservePct}% | reject — ${fixture.autonomy.gapHours.toFixed(1)} h short |`)
    expect(source).toContain(`| Spend below the floor | ${fixture.final.priorityCircuitsHolding}/${fixture.load.priorityCircuits.length} | ${fixture.autonomy.falseControllerHours.toFixed(1)} h apparent | break ${reservePct}% | reject — passes by consuming the promise |`)
    expect(source).toContain(`| **Defer ${fixture.load.flexibleKw.toFixed(1)} kW flexible load** | **${fixture.final.priorityCircuitsHolding}/${fixture.load.priorityCircuits.length}** | **${fixture.autonomy.acceptedHours.toFixed(1)} h** | **honour ${reservePct}%** | **accept** |`)
    expect(source).toContain(`| Grid-forming frequency | **${fixture.final.frequencyHz.toFixed(1)} Hz** | stable |`)
    expect(source).toContain(`| Battery reserve at transition | **${fixture.final.reservePct}%** | above ${reservePct}% floor |`)
    expect(source).toContain(`T−09 m  reserve floor corrected to ${fixture.battery.approvedReserveFloor}`)
    expect(source).toContain(`The controller counted energy down to a ${stalePct}% reserve floor. The community-approved floor is ${reservePct}%.`)
  })
})
