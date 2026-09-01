import { execFileSync } from "node:child_process";
import { accessSync, constants, realpathSync } from "node:fs";

import { isSupportedCodexVersion } from "./codex-provider.js";

export const SUPPORTED_MACOS_VERSION = "15.6";
export const SUPPORTED_ARCHITECTURE = "arm64";

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
  path: string;
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

export function assertSupportedCodexBinary(binaryPath: string): CodexBinaryIdentity {
  const canonicalPath = realpathSync(binaryPath);
  accessSync(canonicalPath, constants.X_OK);

  const version = execFileSync(canonicalPath, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
  }).trim();
  const match = /^codex-cli ([0-9]+\.[0-9]+\.[0-9]+)$/.exec(version);
  if (!match || !isSupportedCodexVersion(match[1]!)) {
    throw new Error(`Unexpected Codex version: ${version}`);
  }

  return {
    path: canonicalPath,
    version: match[1]!,
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
