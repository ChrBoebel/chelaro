# Changelog

All notable Chelaro changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow Semantic Versioning.

## [Unreleased]

### Planned

- Automated backup and verified restore.
- Secure local credential storage.
- Reviewable OCR derivations.

## [0.3.6] - 2026-08-31

### Added

- The application header now shows the installed Chelaro version reported by the Electron app
  bundle, so the display automatically follows every synchronized release version.

### Fixed

- The packaged Next.js server now runs through Electron's background helper instead of launching
  the main Chelaro executable as a second foreground application with a generic `exec` Dock icon.

### Security

- The renderer receives only the non-sensitive application version through the isolated preload
  bridge; Node integration remains disabled and the existing navigation boundary is unchanged.

## [0.3.5] - 2026-08-31

### Changed

- Published a separately versioned stable target for the real in-app update journey from the
  installed, fully ad-hoc signed `0.3.4` bootstrap.

### Security

- The target retains full-bundle ad-hoc signing, strict release verification, checksum validation,
  macOS quarantine metadata, and explicit user-controlled installation.

## [0.3.4] - 2026-08-31

### Fixed

- The entire macOS application bundle, including nested helpers, frameworks, and resources, is now
  ad-hoc signed before DMG creation instead of retaining only Electron's incomplete linker signature.
- The protected release fails unless both the built app and the app inside its DMG satisfy strict,
  deep code-integrity verification.

### Changed

- `0.3.4` replaces withdrawn `0.3.2` as the one-time manual bootstrap; the separately versioned
  in-app update proof moves to `0.3.5`.

### Security

- Ad-hoc signing seals bundle integrity at no cost but supplies no Apple identity or notarization;
  the user must still approve the first launch through Finder's explicit right-click → Open flow.

## [0.3.3] - 2026-08-31

### Changed

- Published a separately versioned stable update target for the real `0.3.2` in-app GitHub update
  journey.
- Withdrew the release after its bootstrap bundle failed the real Gatekeeper launch test.

### Security

- The release uses the same reviewed commit, version, checksum, quarantine, protected-environment,
  and immutable-asset controls as the corrected bootstrap.

## [0.3.2] - 2026-08-31

### Fixed

- Verified update DMGs now receive an explicit macOS `com.apple.quarantine` attribute before they
  become visible in Downloads, preserving the expected Gatekeeper boundary for Node-based downloads.
- A failed quarantine operation removes the temporary DMG and prevents the app from opening it.

### Changed

- `0.3.2` replaces withdrawn `0.3.1` as the one-time manual bootstrap for the free update flow.
- The separately versioned in-app update proof moves to `0.3.3`.

### Security

- The quarantine marker is applied with `/usr/bin/xattr` through a bounded argument array, never a
  shell command, and only after byte-count and SHA-256 verification succeed.

## [0.3.1] - 2026-08-31

### Fixed

- The protected release workflow now passes its version tag to the release-readiness gate without
  an extra package-manager separator, allowing the first free DMG release to complete.

### Changed

- `0.3.1` was withdrawn from the stable channel after real post-publication testing found that its
  Node download did not preserve macOS quarantine metadata.

### Security

- Publication still requires the reviewed `main` commit, synchronized versions, owner approval,
  the complete quality gate, DMG verification, and a generated SHA-256 checksum.

## [0.3.0] - Unpublished source version

### Added

- A free GitHub Release check that announces higher stable Chelaro versions without client tokens.
- An in-app manual update guide with download progress, release notes, retry states, macOS
  Gatekeeper instructions, and a verified-DMG open action.
- Exact DMG size and SHA-256 verification with rejection and cleanup of corrupt partial downloads.

### Changed

- The protected release workflow now publishes one unsigned Apple-Silicon DMG plus
  `SHA256SUMS.txt` without Apple Developer Program credentials.
- The source version was superseded before publication by `0.3.1` after a release-workflow
  argument bug was found during the pre-tag gate.
- Updates replace the application only through the user's explicit Finder action; Chelaro no longer
  invokes the unsupported unsigned Squirrel in-place updater.

### Security

- Release discovery is restricted to the fixed Chelaro GitHub repository, stable Semantic Version
  tags, exact versioned asset names, and trusted HTTPS download hosts.
- Checksum verification is documented as corruption protection, not as Apple identity or
  notarization.

## [0.2.2] - 2026-08-31

Version `0.2.2` is the dedicated automatic-update proof candidate for a signed `0.2.1` baseline.
Publication remains blocked until the five Apple signing and notarization secrets are configured.

### Added

- A separately versioned update target so the owner can verify discovery, download, installation,
  restart, and local-data continuity from signed `0.2.1`.
- A protected `macos-release` GitHub environment that requires owner approval and accepts only
  version tags matching `v*`.

### Fixed

- Standalone web packaging now copies the required SWC ESM helpers through one bounded post-build
  step, preventing pnpm workspace symlinks from recursively embedding prior desktop artifacts.

### Security

- `0.2.1` and `0.2.2` remain distinct immutable release commits and must pass the same Developer ID,
  notarization, Gatekeeper, checksum, and complete-artifact gates.
- No signing material is stored in source, local test artifacts, or release documentation.

## [0.2.1] - 2026-08-31

Version `0.2.1` is the first signed update-bootstrap candidate. Publication remains blocked
until the protected GitHub release environment contains the required Apple credentials and the
tag workflow passes every signing and notarization gate.

### Added

- Isolated GPT-5.6 finance-tool routing with proposal-only authority and no general-purpose tool
  access.
- A mandatory CI version gate that requires every pull request into `main` to increase the stable
  Semantic Version and keep the root, desktop, and web package versions synchronized.
- A documented manual `0.2.1` bootstrap and subsequent `0.2.1` to `0.2.2` automatic-update
  verification path using synthetic data only.

### Fixed

- Natural-language receivable requests can create reviewable proposals again through the bounded
  finance tool router.
- The embedded Python API runs headlessly and no longer appears as a second macOS Dock application.

### Security

- Release publication remains fail-closed when Developer ID signing, notarization, Gatekeeper, or
  update-artifact verification is unavailable.
- Local financial data and existing consent state remain outside the replaced application bundle.

## [0.2.0] - Unpublished release candidate

Version `0.2.0` was the first update-capable local prototype. It remained ad-hoc signed, was never
published, and was superseded by the signed `0.2.1` bootstrap plan.

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
