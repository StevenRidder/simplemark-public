# `domain/fences`

Run generations and `mayApply` — what makes Stop and Redirect binding.

This is prepared safety machinery for optional direct agent participation, not
part of the renderer-first POC or its UI (ADR-0005).

Ported in concept from Switchboard's `execution_liveness.py`: the generation
is owned by the app, never the agent, and malformed, future, stopped, and stale
generations all fail closed (SWITCHBOARD-KERNEL.md §2). Filled only if the
later agent-participation gate passes.
