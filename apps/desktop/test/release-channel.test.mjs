import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { GITHUB_RELEASE_CHANNEL } from "../src/github-release-client.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(testDirectory, "..");
const repositoryRoot = path.resolve(desktopRoot, "../..");
const require = createRequire(import.meta.url);

test("the desktop client uses the reviewed public GitHub release channel", () => {
  assert.deepEqual(GITHUB_RELEASE_CHANNEL, {
    owner: "ChrBoebel",
    repository: "chelaro",
  });
});

test("free packaging creates one ad-hoc signed Apple Silicon DMG without Apple identity", () => {
  const configurationPath = require.resolve("../electron-builder.config.cjs");
  delete require.cache[configurationPath];
  const configuration = require(configurationPath);

  assert.equal(configuration.mac.identity, null);
  assert.equal(configuration.mac.hardenedRuntime, false);
  assert.equal(configuration.mac.notarize, false);
  assert.equal(typeof configuration.afterPack, "function");
  assert.deepEqual(configuration.mac.target, [{ target: "dmg", arch: ["arm64"] }]);
  assert.equal(configuration.publish, undefined);
});

test("GitHub publishes the DMG and checksum without Apple credentials", async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, ".github/workflows/release-desktop.yml"),
    "utf8",
  );

  for (const forbidden of [
    "MACOS_CERTIFICATE",
    "APPLE_API_",
    "CSC_LINK",
    "xcrun stapler",
    "latest-mac.yml",
    "*.zip.blockmap",
    "pnpm release:check --",
  ]) {
    assert.doesNotMatch(workflow, new RegExp(escapeRegex(forbidden)));
  }
  for (const required of [
    "environment: macos-release",
    "pnpm quality",
    "pnpm release:check \"$GITHUB_REF_NAME\"",
    "pnpm package:desktop",
    "codesign --verify --deep --strict",
    "Signature=adhoc",
    "hdiutil verify",
    "shasum -a 256 Chelaro-*.dmg",
    "gh release create",
    "apps/desktop/dist/*.dmg",
    "apps/desktop/dist/SHA256SUMS.txt",
    "--notes-file",
  ]) {
    assert.match(workflow, new RegExp(escapeRegex(required)));
  }
  assert.ok(
    workflow.indexOf("codesign --verify") < workflow.indexOf("gh release create") &&
      workflow.indexOf("hdiutil verify") < workflow.indexOf("gh release create"),
    "bundle and DMG verification must happen before publication",
  );
});

test("the free update release uses one synchronized higher product version", async () => {
  const packageFiles = [
    path.join(repositoryRoot, "package.json"),
    path.join(desktopRoot, "package.json"),
    path.join(repositoryRoot, "apps/web/package.json"),
  ];
  const packages = await Promise.all(packageFiles.map(async (file) =>
    JSON.parse(await readFile(file, "utf8"))
  ));

  assert.deepEqual(packages.map(({ version }) => version), ["0.3.6", "0.3.6", "0.3.6"]);
});

test("every pull request to main must increase the synchronized product version", async () => {
  const [workflow, instructions, pullRequestTemplate, rootPackage] = await Promise.all([
    readFile(path.join(repositoryRoot, ".github/workflows/ci.yml"), "utf8"),
    readFile(path.join(repositoryRoot, "AGENTS.md"), "utf8"),
    readFile(path.join(repositoryRoot, ".github/pull_request_template.md"), "utf8"),
    readFile(path.join(repositoryRoot, "package.json"), "utf8").then(JSON.parse),
  ]);

  assert.equal(rootPackage.scripts["check:version-bump"], "node scripts/check-version-bump.mjs");
  for (const required of [
    "name: Version gate",
    "fetch-depth: 0",
    "pnpm check:version-bump -- \"$VERSION_BASE\"",
    "github.event.pull_request.base.sha",
    "github.event.before",
  ]) {
    assert.match(workflow, new RegExp(escapeRegex(required)));
  }
  assert.match(instructions, /Every pull request targeting `main` must increase/);
  assert.match(instructions, /root, desktop, and web package versions synchronized/);
  assert.match(pullRequestTemplate, /product version is higher than `main`/);
});

test("the old automatic updater and S3 channel are absent", async () => {
  const [rootPackage, desktopPackage, updateManager] = await Promise.all([
    readFile(path.join(repositoryRoot, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(desktopRoot, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(desktopRoot, "src/update-manager.mjs"), "utf8"),
  ]);

  assert.equal(rootPackage.scripts["publish:desktop-update"], undefined);
  assert.equal(desktopPackage.dependencies["electron-updater"], undefined);
  assert.doesNotMatch(updateManager, /quitAndInstall|autoUpdater/);
  await assert.rejects(
    access(path.join(repositoryRoot, "scripts/publish-desktop-update.sh")),
    { code: "ENOENT" },
  );
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
