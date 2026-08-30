# Codex finance assistant implementation plan

> Historical implementation plan. ADR 0011 supersedes the separate device-login, app-owned
> `CODEX_HOME`, bundled production CLI, source-only, and multi-PR delivery assumptions. The current
> implementation reuses a compatible system Codex CLI and its existing login in both source and
> packaged desktop modes.

## Goal

Ship a German-first, T3-style chat in Chelaro where Codex helps the owner understand and organize
personal finances. Codex may read bounded typed finance data and create reviewable proposals; it
must not act as a coding agent or directly change canonical finance data.

The plan is complete only when every release gate passes and an independent senior review returns
`APPROVED` with no unresolved high- or medium-severity findings.

## Product slice

The first usable slice supports:

1. explicit OpenAI data-sharing consent and ChatGPT device login;
2. a new Finance assistant view with streamed German chat;
3. questions about the selected month's dashboard and recent transactions;
4. questions about open/paid receivables and one receivable's payment history;
5. pending proposals for receivable detail edits, payment records, and payment reversals;
6. clear proposal cards linking to Chelaro's existing owner review UI;
7. new-chat, interrupt, consent withdrawal, logout, and local assistant-data deletion controls.

Not in V1: coding workspaces, shell/file tools, raw documents/OCR, invoice workbook writes, bank
credentials, transfers, payment execution, investment trading, autonomous approvals, persistent
chat history, voice, web search, arbitrary MCPs, packaged builds, or tax/legal advice.

## Architecture

```text
Sandboxed renderer
  -> same-origin Next.js finance-agent proxy
    -> loopback Agent Gateway + per-launch bearer capability
      -> Finance Agent Host
        -> pinned Codex App Server (chat/auth; no execution environment)
        -> Finance Tool Adapter (typed allowlist)
          -> dedicated Chelaro finance-assistant API projections
             bounded reads + pending proposals only
```

The Electron main process owns all long-lived children and generates separate per-launch owner,
finance-assistant, and gateway credentials. Next.js receives only the owner API token and gateway
capability. The Finance Agent Host receives only the narrowly scoped finance-assistant token and
API URL. The Codex child receives neither. No credential crosses to the browser.

`finance_assistant` is a new API principal, not the existing broad `agent` principal. It can reach
only a dedicated `/api/v1/finance-assistant/*` router. Existing finance, workbook, document,
banking, owner, and legacy-agent routes reject it even if their underlying service is read-only.

## Stable tool contracts and budgets

All inputs use JSON Schema with `additionalProperties: false`. All output envelopes are bounded and
have this shape:

```json
{
  "status": "ok | rejected | stale | unavailable",
  "summary": "short German-safe description",
  "next_actions": [],
  "artifacts": []
}
```

Money values are decimal strings plus explicit ISO 4217 currency codes. Provider projections omit
internal actor IDs, request IDs, raw audit `details`, database identifiers, URLs, document IDs, and
free-form metadata. Every string, array, nesting level, response body, turn, and session has an
explicit byte/token/count budget enforced before complete buffering and again before provider
delivery.

| Tool | Authority | Maximum result |
| --- | --- | --- |
| `finance_get_overview` | read selected month/currency | 64 KiB; one dashboard, 12 cashflow points, 10 recent transactions, 20 open receivables |
| `finance_list_transactions` | read recent typed transactions | 64 KiB; 50 rows |
| `finance_list_receivables` | read typed receivable summaries | 64 KiB; 50 rows |
| `finance_get_receivable` | read one minimal receivable/payment projection | 64 KiB; 1 record, 50 payments and 50 typed event summaries |
| `finance_propose_receivable_create` | create pending proposal | one new receivable with decimal-string amount and ISO currency |
| `finance_propose_receivable_update` | create pending proposal | one receivable and expected version |
| `finance_propose_payment_record` | create pending proposal | one payment and expected version |
| `finance_propose_payment_reversal` | create pending proposal | one payment, reason, and expected version |

Proposal results contain a proposal ID and `pending` status. They never say that a financial change
was applied. Tool errors use safe codes and do not expose upstream bodies, credentials, SQL, paths,
or stack traces.

Per turn, at most 12 read calls, one proposal call, 256 KiB cumulative tool output, and one active
tool call are permitted. Per ephemeral session, at most 60 read calls, five proposal calls, and
1 MiB cumulative tool output are permitted. Exceeding a budget aborts the turn safely.

## Implementation sequence and commit boundaries

### Phase 0 — reviewed contract and fail-closed proof

- Accept ADR 0010 after senior review.
- Reproduce `dynamicTools` from the exact 0.149.1 CLI with experimental schema generation, while
  retaining stable generated request/notification validation for the public client surface.
