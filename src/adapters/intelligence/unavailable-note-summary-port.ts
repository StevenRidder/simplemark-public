import type { NoteSummary, NoteSummaryPort } from '../../application/index.js'

/**
 * Summaries are absent, not disabled.
 *
 * Every method succeeds quietly. Nothing greys out, nothing explains itself,
 * and no setting appears — a caller cannot tell this apart from a machine
 * whose model simply has nothing to say yet.
 *
 * This is the path taken by the browser shell, every Intel Mac, every Mac on
 * macOS 25 or earlier, and anyone with Apple Intelligence turned off. That is
 * a large share of users, and for all of them the note list must be exactly
 * what it is today: rows carrying their own extracted lead sentence.
 */
export class UnavailableNoteSummaryPort implements NoteSummaryPort {
  async available(): Promise<boolean> {
    return false
  }

  async request(_handles: readonly string[]): Promise<void> {}

  onSummary(_listener: (summary: NoteSummary) => void): () => void {
    return () => {}
  }
}
