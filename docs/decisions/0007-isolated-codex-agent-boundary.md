# ADR 0007: Isolate the Codex coding agent from canonical finance data

> Authentication, `CODEX_HOME`, and runtime discovery are superseded by ADR 0011.

## Context

Chelaro needs an embedded coding-agent chat without giving model-driven tools access to canonical finance data, original documents, application credentials, or the live source checkout. Codex App Server provides the required authentication, streamed events, and approval protocol, but its process boundary alone is not a sufficient trust boundary for this product.

The first supported runtime is the existing source-run desktop application on macOS 15.6 arm64. Packaging and other operating systems require separate isolation evidence.

## Decision

- Run a pinned Codex App Server in an Electron-managed utility process. Next.js remains a server-side proxy and never owns a long-lived Codex child process.
- Give Codex a dedicated app-owned `CODEX_HOME`; never read or inherit the user's global Codex home, configuration, skills, plugins, hooks, MCP servers, threads, or credentials.
- Authenticate only through the App Server ChatGPT device-code flow. The web UI accepts no API key.
- Import a bounded, secret-scanned snapshot into a dedicated workspace. Exclude `.git`, environment files, credentials, finance documents, generated dependencies, control files, and all canonical Chelaro storage.
- Keep immutable baseline bytes and apply-recovery data in host-only storage that Codex and its tool processes cannot read.
- Run the App Server under a versioned macOS Seatbelt profile and its tool processes under Codex `workspace-write` with network disabled. The live checkout, user home, control-plane auth files, sibling workspaces, local services, Keychain, Apple Events, pasteboard, and TCC-protected paths are denied to tools.
- Treat command and file approvals as single-request capabilities. Network, permission-profile, additional-root, session-wide, dynamic-tool, plugin, hook, MCP, and policy-amendment grants are never available.
- Keep agent output non-canonical. Applying changes to the live checkout is a distinct host-owned operation that freezes a complete revision, binds it to baseline and target bytes, shows the full diff, requires an independent one-time approval token, rechecks live hashes, and uses a durable recovery journal.
- Never let the agent commit, push, mutate the Chelaro database, or delete linked documents. Every future persistent agent mutation must emit an audit event in the same transaction.
- Enable the feature only when the runtime platform, pinned protocol, restrictive configuration, storage layout, and isolation self-tests all pass. There is no fallback to a weaker current-working-directory or path-allowlist boundary.

## Consequences

The V1 agent can analyze and edit a sanitized source snapshot, stream its work into the desktop UI, and propose a separately reviewed patch. It cannot run project builds because dependencies and network access are intentionally absent from the tool workspace.

Authentication state and temporary agent data live outside PostgreSQL and can be removed through one Electron-owned delete-all transaction. Ephemeral threads are not resumed after an agent-host epoch change.

The first release is limited to macOS 15.6 arm64 source runs. Linux, Windows, packaged desktop builds, remote access, persistent threads, richer output rendering, dependency execution, and broader permissions each require a new ADR and equivalent negative security tests.

If the pinned real CLI cannot authenticate and operate under the specified Seatbelt and inner-tool restrictions, implementation stops at the Phase-0 gate rather than weakening this decision.
