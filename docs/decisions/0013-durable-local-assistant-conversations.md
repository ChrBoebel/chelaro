# ADR 0013: Persist and resume complete local assistant conversations

Status: Accepted · 31 August 2026

## Context

The first finance-assistant release deliberately discarded chat text and used ephemeral Codex
threads. That made every app restart lose the conversation and prevented users from returning to
earlier work. T3 Code demonstrates the desired local-first interaction: the application owns a
durable conversation projection while the provider runtime stores a resume cursor.

Financial chat text can contain sensitive personal data. A durable design must therefore avoid
turning raw streams, reasoning, tool payloads, or duplicated audit details into an unbounded second
data store. It must also keep Chelaro's proposal-only mutation boundary unchanged.

## Decision

- Store every complete visible user and assistant message in Chelaro's local database. Store the
  user message transactionally before invoking Codex; publish assistant completion to the renderer
  only after the validated final text has committed locally.
- Keep one local conversation row, ordered message projection, turn ledger, safe activity
  projection, provider-runtime binding, and append-only mutation audit. Audit details never contain
  message text or raw financial/tool payloads.
- Start Codex threads with `ephemeral: false`, persist only their opaque thread ID, and use
  `thread/resume` with the full restrictive finance configuration and `excludeTurns: true`.
  Chelaro's database, not provider history hydration, is the UI source of truth.
- Do not silently replace a missing or incompatible provider thread with a new one. Surface context
  loss so the user can make an explicit choice.
- Validate a resumed thread against the shape a resume actually has. Codex answers `thread/resume`
  with three fields `thread/start` does not carry — the first page of provider history and two
  cursors for paging further back — and it names the workspace the thread was started in. The
  contract is exact per operation: the history page must stay empty because Chelaro's database is
  the source of truth, and no workspace root outside Chelaro's runtime directory is accepted.
- Let a resumed thread reattach to the identifier it was bound to. The host's per-epoch identifier
  ledger rejects a reused identifier because a provider that reuses one can confuse two resources;
  a resumed conversation, however, necessarily names its own thread again. The ledger therefore
  records the role each identifier was seen in and only rejects a change of role, so reopening a
  conversation works within one application run instead of only after a restart.
- Continue exposing exactly eight bounded finance tools. Persistent threads additionally require
  the built-in Codex `goals` feature to be disabled; the provider-manifest test remains exact.
- Paginate reads without imposing a retention count. Users can rename, archive, restore, and
  delete conversations. Deletion first asks Codex to remove the bound local provider thread, then
  purges message/runtime rows and leaves only a content-free Chelaro audit tombstone.
- Keep history readable when Codex or the Agent Host is unavailable. Consent revocation stops new
  provider transfers but does not silently erase locally stored conversations.
- Version the expanded consent notice. It explains local message retention, the resumable history
  in the user's existing Codex installation, deletion, and revocation semantics.

This decision supersedes ADR 0010's ephemeral-message and ephemeral-thread rules. Its financial
authority, consent, isolation, and proposal-only rules remain in force.

## Consequences

Users can reopen the app, inspect the full visible session, and continue with the same Codex
context. Chelaro now stores sensitive chat text at rest in the same private local database as other
finance data; database encryption and automated backup remain future work. The shared Codex home
also contains the resumable provider thread, so deletion must cross both stores and can fail closed
if Codex is unavailable.

The design intentionally does not persist reasoning, streaming chunks, command output, raw tool
results, or full event payloads. Provider-side OpenAI retention remains governed outside Chelaro.

## Verification

- API restart test covering complete messages and the provider resume binding;
- versioned SQLite v3-to-v4 migration and PostgreSQL Alembic migration;
- idempotency-conflict tests for changed prompts and changed completion replays;
- Agent Host contract tests for persistent start, exact resume, durable completion ordering, and
  provider-thread deletion;
- exact real-App-Server provider manifest with only the eight finance tools;
- responsive UI tests for local history while the Agent Host is unavailable and exact conversation
  continuation;
- desktop synthetic restart E2E and repository quality/release gates.

## References

- ADR 0010: Finance-assistant authority boundary
- ADR 0011: System Codex CLI and shared authentication
- ADR 0012: Isolated Code Mode finance routing
- [T3 Code repository](https://github.com/pingdotgg/t3code)
