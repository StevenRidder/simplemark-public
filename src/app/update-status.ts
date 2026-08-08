/**
 * Is the installed app behind `main`? (docs/UPDATE-NOTIFICATION.md)
 *
 * APP-22 made a build identifiable; this makes it comparable. The two are
 * deliberately separate modules because they answer different questions and
 * only one of them needs the network.
 *
 * The load-bearing rule is that this module never computes ancestry.
 * `build-provenance.ts` already states why:
 *
 * > It can only compare identity, never ancestry — the bundle carries one SHA
 * > and no history … Deciding whether a build is *behind* `main` needs git, and
 * > belongs to the installer rather than to a running app pretending to know.
 *
 * So the app asks the remote that does have the history and reports what it was
 * told. Everything here is a pure function over that answer, which is what lets
 * every branch below be tested without a socket.
 */

import { isCommit } from './build-provenance.js'
import type { BuildProvenance } from './build-provenance.js'

export type UpdateStatus =
  /** This build is the newest, or newer. Nothing to say, and nothing is shown. */
  | { readonly state: 'current' }
  /** A newer commit exists. The only state that asks for a decision. */
  | {
      readonly state: 'behind'
      readonly latestSha: string
      readonly latestShortSha: string
      /** Commits between this build and the newest, when the remote said. */
      readonly behindBy: number
    }
  /**
   * The question could not be answered.
   *
   * Never collapsed into `current`. Absence of the bar is itself a claim — that
   * you are on the latest — and a failed request is not evidence for it
   * (the contributor guide: no turning missing evidence into a green result).
   */
  | { readonly state: 'unknown'; readonly reason: string }

/**
 * What the remote comparison reported.
 *
 * Mirrors the useful half of GitHub's compare response. `status` is the
 * relationship of the *base* (this build) to the head (`main`).
 */
export interface RemoteComparison {
  readonly status: 'identical' | 'behind' | 'ahead' | 'diverged'
  readonly latestSha: string
  readonly behindBy: number
}

/** Seven characters, matching git's abbreviation and the About panel's. */
function abbreviate(sha: string): string {
  return isCommit(sha) ? sha.slice(0, 7) : sha
}

/**
 * Normalises the comparison payload, which crosses an untrusted boundary.
 *
 * A remote answer is input like any other. Returning `null` rather than a
 * partly trusted object means a malformed response becomes `unknown` at the one
 * call site below instead of a plausible-looking `behind` with nonsense in it.
 */
export function readComparison(value: unknown): RemoteComparison | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>

  const status = record['status']
  if (status !== 'identical' && status !== 'behind' && status !== 'ahead' && status !== 'diverged') {
    return null
  }

  // GitHub names these from the base's point of view: `behind_by` is how far
  // the base trails the head, which is exactly what we are asking.
  const latestSha = typeof record['latestSha'] === 'string' ? record['latestSha'] : ''
  const behindBy = record['behindBy']
  if (!isCommit(latestSha)) return null
  if (typeof behindBy !== 'number' || !Number.isFinite(behindBy) || behindBy < 0) return null

  return { status, latestSha, behindBy: Math.floor(behindBy) }
}

/**
 * Turns a build and a comparison into what the footer should show.
 *
 * `comparison === null` means the check did not complete — no network, a 404 on
 * a private repository, a malformed body. All of them are `unknown`, and all of
 * them carry the reason to the surface rather than resolving quietly.
 */
export function updateStatus(
  provenance: BuildProvenance | undefined,
  comparison: RemoteComparison | null,
  reason = 'Could not reach the update check',
): UpdateStatus {
  // A build that cannot name its own commit cannot be measured against one.
  // Reporting `current` here would be the exact fabrication APP-22 exists to
  // prevent, one layer up.
  if (provenance === undefined || !isCommit(provenance.sha)) {
    return { state: 'unknown', reason: 'This build did not record which commit it came from' }
  }
  if (comparison === null) return { state: 'unknown', reason }

  // `ahead` is the normal state of a branch build on a development machine, and
  // `identical` is the happy path. Neither is an update, and nagging about a
  // build that is *newer* than main would make the bar worth ignoring.
  if (comparison.status === 'identical' || comparison.status === 'ahead') return { state: 'current' }

  // `diverged` means a local branch plus new work on main. There is something
  // newer, so it is offered — the person decides whether they want it.
  if (comparison.behindBy === 0) return { state: 'current' }

  return {
    state: 'behind',
    latestSha: comparison.latestSha,
    latestShortSha: abbreviate(comparison.latestSha),
    behindBy: comparison.behindBy,
  }
}

/**
 * The strip's label. Absent for `current`, which renders nothing at all.
 *
 * Deliberately short and fixed-length. The library column is narrow and now
 * resizable, so a label carrying the commit count wraps to two lines at the
 * default width and changes height as the count changes. The count is detail;
 * it belongs in the tooltip, which `detailUpdate` supplies.
 */
export function describeUpdate(status: UpdateStatus): string {
  if (status.state === 'current') return ''
  if (status.state === 'unknown') return 'Could not check'
  return 'Update ready'
}

/** The full sentence, for the tooltip: what is available and how far behind. */
export function detailUpdate(status: UpdateStatus): string {
  if (status.state === 'current') return ''
  if (status.state === 'unknown') return status.reason
  const commits = status.behindBy === 1 ? '1 commit' : `${status.behindBy} commits`
  return `${commits} behind — update to ${status.latestShortSha}`
}
