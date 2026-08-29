import { constants, closeSync, fstatSync, fsyncSync, ftruncateSync, lstatSync, mkdirSync, openSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const HOST_IPC_PROTOCOL_VERSION = 1;
export const HOST_CONFIGURATION_TIMEOUT_MS = 15_000;

export interface FinanceHostInitialization {
  financeApiToken: string;
  financeApiUrl: string;
  gatewayToken: string;
  protocolVersion: typeof HOST_IPC_PROTOCOL_VERSION;
  requestId: string;
  type: "finance.configure";
}

export interface FinanceHostPaths {
  codexHome: string;
  consentJournal: string;
  home: string;
  runtimeDirectory: string;
  temporaryDirectory: string;
}

export function validateFinanceHostInitialization(value: unknown): FinanceHostInitialization {
  if (!isRecord(value)) throw new HostBootstrapError("invalid_message");
  const expected = [
    "financeApiToken",
    "financeApiUrl",
    "gatewayToken",
    "protocolVersion",
    "requestId",
    "type",
  ].sort();
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)) {
    throw new HostBootstrapError("invalid_message");
  }
  if (
    value.type !== "finance.configure" ||
    value.protocolVersion !== HOST_IPC_PROTOCOL_VERSION ||
    typeof value.requestId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value.requestId) ||
    typeof value.financeApiToken !== "string" ||
    value.financeApiToken.length < 16 ||
    value.financeApiToken.length > 512 ||
    /[\r\n]/.test(value.financeApiToken) ||
    typeof value.gatewayToken !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.gatewayToken) ||
    !validApiUrl(value.financeApiUrl)
  ) {
    throw new HostBootstrapError("invalid_message");
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 2048) {
    throw new HostBootstrapError("invalid_message");
  }
  return value as unknown as FinanceHostInitialization;
}

export function prepareFinanceHostPaths(dataRoot: string): FinanceHostPaths {
  if (!isAbsolute(dataRoot)) throw new HostBootstrapError("invalid_configuration");
  const canonicalRoot = resolve(dataRoot);
  ensureOwnerDirectory(canonicalRoot);
  const paths = {
    codexHome: join(canonicalRoot, "codex-home"),
    consentJournal: join(canonicalRoot, "consent", "journal.ndjson"),
    home: join(canonicalRoot, "empty-home"),
    runtimeDirectory: join(canonicalRoot, "runtime"),
    temporaryDirectory: join(canonicalRoot, "tmp"),
  };
  for (const directory of [
    paths.codexHome,
    dirname(paths.consentJournal),
    paths.home,
    paths.runtimeDirectory,
    paths.temporaryDirectory,
  ]) ensureOwnerDirectory(directory);
  writeSecureFile(
    join(paths.codexHome, "config.toml"),
    Buffer.from("[analytics]\nenabled = false\n", "utf8"),
  );
  return paths;
}

export function resolvePinnedCodexExecutable(): string {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new HostBootstrapError("unsupported_platform");
  }
  const localRequire = createRequire(import.meta.url);
  let packagePath: string;
  try {
    const codexPackage = localRequire.resolve("@openai/codex/package.json");
    packagePath = createRequire(codexPackage).resolve("@openai/codex-darwin-arm64/package.json");
  } catch {
    throw new HostBootstrapError("missing_codex_runtime");
  }
  const binary = join(dirname(packagePath), "vendor", "aarch64-apple-darwin", "bin", "codex");
  const stats = lstatSync(binary);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new HostBootstrapError("missing_codex_runtime");
  return binary;
}

export class HostBootstrapError extends Error {
  readonly code:
    | "invalid_configuration"
    | "invalid_message"
    | "invalid_permissions"
    | "missing_codex_runtime"
    | "unsupported_platform";

  constructor(code: HostBootstrapError["code"]) {
    super("Finance host bootstrap failed.");
    this.name = "HostBootstrapError";
    this.code = code;
  }
}

function ensureOwnerDirectory(path: string): void {
  try {
    mkdirSync(path, { mode: 0o700, recursive: true });
    const stats = lstatSync(path);
    const uid = typeof process.getuid === "function" ? process.getuid() : stats.uid;
    if (!stats.isDirectory() || stats.isSymbolicLink() || stats.uid !== uid || (stats.mode & 0o077) !== 0) {
      throw new HostBootstrapError("invalid_permissions");
    }
  } catch (error) {
    if (error instanceof HostBootstrapError) throw error;
    throw new HostBootstrapError("invalid_configuration");
  }
}

function writeSecureFile(path: string, bytes: Buffer): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    const stats = fstatSync(descriptor);
    const uid = typeof process.getuid === "function" ? process.getuid() : stats.uid;
    if (!stats.isFile() || stats.nlink !== 1 || stats.uid !== uid || (stats.mode & 0o077) !== 0) {
      throw new HostBootstrapError("invalid_permissions");
    }
    ftruncateSync(descriptor, 0);
    const written = writeSync(descriptor, bytes, 0, bytes.length, 0);
    if (written !== bytes.length) throw new HostBootstrapError("invalid_configuration");
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validApiUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.port !== "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
