# Inline proposal review

Inspected 2026-09-05 against BB commit
`0c3ba712a0c86639a6cf0a445cf9f2062ef5e439`.

The reference is BB's [pending interaction banner](https://github.com/get-bb/bb/blob/0c3ba712a0c86639a6cf0a445cf9f2062ef5e439/apps/app/src/components/thread/pending-interactions/ThreadPendingInteractionBanner.tsx)
and its [approval lifecycle examples](https://github.com/get-bb/bb/blob/0c3ba712a0c86639a6cf0a445cf9f2062ef5e439/apps/app/src/components/thread/timeline/rows/Approval.stories.tsx).
Chelaro independently adopts the compact bordered surface, action summary, expandable details,
right-aligned decision buttons, pending feedback, and visible resolved state. No BB code or assets
are copied. Unlike a general tool permission, each decision approves or rejects one stored financial
proposal; there is no session-wide permission or automatic approval.

Cards are placed after the last visible message of the corresponding turn. Proposals from running
or interrupted turns without a completed provider-turn binding remain visible below the transcript.
Older cards can be loaded separately. Polling while the chat is mounted and refreshing on focus keep
canonical proposal statuses current; refresh follows a contiguous pagination chain.

The owner-only conversation endpoint joins persisted provider runtime and turn bindings. It never
extracts proposal IDs or executable actions from assistant text. The generated OpenAPI model and the
web contract include decimal-string amounts, current/expected versions, the local turn association,
and canonical payment details for reversals. There is no database migration.

Acceptance and rejection reuse the existing owner mutation endpoints, version checks, transaction
locks, and audit events. A confirmed response updates the card; a failed or conflicting request
refreshes its status. Stale proposals and reversals missing their canonical payment cannot be
accepted. Decimal formatting does not convert money to binary floating point. Removing conversation
history continues to leave its financial proposals and documents intact.

Validation includes existing-conversation lookup, cross-conversation isolation, owner authorization,
no mutation before acceptance, rejection, duplicate decisions, exact reversal targets, pagination
with concurrent inserts, malformed responses, and card interaction tests. Desktop visual QA uses
an isolated synthetic transport so no real financial proposal is decided during development.
