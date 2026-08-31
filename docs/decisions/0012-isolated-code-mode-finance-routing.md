# ADR 0012: Enable isolated Code Mode routing for finance tools

Status: Accepted · 31 August 2026

## Context

Chelaro originally disabled the Codex Code Mode Host and exposed eight ordinary dynamic functions.
The pinned App Server correctly included those functions in a synthetic Responses-provider request,
but a real authenticated GPT-5.6 turn did not call them. A minimal live test with one harmless
`finance_ping` function reproduced the failure: GPT-5.6 reported `code-mode host is disabled` and
the Host received no `item/tool/call` request.

GPT-5.6 uses a code-mode-only tool path. Prompting it to make a direct function call cannot override
that model capability. Keeping the host disabled therefore makes every finance tool unavailable.

## Decision

- Enable only the pinned `code_mode_host` feature for finance App Server processes. Keep the thread
  without an execution environment and keep shell, unified execution, files, processes, network,
  web/browser/computer use, MCP, apps, skills, plugins, hooks, and delegation disabled.
- Register the eight finance tools as top-level dynamic functions. In GPT-5.6 Code Mode, the model
  may use one minimal JavaScript expression to call one `tools.finance_*` function and return its
  result. The router exposes no Node APIs, imports, environment variables, shell, files, processes,
  or network access.
- Treat Code Mode as transport, not authority. Every resulting `item/tool/call` still crosses the
  Finance Agent Host's exact name/schema allowlist, session/turn/call binding, consent checks,
  budgets, proposal-only API principal, and idempotency boundary.
- Continue testing the ordinary provider manifest with a deterministic Responses provider and test
  GPT-5.6 routing with a real authenticated, synthetic-data-only packaged E2E journey.
- Re-review this decision whenever the pinned Codex version, model family, Code Mode contract, or
  dynamic-tool protocol changes.

## Consequences

Natural finance requests work with the supported GPT-5.6 model while canonical writes remain behind
owner review. The isolated router adds a local runtime component and therefore expands the trusted
Codex control plane, but it does not grant the model a Chelaro execution environment or a new data
authority. A compromised same-user Codex binary remains a residual risk already accepted in ADR
0011.

## Verification

- focused RED/GREEN contract tests for the sole enabled feature;
- a real one-function GPT-5.6 smoke test yielding `item/tool/call` and `pong`;
- the full Agent Host suite and exact dynamic-tool provider manifest;
- packaged Electron E2E from conversational input through proposal review and audited approval;
- concurrent macOS LaunchServices inspection proving the embedded API helper is not a Dock app.

## References

- [OpenAI Codex App Server](https://developers.openai.com/codex/app-server)
- [OpenAI Codex repository: App Server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- ADR 0010: Finance-assistant authority boundary
- ADR 0011: System Codex CLI and shared authentication
