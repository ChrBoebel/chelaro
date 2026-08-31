# ADR 0010: Embed Codex as a proposal-only personal finance assistant

## Status

Accepted for Phase 0 on 2026-08-28 after independent senior review. Later phases remain blocked
until the Phase-0 gates in the reviewed implementation plan pass. Authentication, `CODEX_HOME`,
and desktop runtime integration are superseded by ADR 0011. The Code Mode routing decision is
amended by ADR 0012. Ephemeral chat retention is superseded by ADR 0013.

## Context

Chelaro should offer a conversational assistant similar to the chat experience in T3 Code, but
the assistant's job is personal finance management rather than software development. The prior
Codex decisions explored a coding agent with a sanitized source workspace. That product scope is
wrong for Chelaro and must not determine the finance assistant's authority.

The existing domain already separates canonical owner writes from agent proposals. Authenticated
agents can read typed financial resources and can create version-bound proposals. Owners approve
or reject those proposals, and approved changes retain their agent origin in the audit history.

Codex App Server supplies ChatGPT device authentication, conversations, streaming events, and tool
calls. It is a local control-plane dependency, not a financial system of record.

## Decision

- Use the pinned Codex App Server for authentication, reasoning, and streamed chat only.
- Give every finance chat an ephemeral Codex thread with an app-owned `CODEX_HOME`. Do not load the
  user's global Codex configuration, history, skills, plugins, hooks, apps, or MCP servers.
- Start the thread with no execution environment (`environments: []`) and an empty app-owned
  directory. Disable shell, unified execution, patch, file/image viewing, JavaScript REPL, network,
  web search, browser/computer use, collaboration, MCP, apps, skills, plugins, hooks, and
  user-added tools in the effective pinned configuration. Implementation stops if the provider-edge
  tool manifest contains anything except Chelaro's eight finance tools or if an adversarial real
  turn can execute a built-in tool.
- Give Codex only eight app-owned finance functions. The first release contains bounded reads for
  the dashboard, transactions, receivables, and one receivable detail, plus proposal creation for
  new receivables, receivable edits, payment records, and payment reversals.
- Implement each tool as an explicit schema and a host-side handler. Unknown tools, extra input
  fields, oversized values, invalid identifiers, non-ISO currencies, stale versions, and responses
  outside bounded output schemas fail closed.
- Use a new `finance_assistant` API principal and per-launch credential. It can call only dedicated
  minimal finance projections and finance-proposal creation. It is rejected by general finance,
  workbook, document, banking, owner-mutation, and legacy-agent routes.
- Keep the finance-assistant credential in the trusted Chelaro Finance Agent Host. The Host and the
  Codex subprocess have separate logical capabilities and allowlisted environments, but this is not
  OS isolation: both run as the same user. The credential is delivered to the Host after process
  start over its authenticated IPC channel, not through argv or its startup environment, and is
  never included in prompts, browser responses, logs, Codex child environment, tool output, or
  committed configuration.
- Treat typed finance data returned by Chelaro as untrusted prompt content. System instructions
  explicitly forbid following instructions found in counterparties, descriptions, notes, or other
  data fields.
- Never expose original document bytes or OCR text, banking credentials, database access, owner
  credentials, local filesystem access, bank transfers, payment execution, tax/legal advice tools,
  arbitrary HTTP, arbitrary SQL, or host execution. ADR 0012 permits only the isolated JavaScript
  router required by GPT-5.6 to call the eight finance functions.
- External provider use is off by default. The owner must explicitly consent before the first
  Codex login or finance message, and the UI must explain that selected typed financial data and
  chat messages are sent to OpenAI.
- Store consent as an owner-only, append-only local record containing provider, notice hash, data
  categories, consent version, timestamp, and grant/revoke action. The Host checks the current grant
  before login, thread creation, every turn, every tool execution, and every tool response. Revoking
  consent first durably records a deny-authoritative `revoke_pending` event, then interrupts the turn
  before any further provider transfer. Pending, truncated, ambiguous, or version-unknown consent
  state is always treated as no consent.
