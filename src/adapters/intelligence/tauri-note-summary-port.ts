import type { NoteSummary, NoteSummaryPort } from '../../application/index.js'

export type TauriSummaryInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>
export type TauriSummaryListen = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>

/**
 * Thin transport to the native summary queue (ADR-0001: a Tauri command is a
 * transport, never a place where a rule lives).
 *
 * Requests are fire-and-forget and results arrive on an event, because a
 * summary costs over a second on-device and the note list must never wait for
 * one.
 */
export class TauriNoteSummaryPort implements NoteSummaryPort {
  constructor(
    private readonly invoke: TauriSummaryInvoke,
    private readonly listen: TauriSummaryListen,
  ) {}

  async available(): Promise<boolean> {
    return (await this.invoke('note_summaries_available')) === true
  }

  async request(handles: readonly string[]): Promise<void> {
    await this.invoke('request_note_summaries', { handles: [...handles] })
  }

  onSummary(listener: (summary: NoteSummary) => void): () => void {
    let stopped = false
    let unlisten: (() => void) | undefined

    void this.listen('note-summary', (event) => {
      const payload = event.payload as Partial<NoteSummary> | null
      if (
        payload === null ||
        typeof payload.handle !== 'string' ||
        typeof payload.contentHash !== 'string' ||
        typeof payload.summary !== 'string'
      ) {
        return
      }
      listener({
        handle: payload.handle,
        contentHash: payload.contentHash,
        summary: payload.summary,
      })
    }).then((stop) => {
      unlisten = stop
      // The caller may have unsubscribed before `listen` resolved.
      if (stopped) stop()
    })

    return () => {
      stopped = true
      unlisten?.()
    }
  }
}
