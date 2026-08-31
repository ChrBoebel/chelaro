# Free GitHub Update Flow — Test Contract

## User story

As a Chelaro user, I want the app to tell me when a newer version exists and guide me through a
verified download, so I can remain current without an Apple Developer Program subscription and
without Chelaro silently replacing itself.

## Automated coverage

| Boundary | Evidence |
| --- | --- |
| Only a higher stable Semantic Version is announced | `github-release-client.test.mjs` |
| Repository, release page, asset names, and download origins are fixed | `github-release-client.test.mjs` |
| DMG byte count and SHA-256 digest must both match | `github-release-client.test.mjs` |
| Verified DMGs receive macOS quarantine metadata or are discarded | `github-release-client.test.mjs`, `macos-quarantine.test.mjs` |
| Corrupt partial files are removed and never opened | `github-release-client.test.mjs`, `update-manager.test.mjs` |
| Update IPC accepts only the active renderer | `update-manager.test.mjs` |
| User sees instructions, progress, verified state, errors, and retry | `desktop-update-button.test.tsx` |
| Release requires no Apple secrets and publishes only DMG plus checksum | `release-channel.test.mjs` |
| Complete app bundle is ad-hoc signed and strictly verified before publication | `adhoc-sign-macos.test.mjs`, `release-channel.test.mjs` |
| Root, desktop, and web versions remain synchronized | `release-channel.test.mjs`, version gate |

## Package and application E2E

Before publishing `v0.3.4`:

1. run the full quality, packaged Finance Assistant E2E, infrastructure gates, and
   `pnpm test:e2e:update-flow` for the isolated Electron update journey;
2. package the real ARM64 DMG and verify it with `hdiutil verify`;
3. inspect the bundled `CFBundleShortVersionString`;
4. ad-hoc sign the complete app bundle and require strict, deep verification;
5. publish only from the protected tag workflow;
6. verify a real client download receives `com.apple.quarantine`;
7. confirm a corrupted synthetic test download cannot reach the DMG-open action;
8. manually install the `v0.3.4` bootstrap over an existing `0.2.x` test installation;
9. confirm Finder right-click → Open permits the explicit first launch;
10. manually replace the app and verify version and synthetic-data continuity;
11. publish a separately versioned stable follow-up and verify discovery from installed `0.3.4`.

The final cross-version GitHub download cannot run before the stable release exists. Its checklist
therefore remains an explicit post-publication E2E gate rather than being simulated as production
evidence.
