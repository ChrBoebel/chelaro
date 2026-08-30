import { execFileSync } from "node:child_process";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { isAbsolute, delimiter, join } from "node:path";

export const SUPPORTED_CODEX_VERSION = "0.151.0";

export type CodexProviderStatus = "checking" | "ready" | "not_found" | "unsupported" | "error";

export interface CodexProviderSnapshot {
  status: CodexProviderStatus;
  version: string | null;
}

export interface CodexProviderOptions {
  binaryPath?: string;
  codexHome: string;
  home: string;
  path?: string;
}

export interface CodexProviderLaunch {
  binaryPath: string;
  codexHome: string;
  home: string;
  path: string;
  version: string;
}

export interface CodexProviderInspection {
  launch: CodexProviderLaunch | null;
  snapshot: CodexProviderSnapshot;
}

export function inspectCodexProvider(options: CodexProviderOptions): CodexProviderInspection {
  const home = absolutePath(options.home, "home");
  const codexHome = absolutePath(options.codexHome, "codexHome");
  const searchPath = validSearchPath(options.path ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  const binaryName = validBinaryName(options.binaryPath ?? "codex");
  const binaryPath = resolveExecutable(binaryName, searchPath);
  if (!binaryPath) return { launch: null, snapshot: { status: "not_found", version: null } };

  let rawVersion: string;
  try {
    rawVersion = execFileSync(binaryPath, ["--version"], {
      encoding: "utf8",
      env: {
        CODEX_HOME: codexHome,
        HOME: home,
        LANG: "C.UTF-8",
        PATH: searchPath,
      },
      timeout: 5_000,
    }).trim();
  } catch {
    return { launch: null, snapshot: { status: "error", version: null } };
  }
  const match = /^codex-cli ([0-9]+\.[0-9]+\.[0-9]+)$/.exec(rawVersion);
  if (!match) return { launch: null, snapshot: { status: "error", version: null } };
  const version = match[1]!;
  if (version !== SUPPORTED_CODEX_VERSION) {
    return { launch: null, snapshot: { status: "unsupported", version } };
  }
  return {
    launch: { binaryPath, codexHome, home, path: searchPath, version },
    snapshot: { status: "ready", version },
  };
}

function resolveExecutable(binaryPath: string, searchPath: string): string | null {
  const candidates = isAbsolute(binaryPath)
    ? [binaryPath]
    : binaryPath.includes("/")
      ? []
      : searchPath.split(delimiter).filter(Boolean).map((directory) => join(directory, binaryPath));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      const canonical = realpathSync(candidate);
      if (statSync(canonical).isFile()) return canonical;
    } catch {
      // A missing or non-executable candidate is not a provider installation.
    }
  }
  return null;
}

function absolutePath(value: string, name: string): string {
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0")) {
    throw new Error(`${name} must be an absolute path.`);
  }
  return value;
}

function validSearchPath(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 16_384 || /[\r\n\0]/.test(value)) {
    throw new Error("PATH is invalid.");
  }
  return value;
}

function validBinaryName(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096 || /[\r\n\0]/.test(value)) {
    throw new Error("Codex binary path is invalid.");
  }
  return value;
}
