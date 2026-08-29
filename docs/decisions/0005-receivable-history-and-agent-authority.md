# ADR 0005: Receivable history and agent authority

- Status: Accepted
- Date: 2026-08-13

## Context

A running receivable needs more than a remaining balance. The owner must see what each payment covered, how it arrived, who recorded it, and whether a prior booking was corrected. Codex and Claude Code should help maintain this data without receiving an invisible direct-write path.

## Decision

- Store every received amount as a dedicated payment linked to its actual income transaction.
- Record payment date, purpose, payment method, optional note, actor, and optional originating proposal.
- Keep corrections visible as one-to-one reversals with a compensating expense transaction; never delete or overwrite the original payment.
- Append a receivable event in the same database transaction for creation, detail edits, payments, and reversals.
- Add an integer version to each receivable and require it for every owner mutation and agent proposal.
- Allow agents to read receivable details and propose detail edits, payments, or reversals only.
- Require an owner-authenticated approval or rejection; apply approved proposals atomically and retain the agent as the recorded originator.

## Consequences

- The outstanding amount, payment history, and cashflow remain consistent after partial payments and corrections.
- An audit view can distinguish owner actions, migrated history, and owner-approved agent work.
- Stale proposals fail visibly instead of overwriting newer owner changes.
- A correction appears as two transparent cashflow entries whose net effect is zero, rather than silently rewriting history.
