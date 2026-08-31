import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const GITHUB_RELEASE_CHANNEL = Object.freeze({
  owner: "ChrBoebel",
  repository: "chelaro",
});

const API_URL = `https://api.github.com/repos/${GITHUB_RELEASE_CHANNEL.owner}/${GITHUB_RELEASE_CHANNEL.repository}/releases/latest`;
const RELEASE_PREFIX = `https://github.com/${GITHUB_RELEASE_CHANNEL.owner}/${GITHUB_RELEASE_CHANNEL.repository}/releases/`;
const MAX_CHECKSUM_BYTES = 64 * 1024;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

export function createGitHubReleaseClient({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");

  return {
    async getLatestRelease(currentVersion) {
      const response = await fetchImpl(API_URL, { headers: githubHeaders() });
      assertSuccessfulResponse(response, "GitHub release lookup");
      const payload = await response.json();
      const release = validateRelease(payload);
      return compareVersions(release.version, currentVersion) > 0 ? release : null;
    },

    async downloadRelease(release, destinationDirectory, onProgress = () => {}) {
      validateReleaseDescriptor(release);
      const expectedChecksum = await fetchExpectedChecksum(fetchImpl, release);
      const destinationPath = path.join(destinationDirectory, release.dmg.name);
      const partialPath = `${destinationPath}.download`;
      await rm(partialPath, { force: true });

      try {
        const response = await fetchImpl(release.dmg.url, { headers: githubHeaders() });
        assertSuccessfulResponse(response, "DMG download");
        assertAllowedResponseUrl(response.url);
        if (!response.body) throw new Error("The DMG response has no body.");

        const hash = createHash("sha256");
        let downloadedBytes = 0;
        const verifier = new Transform({
          transform(chunk, _encoding, callback) {
            downloadedBytes += chunk.length;
            hash.update(chunk);
            onProgress(progressPercent(downloadedBytes, release.dmg.size));
            callback(null, chunk);
          },
        });
        await pipeline(
          Readable.fromWeb(response.body),
          verifier,
          createWriteStream(partialPath, { flags: "wx", mode: 0o600 }),
        );

        if (downloadedBytes !== release.dmg.size) {
          throw new Error("The downloaded DMG size does not match the GitHub release asset.");
        }
        if (hash.digest("hex") !== expectedChecksum) {
          throw new Error("The downloaded DMG checksum does not match SHA256SUMS.txt.");
        }

        await rename(partialPath, destinationPath);
        onProgress(100);
        return destinationPath;
      } catch (error) {
        await rm(partialPath, { force: true });
        throw error;
      }
    },
  };
}

function validateRelease(payload) {
  if (!payload || typeof payload !== "object" || payload.draft || payload.prerelease) {
    throw new Error("GitHub did not return a stable Chelaro release.");
  }
  const version = parseTag(payload.tag_name);
  const pageUrl = `${RELEASE_PREFIX}tag/v${version}`;
  if (payload.html_url !== pageUrl) throw new Error("The release page URL is not trusted.");

  const dmgName = `Chelaro-${version}-arm64.dmg`;
  const dmg = findAsset(payload.assets, dmgName);
  const checksums = findAsset(payload.assets, "SHA256SUMS.txt");
  const release = {
    version,
    pageUrl,
    dmg: { name: dmgName, size: dmg.size, url: dmg.browser_download_url },
    checksumsUrl: checksums.browser_download_url,
  };
  validateReleaseDescriptor(release);
  return Object.freeze({
    ...release,
    dmg: Object.freeze(release.dmg),
  });
}

function validateReleaseDescriptor(release) {
  const expectedName = `Chelaro-${parseVersion(release?.version)}-arm64.dmg`;
  if (
    release?.dmg?.name !== expectedName ||
    !Number.isSafeInteger(release.dmg.size) ||
    release.dmg.size <= 0
  ) {
    throw new Error("The release DMG descriptor is invalid.");
  }
  assertReleaseAssetUrl(release.dmg.url, release.version, expectedName);
  assertReleaseAssetUrl(release.checksumsUrl, release.version, "SHA256SUMS.txt");
  if (release.pageUrl !== `${RELEASE_PREFIX}tag/v${release.version}`) {
    throw new Error("The release page URL is not trusted.");
  }
}

function findAsset(assets, expectedName) {
  if (!Array.isArray(assets)) throw new Error("The GitHub release has no assets.");
  const matches = assets.filter((asset) => asset?.name === expectedName);
  if (matches.length !== 1) throw new Error(`The GitHub release must contain one ${expectedName}.`);
  return matches[0];
}

async function fetchExpectedChecksum(fetchImpl, release) {
  const response = await fetchImpl(release.checksumsUrl, { headers: githubHeaders() });
  assertSuccessfulResponse(response, "checksum download");
  assertAllowedResponseUrl(response.url);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_CHECKSUM_BYTES) {
    throw new Error("SHA256SUMS.txt is unexpectedly large.");
  }
  const matches = text
    .split(/\r?\n/u)
    .map((line) => line.match(/^([a-f0-9]{64})[ \t]+\*?(.+)$/u))
    .filter((match) => match?.[2] === release.dmg.name);
  if (matches.length !== 1) {
    throw new Error(`SHA256SUMS.txt must contain one checksum for ${release.dmg.name}.`);
  }
  return matches[0][1];
}

function assertReleaseAssetUrl(value, version, assetName) {
  const expected = `${RELEASE_PREFIX}download/v${version}/${assetName}`;
  if (value !== expected) throw new Error(`The ${assetName} download URL is not trusted.`);
}

function assertAllowedResponseUrl(value) {
  if (!value) return;
  const url = new URL(value);
  if (url.protocol !== "https:" || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)) {
    throw new Error("GitHub redirected the download to an untrusted origin.");
  }
}

function assertSuccessfulResponse(response, operation) {
  if (!response?.ok) throw new Error(`${operation} failed with HTTP ${response?.status ?? "unknown"}.`);
}

function githubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "Chelaro-Desktop-Updater",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export function compareVersions(left, right) {
  const leftParts = parseVersion(left).split(".").map(Number);
  const rightParts = parseVersion(right).split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function parseTag(value) {
  if (typeof value !== "string" || !value.startsWith("v")) {
    throw new Error("The release tag is not a stable semantic version.");
  }
  return parseVersion(value.slice(1));
}

function parseVersion(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(value)) {
    throw new Error("The release version is not a stable semantic version.");
  }
  return value;
}

function progressPercent(downloadedBytes, totalBytes) {
  return Math.max(0, Math.min(99, Math.floor((downloadedBytes / totalBytes) * 100)));
}
