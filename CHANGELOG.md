# Changelog

All notable Chelaro changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow Semantic Versioning.

## [Unreleased]

### Planned

- Automated backup and verified restore.
- Secure local credential storage.
- Reviewable OCR derivations.

### Added

- Source-run Agent Host foundation with a pinned, verified Codex App Server, an allowlisted child
  environment, restrictive tool permissions, and fail-closed platform checks.
- Host-owned synthetic agent workspaces with immutable baselines and reviewable diffs.

### Security

- Updated the Agent Host schema validator to AJV 8.18.0, which resolves CVE-2025-69873.

## [0.1.0] - Unpublished release candidate

This entry records an internal planning state. Version 0.1.0 has not been published, and the
public Source Preview provides no binaries or GitHub Release.

### Added

- Local-first dashboard for income, expenses, cashflow, and receivables.
- Immutable PDF, PNG, and JPEG document storage with SHA-256 content addresses.
- Versioned invoice workbook and reviewable change proposals.
- Owner and agent authorization with proposal-only agent mutations.
- PostgreSQL development runtime and embedded SQLite desktop runtime.
- Local Apple-Silicon Electron packaging code for development evaluation.
- User-controlled update-flow implementation for future evaluation.
- Audit history for canonical financial mutations.

### Security

- Same-origin browser mutation boundary and server-side API token handling.
- Sandboxed Electron renderer with context isolation and restricted navigation.
- Repository safety checks and dependency audits.

The release remains unpublished. This Source Preview does not authorize tagging,
publishing, signing, or distributing artifacts.
