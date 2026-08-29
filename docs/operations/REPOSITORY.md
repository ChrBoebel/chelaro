# Repository Operations

Status target for the public Source Preview: 29 August 2026

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
| Releases | None; no signed downloads or binary artifacts |
| Dependabot alerts | Use the capabilities available on the public repository |
| Secret scanning | Use the capabilities available on the public repository |
| Required branch rules | Not required initially; no paid-plan feature is assumed |

## Operational blockers

This repository publishes source code and documentation only. It does not publish signed macOS
releases, downloads, update artifacts, or a production-ready financial application. Existing
workflow files are retained as code, but this Preview does not add CI configuration, protected
environments, or paid GitHub features and makes no remote-CI availability promise.

## Merge policy

- `main` must remain deployable.
- Branch from the current public `main`; do not develop against the archived private history.
- Use focused Conventional Commits and squash merge.
- A real test failure blocks merge.
- An infrastructure-only check failure requires a documented complete local gate.
- Database major versions, runtime majors, and compiler majors require a migration or compatibility
  plan instead of automatic merge.

Repository rules may be evaluated later. They are not a prerequisite or implied guarantee of this
Source Preview.

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
