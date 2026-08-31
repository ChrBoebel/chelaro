# macOS Release and Update Process

Chelaro publishes a free, ad-hoc signed Apple-Silicon DMG through the public GitHub repository. The
desktop application checks GitHub directly, announces a higher stable Semantic Version, downloads
the DMG after an explicit user action, verifies it against `SHA256SUMS.txt`, and opens it. The user
remains responsible for replacing the application in the macOS `Programme` folder.

This is intentionally not an automatic in-place updater. It requires no Apple Developer Program,
Developer-ID certificate, notarization credential, client token, paid storage, or separate update
service.

## Bootstrap boundary

Versions `0.2.x` contain the superseded Squirrel prototype and cannot discover this manual update
channel. `0.3.4` is therefore a one-time manual bootstrap: download its DMG from the GitHub Release,
independently compare its checksum, and replace the old application. From installed `0.3.4`
onward, Chelaro can announce and download a separately published higher version such as `0.3.5`.

Never represent the synthetic E2E or an installed `0.2.x` build as proof of a real cross-version
GitHub update. That proof requires both the published `0.3.4` baseline and a later immutable stable
release.

## Trust boundary

The client accepts a release only when all of these conditions hold:

- GitHub's latest-release API returns a stable, non-draft, non-prerelease tag `vX.Y.Z`;
- `X.Y.Z` is higher than the running stable version;
- the release and both assets belong to `ChrBoebel/chelaro` at their exact expected HTTPS paths;
- exactly one `Chelaro-X.Y.Z-arm64.dmg` and one `SHA256SUMS.txt` exist;
- the downloaded byte count matches GitHub's declared asset size;
- the downloaded DMG's SHA-256 digest exactly matches its single checksum entry;
- the verified DMG receives macOS quarantine metadata before it becomes available to open;
- redirects remain on GitHub-controlled download hosts.

Failed or partial downloads retain the suffix `.download` only while streaming and are removed on
every failure. Chelaro never opens an unverified download, never executes content from the release
notes, never receives a GitHub credential, and never overwrites its own application bundle.

A checksum fetched from the same GitHub release detects corruption and accidental artifact
mismatch. It does not provide Apple Developer-ID identity or notarization. A compromised repository
owner account could replace both the DMG and checksum, so repository account protection and the
reviewed tag workflow remain security controls.

## User workflow

1. Chelaro checks GitHub ten seconds after the workspace opens and every six hours thereafter.
2. A visible `Update X.Y.Z` control appears only for a newer stable release.
3. The dialog explains the manual installation and macOS warning before download.
4. The user selects **DMG herunterladen**.
5. Chelaro downloads into the user's Downloads folder and displays progress.
6. Chelaro enables **DMG öffnen** only after size, SHA-256, and macOS-quarantine checks pass.
7. The user opens the DMG, drags Chelaro to `Programme`, and confirms replacement.
8. If Gatekeeper blocks the build without Developer-ID identity, the user explicitly selects Finder right-click →
   **Öffnen**, or **Datenschutz & Sicherheit → Dennoch öffnen**.
9. The user starts Chelaro again and can confirm the new version in the macOS About panel.

Application replacement does not touch the established data path under
`~/Library/Application Support/Finance OS/`. Existing documents, proposals, audit history, Codex
login reuse, and consent state remain outside the application bundle.

## Required GitHub environment

The `macos-release` environment requires repository-owner approval and accepts only `v*` tags. It
does not require Apple or third-party storage secrets. GitHub supplies a short-lived `GITHUB_TOKEN`
to the workflow solely for creating the Release.

Never add a personal access token, Apple credential, certificate, signing file, signed URL, or
customer data to the repository or release assets.

## Version preparation

1. Select a higher stable Semantic Version. Never reuse a published version.
2. Set the same version in `package.json`, `apps/desktop/package.json`, and
   `apps/web/package.json`.
3. Add `docs/releases/vX.Y.Z.md` describing only behavior included in that version.
4. Add a matching dated `CHANGELOG.md` entry.
5. Run:

```bash
pnpm check:version-bump -- origin/main
pnpm release:check
pnpm quality
pnpm quality:agent:macos
pnpm test:e2e:finance-assistant
pnpm test:e2e:update-flow
pnpm infra:config
```

6. Build and inspect the local package:

```bash
pnpm package:desktop
version="$(node -p "require('./apps/desktop/package.json').version")"
test -d apps/desktop/dist/mac-arm64/Chelaro.app
hdiutil verify "apps/desktop/dist/Chelaro-$version-arm64.dmg"
```

Local builds are development evidence. Official release artifacts come only from the protected
tag workflow after the reviewed version commit is merged into `main`.

Every pull request into `main`, including documentation-only changes, must increase the synchronized
stable product version. The required version gate compares the branch against the pull-request base
and requires matching dated release documentation.

## Tag and publish

After the release PR is merged and CI is green:

```bash
git switch main
git pull --ff-only origin main
pnpm release:check vX.Y.Z
git tag -s vX.Y.Z -m "Chelaro vX.Y.Z"
git push origin vX.Y.Z
```

The workflow then:

1. proves the tagged commit is contained in `origin/main`;
2. proves tag, synchronized package versions, changelog, and release notes agree;
3. runs the complete repository quality gate;
4. builds the embedded API, Web, and Agent Host runtimes;
5. ad-hoc signs the complete application bundle and creates the Apple-Silicon DMG;
6. strictly verifies bundle integrity, the DMG image, and bundled application version;
7. creates `SHA256SUMS.txt` and preserves both files as workflow evidence;
8. publishes both immutable assets in one stable GitHub Release using the reviewed release note.

Do not replace files inside a published release or reuse its version. The desktop client expects
the exact asset names and will reject duplicates or mismatches.

## Post-release verification

- Confirm the Release is stable/latest and reports the expected `vX.Y.Z` tag.
- Independently compare `shasum -a 256` for the DMG with `SHA256SUMS.txt`.
- For the `0.3.4` bootstrap, install the DMG manually over the existing `0.2.x` application.
- For `0.3.5` and later, start the previous installed `0.3.x` version and confirm the update control
  announces `X.Y.Z`.
- Exercise download, verification, DMG opening, manual replacement, and Gatekeeper instructions.
- Confirm the About panel reports the new version after restart.
- Confirm existing synthetic documents, proposals, audit events, Codex login reuse, and consent
  state remain intact.
- Confirm logs, release notes, and workflow artifacts contain no financial data or secrets.

## Rollback and withdrawal

Never silently replace a published artifact or its checksum.

If a release is unsafe:

1. mark it as a prerelease or draft so it is no longer the stable latest release;
2. mark the previous known-good Release as latest to stop new announcements;
3. preserve the affected artifacts and workflow evidence for investigation;
4. publish a higher patch version containing the revert or fix.

Already installed applications do not downgrade automatically. Recovery is a higher compatible
version installed through the same manual flow. Never delete or replace the local data directory as
a rollback mechanism.

## Future signed option

If Chelaro later joins the Apple Developer Program, Developer-ID signing and notarization can be
added as a separate reviewed release change. Only then may the product reintroduce an in-place
Electron updater or claim a Gatekeeper-trusted download. The free manual workflow remains the
documented behavior until those controls exist and pass a real previous-version update test.
