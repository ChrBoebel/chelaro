import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GITLEAKS_VERSION = "8.30.1";
export const GITLEAKS_ARCHIVE_SHA256 =
  "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5";
export const GITLEAKS_ARCHIVE_URL =
  "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_darwin_arm64.tar.gz";

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const EXPECTED_ARCHIVE_ENTRIES = ["LICENSE", "README.md", "gitleaks"];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const GITLEAKS_INSTALL_ROOT = join(
  repositoryRoot,
  ".tools",
  "gitleaks",
  GITLEAKS_VERSION,
  "darwin-arm64",
);
export const GITLEAKS_BINARY = join(GITLEAKS_INSTALL_ROOT, "gitleaks");

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateArchiveEntries(entries) {
  const normalized = entries.filter(Boolean).sort();
  if (JSON.stringify(normalized) !== JSON.stringify(EXPECTED_ARCHIVE_ENTRIES)) {
    throw new Error(`Unexpected gitleaks archive entries: ${normalized.join(", ")}`);
  }
}

function requireSupportedPlatform() {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("The pinned agent-tool bundle supports only macOS arm64.");
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

export function verifyInstalledTool() {
  requireSupportedPlatform();
  for (const path of [GITLEAKS_BINARY, join(GITLEAKS_INSTALL_ROOT, "LICENSE")]) {
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      throw new Error(`Pinned agent tool is missing: ${path}`);
    }
  }
  if ((statSync(GITLEAKS_BINARY).mode & 0o111) === 0) {
    throw new Error("Pinned gitleaks binary is not executable.");
  }
  const license = readFileSync(join(GITLEAKS_INSTALL_ROOT, "LICENSE"), "utf8");
  if (!license.includes("MIT License")) {
    throw new Error("Pinned gitleaks license metadata is unexpected.");
  }
  const versionOutput = run(GITLEAKS_BINARY, ["version"]);
  if (!versionOutput.includes(GITLEAKS_VERSION)) {
    throw new Error(`Unexpected gitleaks version: ${versionOutput}`);
  }
}

async function downloadArchive() {
  const response = await fetch(GITLEAKS_ARCHIVE_URL, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Gitleaks download failed with HTTP ${response.status}.`);
  }
  const finalUrl = new URL(response.url);
  if (
    finalUrl.protocol !== "https:" ||
    !["github.com", "release-assets.githubusercontent.com"].includes(finalUrl.hostname)
  ) {
    throw new Error("Gitleaks download redirected to an unapproved origin.");
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_ARCHIVE_BYTES) {
    throw new Error("Gitleaks archive exceeds the configured size limit.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_ARCHIVE_BYTES) {
    throw new Error("Gitleaks archive has an invalid size.");
  }
  if (sha256(bytes) !== GITLEAKS_ARCHIVE_SHA256) {
    throw new Error("Gitleaks archive checksum mismatch.");
  }
  return bytes;
}

export async function installAgentTools() {
  requireSupportedPlatform();
  if (existsSync(GITLEAKS_INSTALL_ROOT)) {
    verifyInstalledTool();
    return;
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), "finance-os-agent-tools-"));
  try {
    const archivePath = join(temporaryRoot, "gitleaks.tar.gz");
    writeFileSync(archivePath, await downloadArchive(), { mode: 0o600 });
    validateArchiveEntries(run("tar", ["-tzf", archivePath]).split("\n"));

    const extractedRoot = join(temporaryRoot, "extracted");
    mkdirSync(extractedRoot, { mode: 0o700 });
    run("tar", ["-xzf", archivePath, "-C", extractedRoot]);
    for (const entry of EXPECTED_ARCHIVE_ENTRIES) {
      if (!lstatSync(join(extractedRoot, entry)).isFile()) {
        throw new Error(`Archive entry is not a regular file: ${entry}`);
      }
    }
    chmodSync(join(extractedRoot, "gitleaks"), 0o755);
    chmodSync(join(extractedRoot, "LICENSE"), 0o644);
    chmodSync(join(extractedRoot, "README.md"), 0o644);
    mkdirSync(dirname(GITLEAKS_INSTALL_ROOT), { recursive: true, mode: 0o700 });
    renameSync(extractedRoot, GITLEAKS_INSTALL_ROOT);
    verifyInstalledTool();
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const isMain = resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--check")) {
    verifyInstalledTool();
  } else {
    await installAgentTools();
  }
}
