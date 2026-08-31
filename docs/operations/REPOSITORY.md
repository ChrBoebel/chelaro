# Repository Operations

Status target for the public Source Preview: 31 August 2026

## Source of truth

This public repository is Chelaro's only active codebase. All new work starts from its `main`
branch, uses a short-lived branch, and returns through a focused pull request. There is no active
private code mirror and no bidirectional repository synchronization.

The earlier private development history is retained as a read-only archive. Never merge, rebase,
or graft that history into this sanitized public history. If an old implementation detail must be
recovered, transfer only the smallest reviewed patch and run the current security and quality gates
before committing it here.

Internal market research, pricing hypotheses, legal assessments, and private planning belong in the
owner's knowledge vault rather than a shadow code repository. Product behavior, public decisions,
architecture, security boundaries, and contributor guidance remain documented here next to the
code.

## GitHub configuration

| Setting | Current state |
| --- | --- |
| Visibility | Public Source Preview |
| Default branch | `main` |
| Merge strategy | Squash merge only |
| Head branches | Deleted automatically after merge |
| Update branch button | Enabled |
| Auto-merge | Not required for the Source Preview |
| Issues | Enabled |
| Projects | Disabled initially |
| Discussions | Disabled initially |
| Releases | None; signed `0.2.1` bootstrap and `0.2.2` update proof sources are prepared |
| Dependabot alerts | Use the capabilities available on the public repository |
| Secret scanning | Use the capabilities available on the public repository |
| Required branch rules | `main` requires a pull request and the documented CI checks |

## Operational blockers

Normal GitHub CI is operational. The repository still publishes source code and documentation only;
it does not yet publish a signed macOS application. The protected `macos-release` environment
exists, requires owner approval, and accepts only `v*` tags, but it contains none of the required
Developer ID and App Store Connect secrets. No tag or binary publication is permitted before
signature, notarization, Gatekeeper, checksum, and update-bootstrap verification pass.

## Merge policy

- `main` must remain deployable.
- Branch from the current public `main`; do not develop against the archived private history.
- Use focused Conventional Commits and squash merge.
- Increase the synchronized stable product version in every pull request into `main`; the required
  `Version gate` check enforces this against the pull request base commit.
- Keep a matching dated changelog entry and release note for the new version.
- A real test failure blocks merge.
- An infrastructure-only check failure requires a documented complete local gate.
- Database major versions, runtime majors, and compiler majors require a migration or compatibility
  plan instead of automatic merge.

The active repository rule for `main` prevents deletion and force pushes, requires the pull request
path, and requires the `Version gate`, `Frontend`, `Backend`, and `Repository safety` checks before
merge.

## Visual repository settings

The public Source Preview includes the documented Chelaro logo, app icons, README Hero and three
synthetic-data product screenshots. Their Codex-assisted origin, hashes, visible contents,
metadata findings and usage boundary are recorded in `ASSET_PROVENANCE.md`. Any replacement or
additional visual file requires the same review before publication.

The repository homepage remains empty until an approved Chelaro domain exists and the trademark
launch gates in the Brand Platform have been completed. Do not publish a temporary URL that implies
product availability or a security posture the Preview has not reached.

## Scheduled review

Review monthly and before any future decision to publish a release:

1. Actions execution and required checks;
2. Dependabot and code-scanning alerts;
3. secret-scanning availability;
4. environment credentials and least privilege;
5. stale issues and milestones;
6. release notes, screenshots, and product claims;
7. branch and environment protection rules.
