# ADR 0016: Verify Codex 0.153.3 with exact legacy deltas

Status: Accepted · 5 September 2026

## Context

The installed Codex CLI 0.153.3 was discovered correctly, but ADR 0015's verified
release set rejected it. Unlike the previous upgrade, four consumed protocol files
changed: the thread start/resume responses, turn start response, and ThreadItem type.

The new fields are optional in the JSON schemas: thread `model` and
`reasoningEffort`, and nullable agent-message `questions`. Missing fields from
0.151.0 and 0.152.0 therefore still validate. No notification or server-request
method was added. Other generated changes concern unused plugin reconciliation,
app-link configuration, and usage metadata.

## Decision

- Pin the schema generator and App Server tests to 0.153.3 and accept exactly
  0.153.3, 0.152.0, and 0.151.0.
- Amend ADR 0015's byte-identity rule only for these four reviewed file pairs.
  `codex-reviewed-legacy-surfaces.json` records the SHA-256 of both the current
  and legacy bytes. The compatibility checker accepts a pair only for the two
  measured legacy versions. Changes on either side require another review;
  there is no generic field removal, schema weakening, or version range.
- If the new thread metadata is present and non-null, require it to match the
  requested model and reasoning effort. The top-level configuration echo stays
  mandatory for all releases.
- Refuse nonempty structured questions until the UI supports their reply flow.
  Check both item notifications and items embedded in turn notifications, before
  a turn can be persisted as complete. Missing, null, or empty questions remain
  compatible with ordinary assistant messages.
- Derive generator package checks from the exact package pin to avoid maintaining
  a second version literal in each script. Keep the generated manifest and
  protocol baseline checked together.

## Verification

- Generated the strict protocol surface from the real 0.153.3, 0.152.0, and
  0.151.0 binaries; all three pass `check:codex-compat`.
- The four-model provider-edge tests pass against 0.153.3, including Code Mode's
  isolated router and exactly eight finance tools.
- Regression tests cover conflicting thread metadata, question-bearing messages
  on all four notification paths, and rejection of changed legacy/current bytes.
- Existing runtime validators, notification classification, tool round trips,
  read-only configuration, and experimental contract checks remain enabled.

## Host evidence

The local machine now reports macOS 26.6.2 arm64. The isolation evidence matrix
retains 15.6 and adds this exact version. Unlike 15.6, 26.6.2 permits nested
`sandbox-exec` calls with allow-default profiles. A restrictive profile in either
position still fails to apply with exit 71. Tests require that no temporary file
is created in either case and separately verify a direct profile's file-write
denial (exit 1). This updates the historical nesting probe; it does not change
the production sandbox design or adopt nested Seatbelt as a new boundary.

Historical ADRs describing the 15.6 observation remain accurate for that platform.
Other OS versions and architectures remain outside the measured test matrix.
