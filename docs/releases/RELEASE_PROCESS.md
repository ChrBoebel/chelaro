# macOS Release Process

> **Inactive planning document:** The public Source Preview has no release, binary
> download, signing setup, or update channel. Following this document is not authorized until the
> owner makes a separate future release decision and all listed gates are satisfied.

Chelaro releases are deliberate, signed promotions of a reviewed `main` commit. A tag must never be
created to test whether release configuration happens to work.

## Required GitHub environment

Create the protected environment `macos-release` and restrict deployments to release tags from
reviewed `main` commits.

Environment secrets:

| Name | Purpose |
| --- | --- |
| `MACOS_CERTIFICATE_P12_BASE64` | Base64-encoded Developer ID Application certificate and private key |
| `MACOS_CERTIFICATE_PASSWORD` | Password protecting the P12 archive |
| `APPLE_API_KEY_P8_BASE64` | Base64-encoded App Store Connect API key |
| `APPLE_API_KEY_ID` | Apple API key identifier |
| `APPLE_API_ISSUER` | Apple API issuer identifier |
| `UPDATE_AWS_ACCESS_KEY_ID` | Write-only update-bucket credential |
| `UPDATE_AWS_SECRET_ACCESS_KEY` | Secret for the update-bucket credential |

Environment variables:

| Name | Requirement |
| --- | --- |
| `FINANCE_OS_UPDATE_URL` | Public HTTPS base URL consumed by the desktop updater |
| `FINANCE_OS_UPDATE_BUCKET` | Private deployment bucket name |
| `FINANCE_OS_UPDATE_PREFIX` | Version channel path, normally `mac/arm64` |
| `UPDATE_AWS_REGION` | Region of the update bucket |

Use a dedicated bucket principal limited to versioned Chelaro artifacts and update metadata. Never
reuse a personal AWS credential.

## Version preparation

1. Select a Semantic Version.
2. Set the same version in root `package.json` and `apps/desktop/package.json`.
3. Move the matching `CHANGELOG.md` entry from `Release candidate` to `YYYY-MM-DD`.
4. Update `docs/releases/vX.Y.Z.md` with only shipped behavior and known limitations.
5. Run:

```bash
pnpm release:check -- vX.Y.Z
pnpm quality
pnpm infra:config
```

6. Merge the focused release PR after mandatory CI is green.

## Tag and publish

From the reviewed merge commit on `main`:

```bash
git switch main
git pull --ff-only
git tag -s vX.Y.Z -m "Chelaro vX.Y.Z"
git push origin vX.Y.Z
```

The release workflow then:

1. verifies that tag and package versions agree;
2. runs the full repository quality gate;
3. builds the embedded runtime and Apple-Silicon app;
4. signs, notarizes, staples, and verifies the app and DMG;
5. creates SHA-256 checksums;
6. uploads workflow evidence;
7. publishes versioned update artifacts before `latest-mac.yml`;
8. creates the GitHub Release with DMG, ZIP, update metadata, and checksums.

## Post-release verification

- Download the DMG from the public update origin and verify its SHA-256 checksum.
- Install on a clean Apple-Silicon Mac and confirm Gatekeeper acceptance.
- Start from the previous supported version and exercise the explicit update button.
- Verify that the existing local data path and original documents remain intact.
- Confirm that the GitHub Release and update metadata show the same version.
- Record the result in the release notes without attaching real financial data.

## Rollback

Do not overwrite a published versioned artifact. If the release is unsafe:

1. stop promotion by withholding or replacing only channel metadata with the last known-good
   version;
2. mark the GitHub Release as withdrawn and explain the affected versions;
3. preserve artifacts and logs needed for investigation without exposing secrets;
4. ship a higher patch version after validation;
5. use a tested data migration or restore path—never delete the local data directory as a fix.

## Current blocker

As of 28 August 2026, only the non-sensitive `FINANCE_OS_UPDATE_PREFIX=mac/arm64` variable is
configured. All release secrets and the URL, bucket, and region variables are still absent.
GitHub-hosted jobs also do not start because the account reports a payment/spending-limit problem.
No signed release may be published until both conditions are resolved.
