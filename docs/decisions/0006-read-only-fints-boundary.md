# ADR 0006: Keep FinTS preparation separate from canonical transactions

## Context

Chelaro will read the owner's Sparkasse account through FinTS. Bank metadata is useful before the live adapter exists, but banking credentials and unreviewed imports must not weaken the existing trust model.

## Decision

- Model a versioned, owner-only FinTS connection in read-only mode.
- Store only non-secret institution metadata and confirmed capabilities.
- Never accept or persist a banking PIN or TAN through the Chelaro API or web form.
- Record connection mutations as audit events in the same database transaction.
- Keep live synchronization disabled until a secure local credential store and adapter exist.
- Stage future imported movements for review before creating canonical financial transactions.
- Treat PDF account statements as a separate capability from structured transaction retrieval.

## Consequences

The bank setup can be completed incrementally without pretending that live synchronization is available. Adding the adapter later requires an explicit credential-store boundary and an import-candidate workflow, but it does not require changing the existing manual and receivable transaction semantics.
