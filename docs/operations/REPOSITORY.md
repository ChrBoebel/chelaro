# Repository Operations

Status target for the public Source Preview: 29 August 2026

## GitHub configuration

| Setting | Current state |
| --- | --- |
| Visibility | Public, code-only Source Preview |
| Default branch | `main` |
| Merge strategy | Squash merge only |
| Head branches | Deleted automatically after merge |
| Update branch button | Enabled |
| Auto-merge | Not required for the Source Preview |
| Issues and Projects | Enabled |
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
- Use focused Conventional Commits and squash merge.
- A real test failure blocks merge.
- An infrastructure-only check failure requires a documented complete local gate.
- Database major versions, runtime majors, and compiler majors require a migration or compatibility
  plan instead of automatic merge.

Repository rules may be evaluated later. They are not a prerequisite or implied guarantee of this
code-only Preview.

## Visual repository settings

The public code-only Source Preview intentionally has no social-preview image, logo, app icon, or
product screenshot. Do not upload an image through the GitHub repository settings until its full
origin and rights chain have been documented and the public asset register has been updated.

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
