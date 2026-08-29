# ADR 0003: Workbook change authority

- Status: Accepted
- Date: 2026-08-13

## Context

Chelaro must support fast spreadsheet-style edits and useful coding-agent automation without allowing invisible or stale changes to canonical financial data.

## Decision

- Store invoice workbook cells as typed canonical columns, not arbitrary spreadsheet JSON.
- Require every direct owner mutation to be an atomic change set with the expected row version.
- Record actor, action, request ID, field, before value, and after value in an append-only change ledger.
- Give agents a distinct credential that can read workbook rows and create proposals only.
- Require an owner-authenticated approve or reject action for every agent proposal.
- Reject proposal approval when any referenced row version is stale.
- Keep original document bytes outside workbook mutation paths and deny agents document access.

## Consequences

- Agent work remains reviewable and cannot silently mutate canonical finance data.
- Concurrent edits fail visibly instead of overwriting newer data.
- The UI can offer Excel-like speed while the API preserves typed validation and auditability.
- Agent integrations need a read–propose–review cycle and must handle version conflicts.
- Formula support will require a separately constrained model; arbitrary spreadsheet execution is not part of this decision.
