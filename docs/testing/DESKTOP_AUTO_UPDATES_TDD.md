# Desktop auto-updates: TDD evidence

Date: 2026-08-30

## Source and user journeys

No separate plan file was provided. The journeys were derived from the request and the installed
`0.1.0` bootstrap limitation.

1. As the owner, I want every packaged Chelaro build to know the public GitHub update origin so a
   later version can be discovered without app credentials.
2. As the release operator, I want one signed GitHub Release workflow so update metadata and
   installers cannot diverge across GitHub and a second storage service.
3. As an existing `0.1.0` user, I want a documented one-time bootstrap to `0.2.0`, after which the
   explicit update button can install higher versions without changing local financial data.
4. As the release operator, I want publication to fail closed unless versions, provenance,
   signatures, notarization, checksums, and update artifacts are complete.

## RED checkpoints

### GitHub update provider

Commit: `188f929 test(desktop): specify GitHub update release channel`

Command:

```text
node --test apps/desktop/test/release-channel.test.mjs
```

Observed RED:

- electron-builder returned `publish: null` when no external update URL was injected;
- the release workflow still required the generic URL, S3 bucket, AWS credentials, and legacy
  publishing script.

### Bootstrap version and single publisher

Commit: `c07a107 test(release): specify update bootstrap version`

The same test target then proved a second RED state:

- root, desktop, and web versions were still `0.1.0`;
- the legacy S3 publishing command and script still existed.

## GREEN checkpoints

### Public GitHub Releases channel

Commit: `1db29f0 feat(desktop): publish updates through GitHub Releases`

The focused tests passed after every package received this provider:

```text
provider: github
owner: ChrBoebel
repo: chelaro
releaseType: release
```

The workflow no longer contains AWS or generic update-origin configuration. Its final publication
set contains DMG, ZIP, ZIP blockmap, `latest-mac.yml`, and checksums, and publication occurs only
after quality, signature, Gatekeeper, and notarization checks.

### `0.2.0` update bootstrap

Commit: `29ad80b chore(release): prepare update bootstrap version 0.2.0`

The focused tests passed after all three product packages used `0.2.0` and the legacy S3 entry point
was removed.

## Test specification

| # | Guarantee | Test or command | Type | Result |
| --- | --- | --- | --- | --- |
| 1 | Packaging embeds the exact public GitHub provider without an environment URL | `release-channel.test.mjs` | Unit/config | PASS |
| 2 | Production packaging enables hardened runtime, entitlements, signing discovery, and notarization | `release-channel.test.mjs` | Security/config | PASS |
| 3 | Workflow has no AWS/S3 path and publishes the complete macOS update set after verification | `release-channel.test.mjs` | Workflow contract | PASS |
| 4 | Root, desktop, and web use bootstrap version `0.2.0` | `release-channel.test.mjs` | Release contract | PASS |
| 5 | Legacy S3 command and script are absent | `release-channel.test.mjs` | Configuration GC | PASS |
| 6 | Release notes, changelog, versions, icons, safety scan, and GitHub provider agree | `pnpm release:check` | Integration | PASS |
| 7 | Real packaging creates `app-update.yml`, `latest-mac.yml`, DMG, ZIP, and ZIP blockmap | `pnpm package:desktop` plus artifact assertions | Packaging E2E | PASS |
| 8 | The ZIP contains `Chelaro.app/Contents/Resources/app-update.yml` | `unzip -l` artifact assertion | Packaging E2E | PASS |
| 9 | Existing updater IPC remains explicit, trusted-renderer-only, and stops local services before install | `pnpm quality:desktop` | Unit/integration | PASS |
| 10 | Repository lint, types, tests, builds, audits, and safety gates remain green | `pnpm quality` | Full regression | PASS |
| 11 | Real pinned Codex App Server and finance boundary remain green | `pnpm quality:agent:macos` | Contract/integration | PASS |

## Coverage

Command:

```text
node --test --experimental-test-coverage apps/desktop/test/release-channel.test.mjs
```

Result for `electron-builder.config.cjs`:

- lines: 100%
- branches: 100%
- functions: 100%

## Packaging evidence

The unsigned local `0.2.0` package produced:

- `Chelaro-0.2.0-arm64.dmg`;
- `Chelaro-0.2.0-arm64.zip`;
- `Chelaro-0.2.0-arm64.zip.blockmap`;
- `latest-mac.yml` with version `0.2.0` and the ZIP as the primary update path;
- an embedded `app-update.yml` with the public GitHub provider.

These local artifacts are verification output only and are not a secure distributable release.

## Full quality results

- `pnpm quality`: PASS
  - API: 17 passed, 21 environment-dependent PostgreSQL tests skipped;
  - Web: 12 files and 28 tests passed;
  - Desktop: 21 tests passed at that checkpoint;
  - dependency audits and repository safety: PASS.
- `pnpm quality:agent:macos`: PASS
  - Agent Host: 112 tests passed;
  - Agent Storage: 3 tests passed.

## Known gaps and external gates

- A real signed online update cannot be exercised until the five Apple Developer ID and App Store
  Connect secrets are configured and stable `0.2.0` plus a higher patch release exist.
- The existing source Electron finance E2E was attempted but did not start because loopback port
  `8000` was occupied by an unrelated local development service. That service was not stopped.
  No Chelaro assertion failed in this attempt.
- The release workflow itself must still pass on the protected GitHub macOS runner before a tag may
  be represented as an available release.

## Merge evidence

If GitHub later squash-merges this branch, preserve these checkpoint mappings in the PR body:

- RED provider/workflow: `188f929`
- GREEN provider/workflow: `1db29f0`
- RED version/single publisher: `c07a107`
- GREEN version/single publisher: `29ad80b`
