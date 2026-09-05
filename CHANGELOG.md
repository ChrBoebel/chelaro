# Changelog

All notable Chelaro changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow Semantic Versioning.

## [Unreleased]

### Planned

- Automated backup and verified restore.
- Secure local credential storage.
- Reviewable OCR derivations.

## [0.6.0] - 2026-09-05

### Changed

- Rebuilt the assistant as a viewport-filling workspace inspired by BB: shared navigation and
  searchable conversation history in the sidebar, a compact thread header, and a docked composer.
- New conversations start with the first question. Model, reasoning depth, and Fast Mode live in
  the composer; bound model settings remain visible while chatting.
- Chat connections and per-conversation in-memory drafts survive navigation to other finance areas.
- Assistant answers render Markdown tables and lists without executable HTML, local links, or remote
  images. Scrolling follows new answers only while the reader stays near the end of the conversation.
- Enter sends, Shift+Enter inserts a line break, and a follow-up can be drafted while an answer runs.
  Mobile navigation uses a dismissible sidebar with keyboard focus management.

### Fixed

- Failed submissions keep the draft, duplicate submits cannot create duplicate conversations, and
  changing conversations closes the previous session before displaying another history.
- Failed streamed answers are hidden instead of remaining visible as if they were usable output.

## [0.5.2] - 2026-09-01

### Added

- Chelaro accepts a verified set of Codex releases instead of exactly one, so a Codex patch update
  no longer stops the assistant the moment it lands. `pnpm check:codex-compat --binary <path>`
  decides membership: it generates the App Server schemas from that release's own binary and proves
  that everything Chelaro sends, validates, or answers is byte-identical, and that the release sends
  no notification or server request nobody classified. The set is not a range; an unverified release
  is refused exactly as before, and ADR 0015 records the evidence.
- Every server notification the App Server can send is now classified once as handled, forbidden, or
  ignored, and a test proves the three lists cover the generated union exactly. A Codex upgrade that
  adds a notification fails the suite instead of being dropped in silence.
- `FINANCE_OS_CODEX_BINARY_PATH` is documented. It points Chelaro at a specific Codex executable, so
  the assistant can run on its own pinned copy while the global CLI stays current. It accepts a path
  and never arguments, so the App Server hardening stays in place.

## [0.5.1] - 2026-09-01

### Changed

- Chelaro now runs on Codex CLI `0.152.0`. The generated App Server schemas, the compatibility
  constant, the package pin, and the real App Server tests moved together, as ADR 0011 requires.
  Every protocol type Chelaro validates is unchanged between `0.151.0` and `0.152.0`; the release
  adds `modelProvider/authRecovery*` notifications, an `openaiForm` elicitation mode, a
  `thread/shellCommand` timeout, and two account and project fields, none of which Chelaro reads,
  sends, or accepts.

### Fixed

- The message for an unsupported Codex installation names the version the running build actually
  requires instead of a literal in the interface, which would have kept naming `0.151.0` after this
  upgrade. It now also states that consent and stored conversations survive, and shows the exact
  install command.
- A Codex CLI that cannot be started is no longer described with the login text meant for a working
  installation.

## [0.5.0] - 2026-09-01

### Added

- The finance assistant exposes model, reasoning effort, and Fast Mode. The choice is bound to the
  conversation, stored with its provider thread, and reused when the conversation is resumed.
- The chat header names the model, effort, and Fast Mode the open conversation actually runs on, and
  offers **Konfiguration ändern** to rebind it.
- The assistant shows token usage and how full the model context window is, and says when Codex has
  condensed the history. Fast Mode raises usage, which was previously invisible.
- Answers can be copied, a failed or interrupted question can be resent, and the example questions
  are now buttons that fill the input field.

### Fixed

- Reopening a conversation works. It previously failed in three separate ways: with a conflict
  until Chelaro was restarted, and — underneath that — because Chelaro checked the resumed thread
  against the shape of a started one. A real `thread/resume` carries three additional fields and
  reports the workspace it was started in, so every resume against real Codex was rejected as an
  unsafe configuration. All three are fixed and covered by tests that use the real resume shape.
- A rejected assistant action now names its reason — missing Codex login, an unavailable model, a
  running turn — instead of always suggesting a retry that could not succeed.
- An existing local database created before the explicit model selection is migrated instead of
  failing on the missing columns. The desktop schema moves to version 5.

### Changed

- Chelaro now sends the model, reasoning effort, and service tier explicitly on every thread start
  and resume instead of inheriting them from the owner's personal `~/.codex/config.toml`. Assistant
  conversations previously ran on whatever that file declared.
- The assistant offers GPT-5.6-Luna, GPT-5.5, GPT-5.4, and GPT-5.4-Mini, newest first, and new
  conversations start on the newest one at medium effort with Fast Mode off. Fast Mode maps to the
  Codex `priority` tier, which Codex describes as 1.5x speed at increased usage.

### Security

- A thread is accepted only when Codex echoes back exactly the requested model, effort, and service
  tier. The App Server accepts unknown values without an error and silently substitutes them, so the
  request alone is not evidence of the running configuration.
- GPT-5.6-Sol and GPT-5.6-Terra are not offered: they declare a `collaboration` namespace with
  `spawn_agent` and related tools at the provider edge that the pinned App Server cannot disable,
  which ADR 0010 forbids. GPT-5.6-Luna reaches the provider with the isolated Code Mode router
  only, whose own tool set is exactly the eight finance functions, so it is offered. The
  provider-edge manifest test runs once per offered model and verifies both routing paths.
- `model/rerouted` and `model/verification` notifications now abort the turn.
- The host identifier ledger now records the role each identifier was seen in. A resumed provider
  thread may reattach; the same identifier appearing as a session or turn identifier is still
  refused.

## [0.4.1] - 2026-08-31

### Fixed

- Existing `2026-08-28.v1` assistant consent no longer blocks the explicit
  `2026-08-31.v2` re-consent required by the durable conversation update.

### Security

- The prior consent record remains in the same tamper-evident hash chain, but never authorizes the
  current data notice. Only an explicit click appends the new grant; unknown or manipulated consent
  versions continue to fail closed.

## [0.4.0] - 2026-08-31

### Added

- Complete visible finance-assistant conversations now remain in Chelaro's local database and can
  be read after a renderer, API, or desktop restart.
- A responsive local conversation list supports continuation, pagination, rename-ready versioned
  resources, archiving, restoration through the API, and explicit deletion.
- Each conversation keeps one persistent Codex thread binding and resumes that exact context on a
  later Agent Host epoch.

### Changed

- The expanded consent notice explains local transcript retention, persistent Codex history,
  deletion, and the fact that revocation stops transfers without silently erasing local history.
- Assistant completion reaches the UI only after the complete validated response is durably stored.

### Security

- History excludes reasoning, stream chunks, raw tool results, and message text in audit events;
  conversation mutations retain content-free same-transaction audit records.
- Persistent threads reapply the restrictive finance contract, disable Codex goals, keep the exact
  eight-tool provider manifest, and fail closed rather than silently losing context.
- Deletion removes the bound local Codex thread before purging Chelaro's local transcript and
  runtime binding.

## [0.3.7] - 2026-08-31

### Added

- A quiet footer now shows the installed Chelaro version reported by the Electron app bundle, so
  the display automatically follows every synchronized release version without crowding the header.

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
