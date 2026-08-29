import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../../..");
const canonicalIconPath = path.join(repositoryRoot, "assets/brand/chelaro-icon.svg");

test("generated Chelaro web icons match the canonical brand asset", async () => {
  const canonicalIcon = await readFile(canonicalIconPath, "utf8");
  const generatedIcons = await Promise.all([
    readFile(path.join(repositoryRoot, "apps/web/src/app/icon.svg"), "utf8"),
    readFile(path.join(repositoryRoot, "apps/web/public/brand/chelaro-icon.svg"), "utf8"),
  ]);

  for (const generatedIcon of generatedIcons) {
    assert.equal(generatedIcon, canonicalIcon);
  }
});

test("desktop icon assets are generated in PNG and macOS ICNS formats", async () => {
  const pngPath = path.join(repositoryRoot, "apps/desktop/assets/icon.png");
  const icnsPath = path.join(repositoryRoot, "apps/desktop/assets/icon.icns");
  const png = await readFile(pngPath);

  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 10_000, "desktop PNG should contain a full-resolution icon");
  await access(icnsPath);
});
