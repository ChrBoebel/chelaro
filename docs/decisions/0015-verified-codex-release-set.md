# ADR 0015: Accept a verified set of Codex releases

Status: Accepted · 1 September 2026

## Context

ADR 0011 made the user's installed Codex CLI the production runtime and pinned compatibility to a
single release. A global `npm install -g @openai/codex` then raised the CLI from `0.151.0` to
`0.152.0` and every new assistant conversation stopped, with a message offering no way out. The
finance data, the granted consent, and the stored conversations were unaffected, but the assistant
was unusable until Chelaro shipped a new build.

Measuring the release rather than assuming the worst changed the picture. Between `0.151.0` and
`0.152.0`, every protocol type Chelaro sends or validates is byte-identical. What `0.152.0` adds
lies outside that surface: `modelProvider/authRecovery*` notifications, an `openaiForm` elicitation
mode that `initialize` already opts out of and the request policy declines regardless, a
`thread/shellCommand` timeout for a request Chelaro never sends, and two account and project fields
Chelaro never reads. The single-version pin was not what protected the boundary. The exact-key
response contracts, the provider-edge tool manifest, and the deny-by-default request policy were.

T3 Code, whose provider ADR 0011 followed, gates on no version at all: it reads the CLI version out
of the `initialize` user agent for display only and proves compatibility by completing the
handshake, treating unknown notification methods as no-ops. That tolerance suits a general coding
agent, where the user wants shell access and MCP servers. It does not transfer to a bounded finance
assistant, where an unexpected field in a thread echo may mean an unverified capability became
active. What does transfer is the separation between "the version string matches" and "the protocol
is actually compatible".

## Decision

- Chelaro accepts a **set of verified releases**, `SUPPORTED_CODEX_VERSIONS`, not a range and not a
  minimum. Anything unlisted is still refused, and the exact-key response contracts fail closed
  underneath regardless.
- `SCHEMA_CODEX_VERSION` names the single release the checked-in App Server schemas were generated
  from. It is always the newest entry in the list, and the list is ordered newest first. Every other
  accepted release is therefore older, so its notifications and server requests are a subset of what
  the checked-in schemas describe and still validate against them. Raising the CLI beyond the newest
  entry is not a list edit: it regenerates the schemas, moves the package pin and
  `SCHEMA_CODEX_VERSION`, and reruns the real App Server tests together, as ADR 0011 requires.
- A release enters the list only with evidence. `pnpm check:codex-compat -- --binary <path>` runs
  against that release's own binary and proves that every type Chelaro sends, validates, or answers
  is byte-identical to the checked-in schemas, and that the release sends no notification or server
  request method the checked-in schemas do not describe. Remaining differences are printed and
  belong in the review. The provider-edge manifest test of ADR 0010 must pass against the same
  binary. Run with no argument, the check also proves that the strict surface still covers every
  schema the runtime validator compiles, so the list cannot silently fall behind the code.
- Every server notification the pinned App Server can send is classified exactly once as handled,
  forbidden, or ignored in `finance-notification-policy.ts`. A test proves the three lists partition
  the generated union, so a Codex upgrade that adds a notification fails the suite instead of being
  dropped in silence. The forbidden list replaces a regular expression over method names.
  `modelProvider/authRecoveryStarted` and `modelProvider/authRecoveryCompleted` are classified as
  ignored: they report that the CLI refreshed provider credentials during a turn, which grants no
  capability and changes no thread configuration, and an account change that does matter arrives as
  `account/updated`, which the auth controller handles.
- The user-facing provider states carry the versions the running host accepts and name the exact
  install command. A CLI that cannot be started is described as such instead of receiving the login
  text meant for a working installation.
- `FINANCE_OS_CODEX_BINARY_PATH` is documented. It points the Agent Host at a specific `codex`
  executable, so Chelaro can run on its own pinned copy while the user's global CLI stays current.
  It accepts a path and never arguments: the `--config` hardening of the App Server is not
  overridable, unlike the launch-argument override T3 Code exposes.

## Consequences

A Codex patch release no longer stops the assistant the moment it lands, provided it was verified.
The verification is a command with a recorded outcome rather than a judgement call, and the reviewed
delta between two releases is printed rather than remembered.

The set is deliberately small and grows only by measurement. It is not a compatibility range: a
release nobody ran the check against is refused exactly as before. Because the check needs that
release's own binary, it is run by a maintainer and not in continuous integration, where only the
pinned release is available. The recorded evidence for the current list is the `0.151.0` and
`0.152.0` runs of `check:codex-compat` and the four-model provider-edge manifest test on `0.152.0`.

The notification partition adds a real maintenance obligation: a Codex upgrade now fails the test
suite until every new notification is classified. That is the intent. It replaces a regular
expression whose silence was indistinguishable from approval.

## Superseded scope

This ADR supersedes only the single-version clause of ADR 0011 -- "This revision supports Codex CLI
`0.152.0`" -- and replaces it with the verified set above. Every other boundary of ADR 0010,
ADR 0011, ADR 0012, and ADR 0013 remains in force: the eight finance tools at the provider edge, the
read-only reuse of the system Codex login, the isolated Code Mode router, and the local database as
the source of truth for the visible conversation.

## Verification

- `pnpm check:codex-compat` and `pnpm check:codex-compat -- --binary <0.151.0 binary>`
- `pnpm test:agent-host`, including the notification partition and provider-edge manifest tests
- `pnpm quality:agent:macos`
- `pnpm --filter web test`
- Real local check: `FINANCE_OS_CODEX_BINARY_PATH` pointed at a separately installed `0.152.0`
  resolved to a `ready` provider against the user's normal `CODEX_HOME`

## References

- [ADR 0010](0010-codex-powered-finance-assistant.md) · [ADR 0011](0011-reuse-system-codex-authentication.md)
- [T3 Code Codex provider](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Layers/CodexProvider.ts)
- [T3 Code Codex adapter](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Layers/CodexAdapter.ts)
- [T3 Code Codex protocol package](https://github.com/pingdotgg/t3code/tree/main/packages/effect-codex-app-server)