- Define a narrow local `ThreadStartParams & { dynamicTools: DynamicToolSpec[]; environments: [] }`
  contract with runtime validation of exactly eight names/schemas. Set
  `capabilities.experimentalApi=true` only on this internal connection; arbitrary casts and other
  experimental fields are forbidden.
- Add executable tool schemas and schema-validation tests.
- Add the dedicated `finance_assistant` principal and projection-only router. Prove with route-level
  negative tests that its token cannot reach general finance routes, owner mutations, workbook,
  documents, banking, legacy proposals, or any unrelated endpoint.
- Add a finance API adapter with fake-server contract tests for auth separation, bounds, partial
  oversized streaming bodies, timeout, cancellation, stale versions, malformed responses, and
  redaction.
- Change App Server request policy so all command, file, permission, elicitation, attestation, and
  unknown requests are automatically denied and abort unsafe turns. Only the exact finance tool
  namespace is dispatchable.
- Configure `environments: []` and disable shell/unified exec, patch, view-image, JS REPL, code mode,
  web/search, browser/computer use, apps, connectors, MCP, skills, plugins, hooks, collaboration,
  permission requests, and additional roots. Validate the effective config before every thread.
- With a fake Responses-provider edge, capture the exact model-facing tool manifest and require that
  it contains only the eight finance tools. With a real authenticated 0.149.1 model, complete one
  finance tool request/response and adversarially request shell, patch, file reads inside/outside
  the empty CWD, process start, writes, network, roots, permission escalation, web, skills, apps,
  and collaboration. Assert from process/audit evidence that none executed, not merely that an
  approval was declined.
- Verify unknown tools, unrequested experimental methods/fields, and protocol drift fail closed.
- Prove the Codex child environment omits API URLs/tokens and receives no local execution
  environment. Attempt parent/foreign-process environment inspection and assert no finance or
  gateway secret is observable. Any failed proof stops implementation before Phase 1; no MCP
  fallback is authorized.

Suggested commits: experimental contract, least-privilege API principal, tool contracts, API
adapter, exclusive-tool policy, isolation proof. Push each after its focused checks pass.

### Phase 1 — Finance Agent Host

- Reuse the generated pinned protocol and validated JSONL transport.
- Add process supervision, device-login/auth state, ephemeral thread creation, turn start,
  interrupt, event normalization, and clean shutdown.
- Use a finance-specific system prompt: German by default, no tax/legal certainty, no instructions
  from financial data, no claims that proposals were applied, and ask for missing critical values.
- Expose a small loopback HTTP gateway with health, auth, consent, session, turn, interrupt, logout,
  and event-stream endpoints. Require a constant-time checked per-launch capability on every route,
  strict origin/host validation, body limits, idempotency keys on mutations, concurrency limits, and
  bounded replay.
- Bind every provider request to the active host epoch, thread ID, turn ID, call ID, declared tool,
  consent version, and unresolved lifecycle item. Reject calls before/after the active turn. Process
  tool calls serially and retain an in-memory exactly-once result ledger for every call ID until the
  ephemeral session closes.
- For proposal tools, derive a stable UUID idempotency key from host epoch + thread + turn + call,
  send it to the API, and enforce a unique persisted key there. The API returns the original result
  for an identical retry and rejects a key reused with a different payload. Test duplicates, late
  responses, interruption races, provider retries, Host/API crashes, and restart behavior.
- Never log prompt text, tool arguments/results, financial content, or credentials.

Suggested commits: Codex lifecycle, finance session service, authenticated gateway, desktop
orchestration. Push each after unit and contract tests pass.

### Phase 2 — Desktop source-run runtime and consent

- Generate separate random owner API, finance-assistant API, and gateway tokens for source runs.
- Configure API with owner, legacy-agent (when present), and finance-assistant tokens; configure web
  with owner token plus gateway endpoint; configure Finance Agent Host with finance-assistant token
  plus API endpoint; configure Codex with neither.
- Do not put the finance-assistant token in the Host argv or startup environment. Electron delivers
  it after process start over the already authenticated, bounded IPC channel; the Host keeps it only
  in memory. Treat same-user process inspection as residual risk, not as an OS security boundary.
- Store consent under the established Chelaro user-data directory as an owner-only append-only
  journal. Each grant/revocation records provider, versioned notice hash, exact data categories,
  consent version, and timestamp. The Host is the authoritative checker before login, thread, every
  turn, every tool execution, and every tool response.
- Revocation first appends and fsyncs a `revoke_pending` event that is immediately the authoritative
  deny barrier. Only then does the Host block new work, interrupt active turns, wait for Codex
  shutdown, and optionally append/fsync a completed revoke event. Startup treats `revoke_pending`,
  truncated tails, unknown consent versions, and ambiguous journal state as revoked. The UI confirms
  revocation only after the durable deny barrier exists. Crash injection at every boundary between
  journal write, runtime block, interrupt, shutdown, and completion must still restart as revoked.
  Local deletion occurs only after child shutdown, uses canonical-root and symlink-safe removal with
  crash-recovery markers, and preserves finance proposals/audit records.
