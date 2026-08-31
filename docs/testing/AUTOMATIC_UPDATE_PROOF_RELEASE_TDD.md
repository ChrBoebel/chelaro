# Automatic update proof release: TDD evidence

Date: 2026-08-31

## User journeys

1. The owner installs a Developer-ID-signed `0.2.1` bootstrap once from its verified DMG.
2. Chelaro `0.2.1` discovers the separately published stable `0.2.2` release.
3. The owner explicitly downloads and installs `0.2.2`, then verifies the version after restart.
4. Existing local data, audit history, Codex login reuse, and consent state remain intact.
5. A release operator cannot publish from a non-version tag or without owner approval and all Apple
   credentials.

## RED checkpoint

Commit: `05678f7 test(release): require separate 0.2.2 update proof`

Command:

```text
node --test apps/desktop/test/release-channel.test.mjs
```

Observed RED: one focused assertion expected synchronized `0.2.2`, while root, desktop, and web
correctly remained at `0.2.1`. Five unrelated release-channel guarantees stayed green.

## GREEN checkpoint

Commit: `054a630 chore(release): prepare 0.2.2 update target`

```text
node --test apps/desktop/test/release-channel.test.mjs
# 6 passed, 0 failed

pnpm check:version-bump -- main
# Product version increased from 0.2.1 to 0.2.2.
```

## Test specification

| # | Guarantee | Test or command | Type | Result |
| --- | --- | --- | --- | --- |
| 1 | Root, desktop, and web identify the update target as `0.2.2` | `release-channel.test.mjs` | Unit/config | PASS |
| 2 | The update target is higher than current `main` | `pnpm check:version-bump -- main` | Integration | PASS |
| 3 | Every packaged build embeds the reviewed public GitHub provider | `release-channel.test.mjs` | Config | PASS |
| 4 | The release workflow signs and verifies before publication | `release-channel.test.mjs` | Workflow contract | PASS |
| 5 | GitHub accepts release deployments only from `v*` tags after owner approval | GitHub environment inspection | External config | PASS |

## Known external gap

The protected environment contains none of the five Apple secrets, and the local keychain has no
valid code-signing identity. Signed packaging, notarization, publication, and the real `0.2.1` to
`0.2.2` online update E2E therefore remain intentionally blocked.

## Squash-merge evidence

- RED: `05678f7`
- GREEN: `054a630`
