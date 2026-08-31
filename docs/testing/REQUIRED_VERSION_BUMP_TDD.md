# Required product version bump: TDD evidence

Date: 2026-08-31

## User journeys

1. A contributor opens any pull request into `main`.
2. CI compares the root, desktop, and web product versions with the exact pull request base commit.
3. CI rejects unchanged, lower, prerelease, malformed, or unsynchronized versions.
4. CI accepts one synchronized higher stable Semantic Version and the release documentation records
   that version.
5. GitHub branch rules prevent bypassing the required check through a direct merge or force push.

## RED checkpoint

Commit: `439eed3 test(release): require version bump on main changes`

Command:

```text
node --test apps/desktop/test/release-channel.test.mjs apps/desktop/test/version-policy.test.mjs
```

Observed RED:

- product packages still reported `0.2.0` instead of `0.2.1`;
- the repository did not expose a `check:version-bump` command;
- `scripts/check-version-bump.mjs` did not exist.

## GREEN checkpoint

Commit: `a88cf6c feat(release): enforce synchronized version bumps`

Focused result:

```text
node --test apps/desktop/test/release-channel.test.mjs apps/desktop/test/version-policy.test.mjs
# 9 passed, 0 failed

pnpm check:version-bump -- main
# Product version increased from 0.2.0 to 0.2.1.
```

The implementation reads package versions from the Git object at the supplied base reference and
from the current workspace. It invokes Git without a shell, validates the reference, accepts only
stable Semantic Versions, and compares numeric version components.

## Test specification

| # | Guarantee | Type | Result |
| --- | --- | --- | --- |
| 1 | Root, desktop, and web versions remain synchronized | Unit/config | PASS |
| 2 | Unchanged and lower versions fail | Unit | PASS |
| 3 | Malformed and prerelease versions fail | Unit | PASS |
| 4 | A higher patch, minor, or major version passes | Unit | PASS |
| 5 | Missing base references fail closed | Unit/integration | PASS |
| 6 | The package-manager `--` separator selects the real base argument | Regression | PASS |
| 7 | Pull request and `main` push events run the version gate | Workflow contract | PASS |
| 8 | Repository instructions and PR checklist require matching release documentation | Policy | PASS |

## Release-candidate verification

```text
pnpm quality
# PASS

pnpm quality:agent:macos
# Agent Host: 112 passed, 0 failed
# Agent Storage: 3 passed, 0 failed

pnpm package:desktop
# PASS: Chelaro-0.2.1-arm64.dmg, ZIP, blockmaps, and latest-mac.yml
```

The packaged `0.2.1` application then passed the synthetic Finance Assistant E2E with dynamically
allocated API and Web ports. Its updater reached the public GitHub provider and correctly found no
published versions. The installed `/Applications/Chelaro.app` remained unchanged at `0.2.0`.

## Known external gate

The version and release source can be prepared without credentials. A real macOS automatic update
still requires a Developer-ID-signed baseline and release, Apple notarization credentials, and the
protected `macos-release` environment. No signing secret is present in the repository or local
keychain.

## Squash-merge evidence

Preserve these checkpoint mappings in the pull request body because GitHub squash merge creates one
new `main` commit:

- RED: `439eed3`
- GREEN: `a88cf6c`
