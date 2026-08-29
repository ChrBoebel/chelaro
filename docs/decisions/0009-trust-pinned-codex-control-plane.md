# ADR 0009: Trust the pinned Codex App Server as a local control-plane dependency

## Status

Accepted as control-plane evidence on 2026-08-28. ADR 0010 supersedes its coding-agent product
scope and narrowly replaces its no-finance-credential rule with a dedicated finance-assistant
principal delivered only to the trusted Host after startup. Workspace, shell, file-change, and
coding-tool decisions below are historical and do not apply to the Finance Assistant.

## Context

The original design placed the Codex App Server inside an app-owned macOS Seatbelt and expected Codex to place each tool process inside a second, stricter Seatbelt. Real tests with the pinned `@openai/codex` 0.149.1 binary on macOS 15.6 arm64 proved that macOS rejects nested Seatbelt application with exit status 71, even when both profiles use `(allow default)`.

T3 Code uses a different trust boundary: its local server starts `codex app-server` directly and lets Codex apply the sandbox selected for each thread and turn. Its browser renderer remains sandboxed, but the local server and provider process are trusted control-plane dependencies. The user explicitly approved adopting this model for Chelaro after reviewing the residual risk.

## Decision

- Treat the exact pinned, verified OpenAI Codex App Server binary as a trusted local control-plane dependency. Start it without an outer Seatbelt so it can apply the inner tool sandbox.
- Continue to resolve Codex from the exact app dependency. On the supported macOS source-run platform, verify the real binary, version, architecture, executable path, and OpenAI Developer ID signature before enabling the feature.
- Give Codex a dedicated app-owned `CODEX_HOME`. Do not load the user's global Codex home, global configuration, history, skills, plugins, hooks, MCP servers, apps, or credentials.
- Pass an allowlisted child environment. Finance API tokens, database URLs, document roots, quarantine roots, update credentials, cookies, and unrelated user environment values must never cross into Agent Host or Codex.
- Keep the Codex tool boundary deny-by-default. Tools receive only the sanitized workspace as a writable root, minimal runtime reads, no network, and explicit `.env*` denials. Permission-profile changes, additional roots, network grants, MCPs, hooks, plugins, dynamic tools, and session-wide approvals remain unavailable.
- Do not expose T3 Code's `danger-full-access` mode. Chelaro V1 has one restrictive execution mode and user review for every command or file-change request that is eligible under the capability matrix.
- Continue to treat all agent edits as non-canonical proposals. The agent never receives canonical finance data and never writes the live checkout. Import, immutable baseline, diff review, conflict detection, one-time apply authorization, and recovery remain host-owned operations.
- Keep the Electron renderer sandboxed with context isolation and no Node integration. Browser code communicates only through the authenticated local Agent Gateway.
- Keep the feature fail-closed. Any version, signature, environment, config, protocol, workspace, or sandbox self-test failure disables the Agent without degrading Chelaro's finance services.

## Residual risk

The trusted App Server runs as the same operating-system user as Chelaro. A vulnerability or malicious change in that pinned binary could therefore read files available to that user even though its tool children cannot. Environment allowlisting, separate paths, sanitized workspaces, signature/version verification, protocol validation, and a narrow upgrade process reduce this risk but do not provide an OS-enforced boundary around the App Server itself.

This is the material trade-off accepted to make the local T3-style integration feasible. It must be disclosed in setup documentation and revisited before packaged or multi-platform release.

## Rejected alternatives

- Disabling the inner Codex sandbox: exposes auth, finance data, local services, and the live checkout to model-driven tools.
- Copying T3 Code's Full Access default: conflicts with Chelaro's proposal-only invariant and deny-by-default authorization.
- Reusing the user's global `~/.codex`: imports uncontrolled configuration, tools, credentials, and histories into the product boundary.
- Copying T3 Code's entire Effect/multi-provider stack: introduces substantial unrelated architecture and dependencies. Chelaro needs a narrow Codex-only adapter over its existing generated protocol.
- VM, remote runner, dedicated OS user, or separately entitled helper: stronger isolation is possible, but each is a separate distribution and operations project outside this source-run implementation.

## Evidence required before Phase 1

- A real pinned App Server starts with the allowlisted environment and app-owned home.
- A real ephemeral thread starts successfully under the restrictive named permission profile.
- A real tool process can write the synthetic workspace but cannot read control/auth paths, the live checkout, `.env*`, external symlinks, local sockets, Keychain, Apple Events, pasteboard, foreign processes, or network endpoints.
- Effective configuration contains no configured MCPs, hooks, plugins, apps, or skills.
- The ephemeral thread leaves no resumable rollout history.
- The unsupported nested-Seatbelt test remains as regression evidence explaining the trust decision.

## References

- T3 Code architecture: <https://github.com/pingdotgg/t3code/blob/94401d01b956828eaa989ff4a80046c20d7b6088/docs/internals/overview.md>
- T3 Codex runtime: <https://github.com/pingdotgg/t3code/blob/94401d01b956828eaa989ff4a80046c20d7b6088/apps/server/src/provider/Layers/CodexSessionRuntime.ts>
- T3 permission modes: <https://github.com/pingdotgg/t3code/blob/94401d01b956828eaa989ff4a80046c20d7b6088/docs/user/permission-modes.md>
