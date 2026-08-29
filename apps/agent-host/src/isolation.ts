import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync, realpathSync } from "node:fs";

export const SUPPORTED_MACOS_VERSION = "15.6";
export const SUPPORTED_ARCHITECTURE = "arm64";
export const PINNED_CODEX_VERSION = "0.149.1";
export const OPENAI_TEAM_IDENTIFIER = "2DC432GLL2";

export interface PlatformIdentity {
  platform: NodeJS.Platform;
  architecture: string;
  macosVersion: string;
}

export interface ChildEnvironmentOptions {
  codexHome: string;
  home: string;
  temporaryDirectory: string;
  path?: string;
}

export interface CodexBinaryIdentity {
  architecture: string;
  path: string;
  sha256: string;
  teamIdentifier: string;
  version: string;
}

export function readPlatformIdentity(): PlatformIdentity {
  return {
    platform: process.platform,
    architecture: process.arch,
    macosVersion: execFileSync("/usr/bin/sw_vers", ["-productVersion"], {
      encoding: "utf8",
    }).trim(),
  };
}

export function assertSupportedPlatform(identity = readPlatformIdentity()): void {
  if (
    identity.platform !== "darwin" ||
    identity.architecture !== SUPPORTED_ARCHITECTURE ||
    identity.macosVersion !== SUPPORTED_MACOS_VERSION
  ) {
    throw new Error(
      `Unsupported Codex isolation platform: ${identity.platform}/${identity.architecture}/${identity.macosVersion}; ` +
        `expected darwin/${SUPPORTED_ARCHITECTURE}/${SUPPORTED_MACOS_VERSION}`,
    );
  }
}

export function assertPinnedCodexBinary(binaryPath: string): CodexBinaryIdentity {
  assertSupportedPlatform();
  const canonicalPath = realpathSync(binaryPath);
  accessSync(canonicalPath, constants.X_OK);

  const version = execFileSync(canonicalPath, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
  }).trim();
  if (version !== `codex-cli ${PINNED_CODEX_VERSION}`) {
    throw new Error(`Unexpected Codex version: ${version}`);
  }

  const signature = spawnSync("/usr/bin/codesign", ["-dvvv", canonicalPath], {
    encoding: "utf8",
    timeout: 5_000,
  });
  const signatureDetails = `${signature.stdout ?? ""}\n${signature.stderr ?? ""}`;
  if (signature.status !== 0) {
    throw new Error(`Codex signature verification failed: ${signatureDetails.trim()}`);
  }
  for (const expected of [
    "Identifier=codex",
    `TeamIdentifier=${OPENAI_TEAM_IDENTIFIER}`,
    `Authority=Developer ID Application: OpenAI OpCo, LLC (${OPENAI_TEAM_IDENTIFIER})`,
    "Format=Mach-O thin (arm64)",
  ]) {
    if (!signatureDetails.includes(expected)) {
      throw new Error(`Codex signature is missing ${expected}`);
    }
  }

  return {
    architecture: SUPPORTED_ARCHITECTURE,
    path: canonicalPath,
    sha256: createHash("sha256").update(readFileSync(canonicalPath)).digest("hex"),
    teamIdentifier: OPENAI_TEAM_IDENTIFIER,
    version: PINNED_CODEX_VERSION,
  };
}

export function buildChildEnvironment({
  codexHome,
  home,
  temporaryDirectory,
  path = "/usr/bin:/bin:/usr/sbin:/sbin",
}: ChildEnvironmentOptions): NodeJS.ProcessEnv {
  return {
    CODEX_HOME: codexHome,
    HOME: home,
    LANG: "C.UTF-8",
    PATH: path,
    TMPDIR: temporaryDirectory,
  };
}