- Proposal tools create reviewable pending records only. Canonical changes still require the
  existing owner approval endpoint and expected-version check. The chat UI never disguises a
  proposal as an applied change.
- The renderer talks through same-origin Next.js routes to a loopback-only, capability-token
  protected host gateway. The Electron main process owns startup, shutdown, and per-launch secrets.
- The original V1 decision kept messages and provider threads ephemeral. ADR 0013 supersedes this
  point with complete local message retention and resumable provider threads.
- Correlate every tool request to the one active thread, turn, call ID, host epoch, and consent
  version. Proposal calls are exactly-once at the Host and persistently idempotent in the API.
- Add append-only proposal lifecycle events for creation, approval, and rejection in the same
  database transaction as the proposal mutation. They record actor/scope and request/tool-call
  correlation without storing chat text.
- Fail closed without a supported pinned Codex binary, authenticated account, explicit consent,
  healthy finance API, finance-assistant credential, exact protocol baseline, or successful
  negative security self-tests. Core finance features continue to work when the assistant is
  unavailable.
- Limit the accepted V1 runtime to the existing macOS 15.6 arm64 source-run Electron app. The
  assistant is disabled in packaged builds. Packaged distribution requires a separate reviewed ADR
  covering signing, hardened runtime, paths, permissions, updates, and packaged E2E.

## Experimental protocol boundary

The required `dynamicTools` field and `item/tool/call` flow are experimental in Codex App Server
0.149.1 and require `capabilities.experimentalApi = true`. The stable generated schema intentionally
omits the field even though the same pinned CLI reproducibly generates it with `--experimental`.

Chelaro will not enable the complete experimental client surface. It defines a narrow local
intersection over the stable `ThreadStartParams` containing only a validated array of the eight
generated `DynamicToolSpec` values and an empty `environments` array. All other requests and
notifications continue through the stable allowlist and fail closed. Phase 0 must prove
registration, a complete real tool-call cycle, unknown-tool rejection, protocol-drift rejection,
and the exclusive provider-facing tool manifest against the exact pinned binary. Failure leaves
the feature disabled and stops later phases.

## Relationship to earlier Codex decisions

ADR 0007 and ADR 0009 remain useful evidence for the pinned App Server, app-owned home,
environment allowlisting, renderer isolation, and fail-closed runtime validation. Their coding
workspace, source import, command approval, file approval, diff, and patch-apply design does not
apply to this assistant. ADR 0008 remains historical evidence for the rejected nested Seatbelt
design.

This decision supersedes the coding-agent product scope of ADR 0007 and ADR 0009. No coding
workspace or reviewed source patch capability is shipped as part of the finance assistant. It also
narrowly replaces ADR 0009's rule that no finance credential reaches Agent Host: the new credential
reaches only the trusted Finance Agent Host, is a dedicated least-privilege principal, and never
reaches Codex or its subprocess environment.

## Consequences

Chelaro gains a conversational layer over existing finance data without creating a second mutation
path. Users can ask about cashflow and outstanding money, then let the assistant prepare changes
for review.

The provider receives only data selected through bounded tools, but that data may still be
sensitive. Consent, minimal outputs, ephemeral threads, and delete-local-auth controls are required
privacy measures; they are not equivalent to local-only processing.

Logout and local-data deletion remove only Chelaro's local app-owned authentication/chat state.
They retain canonical proposals and audit records and do not promise deletion of provider-side
data. The UI links to the applicable OpenAI account and retention controls.

Codex remains a trusted local control-plane dependency under ADR 0009. A compromised pinned binary
could access files available to the operating-system user even though the model-visible tool set is
restricted, and could inspect or attack same-user processes or local services. Logical environment
allowlisting does not remove that residual risk. It must be disclosed and reassessed before
packaged or wider distribution.

## References

- [OpenAI Codex App Server](https://developers.openai.com/codex/app-server)
- ADR 0003: Workbook change authority
- ADR 0005: Receivable history and agent authority
- ADR 0009: Trust the pinned Codex App Server as a local control-plane dependency
