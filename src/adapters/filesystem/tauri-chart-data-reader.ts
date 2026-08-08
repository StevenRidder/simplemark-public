import type { ChartDataReader } from '../../application/index.js'

export type TauriChartDataInvoke = (
  command: string,
  args: { documentHandle: string; href: string },
) => Promise<unknown>

/**
 * Thin transport to the native, validated chart-data command.
 *
 * The open note is read through a callback rather than captured at
 * construction: one renderer serves the whole session, and the note under it
 * changes every time you open another one. A captured handle would quietly
 * resolve a chart's data against whichever note happened to be open when the
 * app started.
 */
export class TauriChartDataReader implements ChartDataReader {
  constructor(
    private readonly invoke: TauriChartDataInvoke,
    private readonly openNote: () => string | undefined,
  ) {}

  async read(href: string): Promise<string> {
    const documentHandle = this.openNote()
    if (documentHandle === undefined) {
      throw new Error('There is no open note to resolve this chart’s data against')
    }
    const text = await this.invoke('read_note_data', { documentHandle, href })
    return typeof text === 'string' ? text : String(text)
  }
}
