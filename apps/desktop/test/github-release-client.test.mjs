import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  compareVersions,
  createGitHubReleaseClient,
} from "../src/github-release-client.mjs";

const payload = Buffer.from("synthetic Chelaro installer");
const checksum = createHash("sha256").update(payload).digest("hex");

function releaseResponse({ version = "0.3.0", assets = releaseAssets(version) } = {}) {
  return jsonResponse({
    tag_name: `v${version}`,
    html_url: `https://github.com/ChrBoebel/chelaro/releases/tag/v${version}`,
    draft: false,
    prerelease: false,
    assets,
  });
}

function releaseAssets(version) {
  return [
    {
      name: `Chelaro-${version}-arm64.dmg`,
      size: payload.length,
      browser_download_url: `https://github.com/ChrBoebel/chelaro/releases/download/v${version}/Chelaro-${version}-arm64.dmg`,
    },
    {
      name: "SHA256SUMS.txt",
      size: 100,
      browser_download_url: `https://github.com/ChrBoebel/chelaro/releases/download/v${version}/SHA256SUMS.txt`,
    },
  ];
}

function jsonResponse(value) {
  return { ok: true, status: 200, json: async () => value };
}

test("stable GitHub releases are announced only when their version is newer", async () => {
  const client = createGitHubReleaseClient({ fetchImpl: async () => releaseResponse() });

  assert.equal((await client.getLatestRelease("0.2.2")).version, "0.3.0");
  assert.equal(await client.getLatestRelease("0.3.0"), null);
  assert.equal(compareVersions("0.3.0", "0.2.9"), 1);
});

test("release discovery rejects prereleases and unexpected asset URLs", async () => {
  const prereleaseClient = createGitHubReleaseClient({
    fetchImpl: async () => jsonResponse({ prerelease: true, draft: false }),
  });
  await assert.rejects(() => prereleaseClient.getLatestRelease("0.2.2"), /stable Chelaro release/);

  const assets = releaseAssets("0.3.0");
  assets[0].browser_download_url = "https://example.com/Chelaro-0.3.0-arm64.dmg";
  const untrustedClient = createGitHubReleaseClient({
    fetchImpl: async () => releaseResponse({ assets }),
  });
  await assert.rejects(() => untrustedClient.getLatestRelease("0.2.2"), /not trusted/);
});

test("DMG downloads are kept only after their published checksum and size match", async () => {
  const destination = await mkdtemp(path.join(os.tmpdir(), "chelaro-update-test-"));
  const responses = [
    releaseResponse(),
    new Response(`${checksum}  Chelaro-0.3.0-arm64.dmg\n`),
    new Response(payload),
  ];
  const client = createGitHubReleaseClient({ fetchImpl: async () => responses.shift() });
  const release = await client.getLatestRelease("0.2.2");
  const progress = [];

  const installerPath = await client.downloadRelease(release, destination, (value) => {
    progress.push(value);
  });

  assert.equal(installerPath, path.join(destination, "Chelaro-0.3.0-arm64.dmg"));
  assert.deepEqual(await readFile(installerPath), payload);
  assert.equal(progress.at(-1), 100);
});

test("a corrupt DMG is rejected and its partial download is removed", async () => {
  const destination = await mkdtemp(path.join(os.tmpdir(), "chelaro-update-test-"));
  const corruptPayload = Buffer.from("corrupt payload with same byte size").subarray(0, payload.length);
  const responses = [
    releaseResponse(),
    new Response(`${checksum}  Chelaro-0.3.0-arm64.dmg\n`),
    new Response(corruptPayload),
  ];
  const client = createGitHubReleaseClient({ fetchImpl: async () => responses.shift() });
  const release = await client.getLatestRelease("0.2.2");

  await assert.rejects(
    () => client.downloadRelease(release, destination),
    /checksum does not match/,
  );
  await assert.rejects(
    readFile(path.join(destination, "Chelaro-0.3.0-arm64.dmg.download")),
    { code: "ENOENT" },
  );
});
