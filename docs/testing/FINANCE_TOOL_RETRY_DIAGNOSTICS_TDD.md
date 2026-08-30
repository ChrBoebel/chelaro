# Finance tool retry diagnostics: TDD evidence

Date: 2026-08-30

## User journey

1. The owner asks the finance assistant to create a reviewable receivable proposal.
2. Codex emits a structurally invalid tool call, for example a numeric amount instead of the required two-decimal string.
3. Chelaro returns only a privacy-safe error code and public formatting guidance. Submitted names, amounts, descriptions, rationale, upstream response bodies, and credentials are not echoed.
4. Codex may correct the tool call exactly once in the same turn.
5. A corrected call creates one pending proposal and one audit event. Canonical financial data remains unchanged until owner approval.

## RED checkpoint

Commit: `5dd2e69 test(agent-host): specify safe finance tool correction`

Command:

```text
pnpm --filter @finance-os/agent-host build
```

Expected failure confirmed before production changes:

- `invalid_request` was not a supported API error classification.
- `httpStatus` was not available for a safe `api_rejected_422` diagnostic.
- the dispatcher had no non-aborting one-time correction path.

## GREEN checkpoint

Commit: `8bd483e fix(agent-host): retry correctable finance tool failures`

Focused tests:

```text
pnpm --filter @finance-os/agent-host build
node --test apps/agent-host/dist/test/finance-api-client.test.js \
  apps/agent-host/dist/test/finance-tool-dispatcher.test.js
```

Result: 18 passed, 0 failed.

Covered failure and security modes:

- invalid local arguments receive `invalid_arguments` without private values;
- a second invalid attempt aborts with `invalid_arguments_retry_exhausted`;
- the correction does not consume the one-proposal-per-turn budget;
- HTTP 400/422 responses are classified without reading or exposing their bodies;
- authorization and server failures remain fail-closed;
- a corrected proposal succeeds after either local validation or an API rejection.

## Coverage

Command:

```text
node --test --experimental-test-coverage \
  apps/agent-host/dist/test/finance-api-client.test.js \
  apps/agent-host/dist/test/finance-tool-dispatcher.test.js
```

Result for the focused source set:

- lines: 90.41%
- branches: 82.46%
- functions: 89.06%

## End-to-end evidence

### Real Codex App Server

The provider-edge regression starts the pinned real Codex App Server with a deterministic synthetic Responses provider. It emits an invalid proposal call, observes the safe tool response, emits one corrected call, and completes the turn.

Result: 2 provider round-trip tests passed, including the correction journey.

### Real API and isolated SQLite database

The same correction journey was run with the real local API and a temporary SQLite database. All credentials and finance values were synthetic and the temporary database was removed from the workspace after verification.

Verified state before owner approval:

- one `pending` `receivable_create` proposal;
- one `created` proposal audit event;
- zero canonical receivables.

### Electron application

Command:

```text
pnpm test:e2e:finance-assistant
```

Result: passed. The isolated desktop journey verified consent, shared Codex login reuse, streamed assistant output, proposal creation, unchanged canonical data before review, owner approval, and the audit-linked receivable.

## Full agent quality gate

Command:

```text
pnpm quality:agent:macos
```

Result: 112 agent-host tests passed, 3 agent-storage tests passed, with typecheck, generated Codex schema, and pinned tool checks all passing.
