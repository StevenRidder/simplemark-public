/**
 * Which build am I actually running? (APP-22)
 *
 * The bundle version is `0.1.0` for every build this project has ever made, so
 * it answers nothing. With several agents merging into `main` continuously, the
 * only question that matters about an installed app is which commit it came
 * from, and until now that was inferred from the bundle's file timestamp.
 *
 * This module is presentation only: it turns what the build recorded into one
 * line for the About panel. It states what the build knew and never improves on
 * it — an unknown commit is reported as unknown, because a bundle that names a
 * commit it could not read is worse than one that admits it has none.
 */

export interface BuildProvenance {
  /** Full commit SHA, or `unknown` when the build had no git metadata. */
  readonly sha: string
  /** Seven characters for a real commit; unabbreviated otherwise. */
  readonly shortSha: string
  /** ISO-8601 UTC build instant, or `unknown`. */
  readonly builtAt: string
  /**
   * `owner/name` this build came from, or `unknown`.
   *
   * Read from the build's own remote rather than written into any source file.
   * The canonical repository is private and `scripts/mirror` refuses to publish
   * source naming it, so a constant would either leak that identity publicly or
   * be wrong in the mirror. This is also what a fork wants: it checks itself,
   * with no configuration.
   */
  readonly repository: string
}

const UNKNOWN = 'unknown'

/** True when the value is a real commit rather than the honest fallback. */
export function isCommit(sha: string): boolean {
  return /^[0-9a-f]{40}$/i.test(sha)
}

/**
 * The About panel's provenance line.
 *
 * Deliberately shows the short SHA and the date only. The short SHA is what you
 * paste into `git log`, and a to-the-second timestamp invites reading build
 * order off a clock rather than off the commit — which is the confusion this
 * whole task exists to end.
 */
export function describeBuild(provenance: BuildProvenance | undefined): string {
  if (provenance === undefined) return 'Build unknown — this shell reported no provenance'
  if (!isCommit(provenance.sha)) {
    return 'Build unknown — compiled from a source tree with no git metadata'
  }
  const day = provenance.builtAt.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? `Commit ${provenance.shortSha} · built ${day}`
    : `Commit ${provenance.shortSha}`
}

/**
 * The build number macOS shows in parentheses after the version.
 *
 * This is the idiomatic slot: every Mac app renders `Version 1.2 (3456)`, where
 * the parenthesised value identifies the exact build behind a marketing version
 * that rarely moves. Ours rarely moves at all — it has been `0.1.0` for every
 * build ever made — so the commit is precisely what belongs there.
 *
 * The `comments` field, which reads like the natural home for this, is a GTK
 * concept that macOS's standard About panel silently ignores.
 */
export function buildNumber(provenance: BuildProvenance | undefined): string {
  if (provenance === undefined || !isCommit(provenance.sha)) return UNKNOWN
  return provenance.shortSha
}

/**
 * Whether this build contains a given commit's work, as far as the app can say.
 *
 * It can only compare identity, never ancestry — the bundle carries one SHA and
 * no history — so this answers "is this exactly that commit?" and nothing more.
 * Deciding whether a build is *behind* `main` needs git, and belongs to the
 * installer rather than to a running app pretending to know.
 */
export function isBuiltFrom(provenance: BuildProvenance | undefined, sha: string): boolean {
  if (provenance === undefined || !isCommit(provenance.sha) || !isCommit(sha)) return false
  return provenance.sha.toLowerCase() === sha.toLowerCase()
}

/** Normalises the native command's payload, which crosses an untyped boundary. */
export function readProvenance(value: unknown): BuildProvenance | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const sha = typeof record['sha'] === 'string' ? record['sha'] : UNKNOWN
  const builtAt = typeof record['built_at'] === 'string' ? record['built_at'] : UNKNOWN
  const shortSha = typeof record['short_sha'] === 'string' ? record['short_sha'] : sha
  const repository = typeof record['repository'] === 'string' ? record['repository'] : UNKNOWN
  return { sha, shortSha, builtAt, repository }
}

/** True when the build named a repository it could actually ask about. */
export function isRepository(value: string): boolean {
  return /^[\w.-]+\/[\w.-]+$/.test(value) && value !== UNKNOWN
}
