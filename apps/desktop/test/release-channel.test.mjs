import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(testDirectory, "..");
const repositoryRoot = path.resolve(desktopRoot, "../..");
const require = createRequire(import.meta.url);

test("every packaged desktop build embeds the public GitHub update provider", () => {
  delete process.env.FINANCE_OS_UPDATE_URL;
  const configuration = require("../electron-builder.config.cjs");

  assert.deepEqual(configuration.publish, [{
    provider: "github",
    owner: "ChrBoebel",
    repo: "chelaro",
    releaseType: "release",
  }]);
  assert.deepEqual(configuration.mac.target, [
    { target: "dmg", arch: ["arm64"] },
    { target: "zip", arch: ["arm64"] },
  ]);
});

test("desktop release publishes the complete macOS update set without AWS", async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, ".github/workflows/release-desktop.yml"),
    "utf8",
  );

  for (const forbidden of [
    "FINANCE_OS_UPDATE_URL",
    "FINANCE_OS_UPDATE_BUCKET",
    "UPDATE_AWS_ACCESS_KEY_ID",
    "UPDATE_AWS_SECRET_ACCESS_KEY",
    "aws s3",
    "publish-desktop-update.sh",
  ]) {
    assert.doesNotMatch(workflow, new RegExp(forbidden));
  }
  for (const required of [
    "environment: macos-release",
    "pnpm quality",
    "pnpm package:desktop",
    "codesign --verify --deep --strict",
    "xcrun stapler validate",
    "gh release create",
    "apps/desktop/dist/*.dmg",
    "apps/desktop/dist/*.zip",
    "apps/desktop/dist/*.zip.blockmap",
    "apps/desktop/dist/latest-mac.yml",
    "apps/desktop/dist/SHA256SUMS.txt",
  ]) {
    assert.match(workflow, new RegExp(escapeRegex(required)));
  }
  assert.ok(
    workflow.indexOf("codesign --verify") < workflow.indexOf("gh release create"),
    "signature verification must happen before publication",
  );
});

test("the update bootstrap uses one synchronized product version", async () => {
  const packageFiles = [
    path.join(repositoryRoot, "package.json"),
    path.join(desktopRoot, "package.json"),
    path.join(repositoryRoot, "apps/web/package.json"),
  ];
  const packages = await Promise.all(packageFiles.map(async (file) =>
    JSON.parse(await readFile(file, "utf8"))
  ));

  assert.deepEqual(packages.map(({ version }) => version), ["0.2.0", "0.2.0", "0.2.0"]);
});

test("the GitHub channel has no legacy S3 publishing entry point", async () => {
  const rootPackage = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));

  assert.equal(rootPackage.scripts["publish:desktop-update"], undefined);
  await assert.rejects(
    access(path.join(repositoryRoot, "scripts/publish-desktop-update.sh")),
    { code: "ENOENT" },
  );
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
