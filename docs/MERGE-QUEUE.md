# Native GitHub merge queue

SimpleMark uses GitHub's native merge queue on `main`. It is intentionally smaller
than Switchboard's queue integration: GitHub Actions runs the proof directly, and
GitHub owns the queue, rebase, squash merge, and resulting merge commit.

## Two honest levels of proof

| Where | Check named `gate` | Why |
| --- | --- | --- |
| Pull request head | Fast: install, whitespace hygiene, TypeScript, and unit tests | Fast admission without paying for browser CI twice |
| GitHub merge group | Full: the fast checks plus build and the complete Playwright suite, split across eight browser runners | Proof for the synthetic commit that will land on `main` |

The required check keeps the same name in both places so branch protection and the
queue have one stable contract. The full run is triggered by GitHub's `merge_group`
event, not by an agent or a second queue service. Its browser suite runs as eight
independent two-worker shards, with the styles-bar file isolated into a ninth
two-worker job that can use test-level parallelism safely. The required `gate`
job aggregates those results with the non-UI checks.

## Operator flow

1. An agent pushes a PR and waits for the fast `gate`.
2. The agent records its normal Switchboard evidence, then adds the PR to GitHub's
   squash merge queue.
3. GitHub creates a merge-group commit from current `main` and the queued changes.
4. The full `gate` passes on that commit; GitHub squashes it onto `main`.
5. Switchboard reads canonical `main` merge provenance before it marks the task Done.

If the full queue gate fails, GitHub removes that entry. It never lands a failing or
stale PR. The queue configuration starts with one PR per merge group and two active
merge-group builds; increase concurrency only after queue receipts show it is useful.

## Local commands

```bash
# Fast PR admission equivalent
SIMPLEMARK_CI_SCOPE=fast bash scripts/simplemark_ci.sh

# Full merge-group equivalent
bash scripts/simplemark_ci.sh
```

`SIMPLEMARK_CI_SKIP_INSTALL=1` is reserved for hosted workflows that have already
installed dependencies for Chromium. Local contributors should not set it.
