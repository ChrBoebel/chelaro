# ADR 0004: Separate booked and expected money

- Status: Accepted
- Date: 2026-08-13

## Context

A personal finance overview must answer both how much money actually arrived and how much other people still owe. Combining those figures would overstate available cash and make the dashboard misleading.

## Decision

- Store actual income and expenses as immutable-direction financial transactions.
- Store money owed to the owner as separate receivables with original, received, and outstanding amounts.
- Exclude outstanding receivables from income, expenses, and net cashflow.
- Recording a receivable payment atomically creates a linked income transaction and reduces the outstanding amount.
- Support partial payments and reject payments above the remaining amount.
- Derive `overdue` from the due date rather than persisting a status that can become stale.
- Allow agents to read the dashboard, transactions, and receivables, but reserve direct financial bookings for the owner.

## Consequences

- The displayed net amount represents booked cash movement rather than optimistic expectations.
- Users can see what is missing without confusing it with available money.
- Every received repayment is traceable to its originating receivable.
- Bank imports can later match existing transactions or receivables without changing this core accounting distinction.
