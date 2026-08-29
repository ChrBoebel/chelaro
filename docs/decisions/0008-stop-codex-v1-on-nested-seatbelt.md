# ADR 0008: Stop Codex V1 because macOS rejects the required nested Seatbelt

## Status

Accepted — Phase 0 is blocked; Phases 1–4 must not start under ADR 0007.

## Context

ADR 0007 requires two independent boundaries for the execution App Server:

1. an outer, app-owned Seatbelt that allows the App Server to read its dedicated auth/control files; and
2. an inner Codex permission profile that lets tool processes write only the sanitized workspace and denies auth/control files, the live checkout, sibling paths, local capabilities, and network access.

The approved implementation plan makes this a hard Phase-0 gate. It explicitly forbids falling back to current-working-directory checks, application allowlists, inherited user configuration, or an unsandboxed execution App Server.

The pinned `@openai/codex` 0.149.1 CLI was tested on the only approved source-run platform: macOS 15.6 arm64. The inner named permission profile works when Codex is not already sandboxed. Real tool-process tests confirm that workspace reads/writes succeed while the following are denied:

- app-owned `CODEX_HOME`, synthetic auth data, sibling paths, the live checkout, `.env`, and `.env.local`;
- an external symlink reached through the workspace;
- TCP loopback and Unix-domain sockets;
- a synthetically populated temporary Keychain, Apple Events, pasteboard, and foreign-process inspection.

The copied pinned App Server also initializes and reads its effective configuration inside the outer Seatbelt. It cannot create a thread, because thread creation launches a filesystem helper under the inner Codex Seatbelt and macOS rejects that nested sandbox application:

```text
sandbox-exec: sandbox_apply: Operation not permitted
```

The same result occurs without any Chelaro restrictions:

```sh
/usr/bin/sandbox-exec -p '(version 1) (allow default)' \
  /usr/bin/sandbox-exec -p '(version 1) (allow default)' \
  /usr/bin/true
```

The inner command exits with status 71. This proves that loosening our outer profile cannot enable the required nested boundary. OpenAI's public issue tracker reports the same nested-Seatbelt limitation for Codex child sandboxes, including `sandbox_apply: Operation not permitted` when Codex already runs in a macOS sandbox.

## Decision

Stop the Codex V1 implementation after the reproducible Phase-0 feasibility tests. Do not implement transport, storage, workspace import/apply, desktop gateway, Next.js proxy, or UI on top of a boundary that cannot execute a Codex thread.

Do not weaken ADR 0007 by doing any of the following:

- running the execution App Server outside the outer OS sandbox;
- disabling the inner Codex tool sandbox;
- making auth/control files readable to tool descendants;
- relying on path validation, current working directory, prompts, or approval UI as the security boundary;
- accepting a user-global `CODEX_HOME` or external API key/token mode.

The already implemented protocol generation, pinned scanner, server-request policy, and feasibility tests may remain as evidence and as inputs to a future design. The visible feature flag must remain absent/off.

## Consequences

Chelaro does not expose an embedded Codex coding agent under the current architecture. Existing finance functionality remains deployable and no unsafe partial UI or gateway is shipped.

Implementation can resume only after a new reviewed ADR identifies an enforceable replacement and its own negative tests. Plausible research directions include a separately entitled and signed macOS helper, a VM/container boundary, a dedicated OS account, or a remote isolated execution service. None is authorized by the current plan, and each materially changes distribution, operations, privacy, or threat assumptions.

## Evidence

- Automated tests: `pnpm test:agent-host:isolation`
- Pinned runtime: `@openai/codex` 0.149.1
- Platform: macOS 15.6 arm64
- OpenAI issue: <https://github.com/openai/codex/issues/30615>
- Related OpenAI issue: <https://github.com/openai/codex/issues/26262>
