import { describe, expect, it } from 'vitest'

import { TauriChartDataReader } from '../../src/adapters/filesystem/tauri-chart-data-reader.js'

describe('TauriChartDataReader', () => {
  it('asks the native command for the file, named against the open note', async () => {
    const calls: Array<{ command: string; args: unknown }> = []
    const reader = new TauriChartDataReader(async (command, args) => {
      calls.push({ command, args })
      return 'slot,hit\n1,0.94\n'
    }, () => '/notes/warm-pool.md')

    const text = await reader.read('data/sales.csv')

    expect(text).toBe('slot,hit\n1,0.94\n')
    expect(calls).toEqual([
      {
        command: 'read_note_data',
        args: { documentHandle: '/notes/warm-pool.md', href: 'data/sales.csv' },
      },
    ])
  })

  it('reads against whichever note is open now, not the one open at startup', async () => {
    let open = '/notes/first.md'
    const seen: string[] = []
    const reader = new TauriChartDataReader(async (_command, args) => {
      seen.push((args as { documentHandle: string }).documentHandle)
      return ''
    }, () => open)

    await reader.read('sales.csv')
    open = '/notes/second.md'
    await reader.read('sales.csv')

    expect(seen).toEqual(['/notes/first.md', '/notes/second.md'])
  })

  it('refuses when no note is open rather than resolving against nothing', async () => {
    const reader = new TauriChartDataReader(async () => 'unreachable', () => undefined)

    await expect(reader.read('sales.csv')).rejects.toThrow(/no open note/i)
  })

  it('surfaces the native message rather than swallowing it', async () => {
    const reader = new TauriChartDataReader(async () => {
      throw new Error('Linked file is unavailable: No such file or directory')
    }, () => '/notes/warm-pool.md')

    await expect(reader.read('missing.csv')).rejects.toThrow(/Linked file is unavailable/)
  })
})
