# ADR 0011: Reuse the user's Codex CLI and authentication

Status: Accepted · 30 August 2026

## Context

Chelaro previously bundled a Codex runtime, created an app-owned `CODEX_HOME`, and implemented a
separate ChatGPT device-code login. That produced a second account lifecycle even when Codex was
already installed and authenticated on the computer. T3 Code demonstrates the lower-friction
model: discover the user's CLI, start its App Server, and let `account/read` reflect the CLI's
existing credential store.

## Decision

- Chelaro discovers `codex` directly on the desktop-provided search path, or uses an explicitly
  configured binary path. Only absolute search directories are retained, and no shell is invoked
  to resolve or start the command.
- The production runtime is the user's installed CLI. `@openai/codex` remains a development and
  protocol-schema dependency; it is not a production fallback.
- Chelaro passes the user's normal `HOME` and `CODEX_HOME` to the App Server. It never reads,
  copies, parses, links, logs, deletes, or logs out the underlying credential store.
- Authentication is read-only: after explicit finance-data consent, Chelaro calls `account/read`.
  If no account is present, the UI instructs the user to run `codex login` and offers a status
  refresh. There is no Chelaro-owned login, logout, device code, or external-login IPC path.
- Missing, failed, and unsupported CLI installations are visible provider states. They disable
  only the assistant; the rest of Chelaro and the local finance data remain available.
- Protocol compatibility fails closed. This revision supports Codex CLI `0.151.0`; an upgrade must
  update the exact package pin, generated schemas, compatibility constant, real App Server tests,
  and security review together.
- Before thread creation, Chelaro reads the effective App Server configuration through
  `config/read`, extracts only bounded MCP server identifiers, and explicitly disables every one in
  the thread override. It does not expose or persist the configuration. This is required because an
  empty MCP table does not remove globally configured servers.
- The finance thread still has no execution environment, read-only/no-network sandboxing, disabled
  inherited MCPs/skills, exactly eight dynamic finance functions, bounded typed data, and
  proposal-only writes. ADR 0012 enables only the isolated Code Mode Host required by GPT-5.6 to
  route calls to those functions; all runtime responses and server requests remain validated.
- Source and packaged desktop modes use the same Agent Host boundary. The packaged app contains
  the Host and schemas, but not a Codex executable or credentials.

## Consequences

The user signs in once with Codex and Chelaro shares that account state without owning it. Installing
or logging into Codex after Chelaro starts is recoverable through “Status erneut prüfen”. Revoking
Chelaro's data consent stops the App Server and finance sessions but deliberately leaves the global
Codex login unchanged.

The system CLI and its same-user configuration are now part of the trusted local control plane. A
compromised compatible CLI can access files available to the OS user. Chelaro reduces model-visible
capabilities with explicit per-thread configuration and fail-closed protocol policy, but this is not
an OS security boundary around the App Server.

## Superseded scope

This ADR supersedes only the app-owned Codex home, bundled production runtime, and Chelaro-owned
device login/logout portions of ADR 0007, ADR 0009, and ADR 0010. Their finance authority,
consent, tool, renderer, transport, and proposal-only boundaries remain in force.

## Verification

- `pnpm test:agent-host`
- `pnpm check:codex-schema`
- `pnpm --filter desktop check`
- `pnpm --filter web test`
- Real local CLI smoke: provider discovery, App Server initialize, and bounded `account/read`

## References

- [T3 Code Codex provider](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/apps/server/src/provider/Layers/CodexProvider.ts)
- [T3 Code Codex session runtime](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/apps/server/src/provider/Layers/CodexSessionRuntime.ts)
- [OpenAI Codex authentication](https://learn.chatgpt.com/docs/auth)
- [OpenAI Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
