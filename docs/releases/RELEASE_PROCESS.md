# macOS Release and Update Process

Chelaro releases are signed promotions of a reviewed `main` commit. The public GitHub repository is
the update origin: a release contains the DMG for installation plus the ZIP, ZIP blockmap, and
`latest-mac.yml` consumed by `electron-updater`. No client-side GitHub token and no separate S3
bucket are required.

The repository is technically prepared for this process, but no release is public until the owner
configures the Apple credentials, tags a reviewed release commit, and the complete workflow passes.
A tag must never be created merely to test incomplete release configuration.

## Bootstrap boundary

An installed build without `Contents/Resources/app-update.yml` cannot discover a later release.
That applies to the existing local `0.1.0` installations. The first signed update-capable release,
`0.2.0`, therefore requires a one-time manual DMG installation.

From `0.2.0` onward, each packaged build embeds the public GitHub provider configuration. A newer
stable GitHub Release with a higher Semantic Version can then be discovered, downloaded, and
installed through Chelaro's explicit update button. Verify this boundary by publishing a higher
patch release such as `0.2.1`; republishing `0.2.0` can never test version discovery.

## Required GitHub environment

Create the protected environment `macos-release`. Restrict approvals to the repository owner and
allow deployments only from reviewed release tags on `main`.

Environment secrets:

| Name | Purpose |
| --- | --- |
| `MACOS_CERTIFICATE_P12_BASE64` | Base64-encoded Developer ID Application certificate and private key |
| `MACOS_CERTIFICATE_PASSWORD` | Password protecting the P12 archive |
| `APPLE_API_KEY_P8_BASE64` | Base64-encoded App Store Connect API key |
| `APPLE_API_KEY_ID` | App Store Connect API key identifier |
| `APPLE_API_ISSUER` | App Store Connect issuer identifier |

GitHub supplies the short-lived `GITHUB_TOKEN` used to create the Release. Do not add a personal
access token, AWS credential, update URL, signing file, or certificate to the repository. At the
time the `0.2.0` candidate was prepared, none of the five Apple secrets existed in GitHub.

## Version preparation

1. Select a higher Semantic Version. Never reuse a published version.
2. Set the same version in root `package.json`, `apps/desktop/package.json`, and
   `apps/web/package.json`.
3. Add or update `docs/releases/vX.Y.Z.md` with only behavior included in the release.
4. Add the matching `CHANGELOG.md` entry. Keep it marked as an unpublished candidate on a feature
   branch; replace that marker with `YYYY-MM-DD` only in the reviewed release PR.
5. Run:

```bash
pnpm release:check
pnpm quality
pnpm quality:agent:macos
pnpm test:e2e:finance-assistant
pnpm infra:config
```

6. Build an unsigned local package and verify the update metadata exists:

```bash
pnpm package:desktop
test -f apps/desktop/dist/mac-arm64/Chelaro.app/Contents/Resources/app-update.yml
test -f apps/desktop/dist/latest-mac.yml
test -f apps/desktop/dist/Chelaro-X.Y.Z-arm64.zip
test -f apps/desktop/dist/Chelaro-X.Y.Z-arm64.zip.blockmap
```

Local packages remain development artifacts. Only the GitHub workflow may create the signed,
notarized release candidate.

## Tag and publish

After the release PR is merged and CI is green, create the annotated release tag from that exact
`main` commit:

```bash
git switch main
git pull --ff-only origin main
pnpm release:check -- vX.Y.Z
git tag -s vX.Y.Z -m "Chelaro vX.Y.Z"
git push origin vX.Y.Z
```

The tag workflow then:

1. proves the tagged commit is contained in `origin/main`;
2. proves tag, package versions, changelog, release notes, and GitHub provider agree;
3. runs the full repository quality gate;
4. builds the embedded API, Web, and Agent Host runtimes;
5. signs with Developer ID, enables hardened runtime, notarizes, and staples the macOS artifacts;
6. verifies the signature, Gatekeeper assessment, and notarization ticket;
7. creates SHA-256 checksums and preserves workflow evidence;
8. creates the stable GitHub Release only after every prior gate passes;
9. uploads DMG, ZIP, ZIP blockmap, `latest-mac.yml`, and checksums as one atomic release set.

The workflow deliberately does not give electron-builder a GitHub publication token during the
build. Publication happens in the final explicit `gh release create` step, after verification.

## Bootstrap installation and update E2E

For `0.2.0` only:

1. download the signed DMG from the GitHub Release;
2. verify its SHA-256 checksum;
3. install it manually over the prior `0.1.0` app without touching
   `~/Library/Application Support/Finance OS/`;
4. verify `app-update.yml` exists in the installed bundle;
5. verify Chelaro starts, reuses the system Codex login, and opens the existing local database.

For the first automatic-update proof, publish a signed `0.2.1` containing only a harmless visible
release marker. From installed `0.2.0`:

1. wait for the startup update check or restart the app;
2. confirm the update button announces `0.2.1`;
3. download and install through the button;
4. confirm Chelaro restarts as `0.2.1`;
5. confirm existing documents, proposals, audit events, Codex login reuse, and consent state remain
   intact;
6. record only synthetic test evidence in the release notes.

## Post-release verification

- Confirm the Release is marked stable/latest and its version matches `latest-mac.yml`.
- Verify every checksum before installation.
- Install on a clean Apple-Silicon Mac and confirm Gatekeeper acceptance.
- Exercise the explicit update path from the previous supported release.
- Confirm update logs and workflow artifacts contain no financial data or secrets.
- Confirm original documents and the established local data path remain unchanged.

## Rollback and withdrawal

Never overwrite a published versioned artifact or silently replace its manifest.

If a release is unsafe before broad installation:

1. mark the affected Release as a prerelease or draft so it is no longer the stable latest release;
2. mark the previous known-good Release as latest to stop further promotion;
3. preserve the affected artifacts and workflow evidence for investigation;
4. publish a higher patch version containing the revert or fix.

Already updated clients do not downgrade automatically. Recovery for them is always a higher,
signed patch version with backward-compatible data handling. Never delete or replace the local data
directory as a rollback mechanism.

## Current blocker

GitHub Actions and normal CI are operational. The remaining external blocker is the absence of the
five Apple Developer ID and App Store Connect secrets listed above. Until they are configured and a
tag workflow passes signature and notarization verification, `0.2.0` remains an unpublished
bootstrap candidate and must not be represented as an available secure download.
