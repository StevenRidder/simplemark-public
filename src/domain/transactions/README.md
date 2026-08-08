# `domain/transactions`

Typed document transactions: actor, name, expected revision, block scope, run
generation, and steps.

The renderer-first product uses transactions for human corrections and accepted
external-file updates. It does not require an in-app agent (ADR-0005).

Agent edits are coherent whole-block or structural steps, never blind Markdown
character offsets (ADR-0002). Agent-specific attribution and run metadata are
filled only by the later, evidence-gated participation deliverable.