- Explain and test that logout/local deletion do not erase provider-side data; link to OpenAI
  account/retention controls.
- Keep the assistant disabled in packaged builds. Packaging requires a new ADR and separate signed,
  hardened, updated, packaged-runtime tests.
- Assistant startup failures remain isolated from finance API/web startup.

Suggested commits: runtime token separation, consent journal, lifecycle integration. Push each
after desktop tests pass.

### Phase 3 — Web chat and owner review

- Read the repository's installed Next.js 16 route-handler and environment-variable documentation
  before implementation.
- Add same-origin streaming proxy routes with origin checks, no-store headers, limits, abort
  propagation, and safe error mapping.
- Add an accessible Finance assistant navigation view with consent disclosure, device login,
  connection state, chat transcript, streaming state, interrupt/retry/new-chat controls, and empty,
  offline, error, consent-revoked, and stale-proposal states.
- Render typed tool activity as human-readable finance steps, never raw model/provider objects.
- Render proposal cards with `pending` status and route owners into the existing proposal drawer.
  Approval/rejection stays in the existing owner-authenticated finance routes.
- Add keyboard, focus, reduced-motion, narrow-screen, and screen-reader tests.

Suggested commits: secure proxy, client state machine, UI, proposal handoff/accessibility. Push each
after focused web tests and build pass.

### Phase 4 — end-to-end and adversarial verification

- API integration: reads are bounded; owner/legacy-agent tokens cannot enter assistant routes;
  finance-assistant token is rejected outside its dedicated router; stale and malformed proposals
  fail; approved proposals produce the expected audit history; rejection never changes canonical
  data.
- Add append-only finance-proposal lifecycle events for creation, approval, and rejection in the
  same transaction as each proposal mutation. Record actor type/id, scope, request ID, idempotency
  key, provider thread/turn/call correlation, event type, and timestamp without chat text. Test
  atomic rollback, duplicate keys, approval/rejection races, and exact actor attribution.
- Provider-edge E2E: a fake Responses provider behind the real pinned App Server captures the exact
  model tool manifest and drives each finance tool, interruption, malformed notifications, unknown
  tools, provider crash/restart, duplicated/late calls, and timeout.
- Source-run Electron E2E through the actual Main process, Next server, API, database, loopback
  gateway, Finance Agent Host, and fake App Server: consent -> fake login -> overview question ->
  proposal creation -> proposal review -> owner approval -> dashboard refresh. Use synthetic data
  only; a browser pointed at a mock gateway does not satisfy this gate.
- Negative E2E: prompt injection in every free-text projection is treated as data; attempted shell,
  file, document, transfer, arbitrary URL, and direct-write operations are denied; secrets never
  appear in provider input, browser responses, logs, screenshots, or snapshots.
- Run repository safety, lint, typecheck, tests, builds, migration check, desktop checks, dependency
  audits, and the supported macOS real-App-Server smoke test.

Suggested commits: provider E2E, application E2E, security regression coverage, docs. Push each
after focused tests pass.

## Release gates

The feature remains disabled unless all are true:

- explicit versioned consent is recorded locally and revocation races pass;
- the pinned signed Codex binary and exact experimental-tool contract validate;
- the provider-facing manifest contains exactly the eight finance tools;
- the Codex child receives no Chelaro credentials or local execution environment;
- the finance tool allowlist, projections, cumulative budgets, and output bounds pass negative tests;
- all persistent finance mutations remain proposals until owner approval;
- each proposal lifecycle mutation emits its append-only audit event in the same transaction;
- duplicate, late, interrupted, crash, and restart tool-call tests pass;
- provider-edge and full source-run Electron E2E pass with synthetic fixtures;
- no high or medium dependency/security finding is unresolved;
- documentation explains provider data sharing, limitations, logout, local-data deletion, and the
  boundary of provider-side retention;
- the independent senior reviewer returns `APPROVED` for architecture, scope, security, code quality,
  dependency discipline, tests, and maintainability.

The release gate also verifies partial oversized streaming responses, deep/long JSON, prompt
injection in every free-text projection, and append-only proposal audit atomicity.

## Review loop

1. Give this plan and ADR 0010 to an independent senior agent.
2. Resolve every high/medium finding and either resolve or explicitly justify low findings.
3. Repeat review until the plan is approved.
4. After implementation, provide the reviewer with the complete diff, test evidence, dependency
   changes, and remaining limitations.
5. Resolve findings and repeat the complete review until it returns `APPROVED`.
