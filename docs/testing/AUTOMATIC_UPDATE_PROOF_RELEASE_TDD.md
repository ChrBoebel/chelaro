# Automatic update proof release: TDD evidence

> Historical `0.2.2` proof plan. Superseded before publication by the free manual GitHub update
> flow in [`FREE_GITHUB_UPDATE_FLOW.md`](FREE_GITHUB_UPDATE_FLOW.md).

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

## Standalone packaging regression

The first full quality run exposed `ENAMETOOLONG` warnings caused by Next tracing through pnpm's
workspace `desktop` symlink into prior `.runtime` and `dist` packages. One representative route had
110,599 traced files, including 110,376 recursive desktop artifacts.

RED commits:

- `159cbad test(web): reproduce recursive standalone tracing`
- `3cc84d0 test(web): require project-local standalone trace`
- `32941c5 test(web): require exact standalone helper target`
- `680d75a test(web): require bounded standalone completion`

The intermediate include-based fixes stayed rejected because the real build either recursed through
pnpm symlinks or omitted Next's runtime ESM target even when their focused configuration tests were
green. The final implementation removes the tracing include and performs one bounded, path-checked
post-build copy of the direct `@swc/helpers` ESM directory.

GREEN commit: `ee97b2d fix(web): complete standalone helpers without recursive tracing`

Final evidence:

```text
pnpm build:web
# PASS without ENAMETOOLONG warnings

pnpm smoke:web:standalone
# Standalone Chelaro web runtime is ready on a loopback port.

page.js.nft.json
# 115 traced files; 0 recursive desktop artifacts
```

## Test specification

| # | Guarantee | Test or command | Type | Result |
| --- | --- | --- | --- | --- |
| 1 | Root, desktop, and web identify the update target as `0.2.2` | `release-channel.test.mjs` | Unit/config | PASS |
| 2 | The update target is higher than current `main` | `pnpm check:version-bump -- main` | Integration | PASS |
| 3 | Every packaged build embeds the reviewed public GitHub provider | `release-channel.test.mjs` | Config | PASS |
| 4 | The release workflow signs and verifies before publication | `release-channel.test.mjs` | Workflow contract | PASS |
| 5 | GitHub accepts release deployments only from `v*` tags after owner approval | GitHub environment inspection | External config | PASS |
| 6 | Repeated builds cannot trace prior desktop packages recursively | `next-config.test.ts`, trace inspection | Unit/integration | PASS |
| 7 | The completed standalone runtime starts from its packaged dependency layout | `smoke:web:standalone` | Integration | PASS |
| 8 | Packaged API, Agent Host, Web, consent, proposal, approval, and audit flow work together | packaged synthetic finance-assistant scenario | E2E | PASS |
| 9 | The packaged updater uses the public GitHub channel | packaged startup update check | E2E | PASS; no release published yet |

## Full local verification

```text
pnpm quality
# PASS: API 17 passed; Web 30 passed; Desktop 29 passed; storage 3 passed

pnpm quality:agent:macos
# PASS: Agent Host 112 passed

pnpm infra:config
# PASS

pnpm release:check v0.2.2
# PASS

pnpm package:desktop
# PASS: 0.2.2 DMG, ZIP, ZIP blockmap, and latest-mac.yml
```

The packaged synthetic E2E also passed all nine result assertions, including existing Codex-login
reuse, proposal-only mutation, owner approval, and the linked audit event. The local bundle is only
ad-hoc signed and is not eligible for publication.

## Known external gap

The protected environment contains none of the five Apple secrets, and the local keychain has no
valid code-signing identity. Signed packaging, notarization, publication, and the real `0.2.1` to
`0.2.2` online update E2E therefore remain intentionally blocked.

## Squash-merge evidence

- RED: `05678f7`
- GREEN: `054a630`
- Packaging RED: `159cbad`, `3cc84d0`, `32941c5`, `680d75a`
- Packaging GREEN: `ee97b2d`
