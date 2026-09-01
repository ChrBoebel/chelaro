# System Codex reuse verification

Status: Passed locally on macOS 15.6 arm64 · 30 August 2026

Branch: `feature/reuse-codex-cli-auth`

## Test-first evidence

The behavior was defined first in commit `8d1aff7` (`test(agent): define system Codex reuse
behavior`). At that checkpoint, the new provider module did not exist and the focused test build
failed as expected. The implementation then made the same contract green without weakening the
existing finance-authority boundaries.

## Automated verification

| Check | Result |
| --- | --- |
| `pnpm quality:agent:macos` plus the E2E regression rerun | Passed: Agent Storage typecheck and 3 tests; Agent Host typecheck, schema drift check, tool bootstrap check, and 107 tests |
| `pnpm --filter @finance-os/agent-host check:codex-experimental-contract` | Passed |
| `pnpm --filter web lint` | Passed with zero warnings |
| `pnpm --filter web typecheck` | Passed |
| `pnpm --filter web test` | Passed: 28 tests |
| `pnpm --filter web build` | Passed; provider refresh route present and legacy login/logout routes absent |
| `pnpm --filter desktop check` | Passed: syntax checks and 17 tests |
| `pnpm test:e2e:finance-assistant` | Passed in Electron with isolated SQLite and synthetic data: consent, streamed answer, proposal-only mutation, owner approval, and audit linkage |
| `pnpm check:safety` | Passed; no tracked financial data, local secret files, or recognized credential material |
| Production Agent Host deploy smoke | Passed; `dist/src/main.js` and Ajv present, development-only `@openai/codex` absent, deployed size approximately 13 MiB |

The repository currently has no instrumented JavaScript coverage command, so test counts are
reported rather than inventing a coverage percentage.

## Real provider smoke

The locally installed `codex-cli 0.152.0` was resolved as a direct executable and started with
`codex app-server --stdio`. The initialize response matched Chelaro's client identity and the
configured Codex home. A bounded `account/read` with `refreshToken: false` detected an existing
ChatGPT account. The diagnostic emitted only booleans and provider state; it did not print account
identity, credential paths, tokens, or configuration contents.

A second real-provider smoke, before ADR 0013 introduced durable conversations, created an
ephemeral finance thread through the running Web proxy,
streamed the exact marker `REAL_CODEX_E2E_OK` from the existing ChatGPT account, and used no finance
tool. This exposed the removed `thread/close` RPC during cleanup. A regression test now requires
`thread/unsubscribe`, its exact `{ "status": "unsubscribed" }` response is validated, and a final
real CLI smoke confirmed that the session closes successfully.

## Security regression cases

- Missing and unsupported CLIs degrade only the assistant.
- No Chelaro login, logout, device-code, credential-copy, or credential-file read path remains.
- Process startup disables hooks, plugins, bundled skills, orchestrator MCP, and other non-finance
  features before initialization.
- A real App Server test supplies a malicious global MCP configuration, reads only its bounded
  identifier, disables it in the thread override, and confirms that exactly eight finance tools
  remain visible.
- Finance prompts still run without an execution environment, network, shell, file, browser, or
  owner-write capability; mutations remain reviewable proposals.
