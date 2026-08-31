# Changelog

All notable Chelaro changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow Semantic Versioning.

## [Unreleased]

### Planned

- Automated backup and verified restore.
- Secure local credential storage.
- Reviewable OCR derivations.

## [0.2.1] - 2026-08-31

Version `0.2.1` is the first signed automatic-update proof candidate. Publication remains blocked
until the protected GitHub release environment contains the required Apple credentials and the
tag workflow passes every signing and notarization gate.

### Added

- Isolated GPT-5.6 finance-tool routing with proposal-only authority and no general-purpose tool
  access.
- A mandatory CI version gate that requires every pull request into `main` to increase the stable
  Semantic Version and keep the root, desktop, and web package versions synchronized.
- A documented `0.2.0` to `0.2.1` automatic-update verification path using synthetic data only.

### Fixed

- Natural-language receivable requests can create reviewable proposals again through the bounded
  finance tool router.
- The embedded Python API runs headlessly and no longer appears as a second macOS Dock application.

### Security

- Release publication remains fail-closed when Developer ID signing, notarization, Gatekeeper, or
  update-artifact verification is unavailable.
- Local financial data and existing consent state remain outside the replaced application bundle.

## [0.2.0] - Unpublished release candidate

Version `0.2.0` is the first update-capable bootstrap candidate. No signed binary or GitHub Release
exists until the Apple signing and notarization gate succeeds.

### Added

- Source-run Agent Host foundation with a pinned, verified Codex App Server, an allowlisted child
  environment, restrictive tool permissions, and fail-closed platform checks.
- Host-owned synthetic agent workspaces with immutable baselines and reviewable diffs.
- Reuse of the installed system Codex CLI and its existing ChatGPT login without a second Chelaro
  credential store.
- A finance-only Codex thread with exactly eight bounded tools and proposal-only mutations.
- Privacy-safe diagnostic codes and one controlled correction for malformed finance tool calls.
- A permanent public GitHub Releases provider in packaged macOS builds.
- A tag-driven workflow that signs, notarizes, verifies, checksums, and publishes the complete macOS
  update set only after the full quality gate.

### Fixed

- Packaged Next.js startup now includes the complete standalone dependency closure.
- Correctable HTTP 400/422 proposal failures no longer consume the one-proposal-per-turn budget.

### Security

- Updated the Agent Host schema validator to AJV 8.18.0, which resolves CVE-2025-69873.
- Public update clients require no GitHub or cloud credential.
- Release publication remains blocked until Developer ID signature and Apple notarization checks
  succeed.

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
