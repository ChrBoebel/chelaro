import { lstatSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const HOST_IPC_PROTOCOL_VERSION = 1;
export const HOST_CONFIGURATION_TIMEOUT_MS = 15_000;

export interface FinanceHostInitialization {
  codexBinaryPath: string;
  codexHome: string;
  financeApiToken: string;
  financeApiUrl: string;
  gatewayToken: string;
  protocolVersion: typeof HOST_IPC_PROTOCOL_VERSION;
  requestId: string;
  type: "finance.configure";
  userHome: string;
}

export interface FinanceHostPaths {
  consentJournal: string;
  runtimeDirectory: string;
  temporaryDirectory: string;
}

export function validateFinanceHostInitialization(value: unknown): FinanceHostInitialization {
  if (!isRecord(value)) throw new HostBootstrapError("invalid_message");
  const expected = [
    "codexBinaryPath",
    "codexHome",
    "financeApiToken",
    "financeApiUrl",
    "gatewayToken",
    "protocolVersion",
    "requestId",
    "type",
    "userHome",
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
  for (const path of [value.codexHome, value.userHome]) {
    if (typeof path !== "string" || !isAbsolute(path) || path.length > 4_096 || /[\r\n\0]/.test(path)) {
      throw new HostBootstrapError("invalid_message");
    }
  }
  if (
    typeof value.codexBinaryPath !== "string" ||
    value.codexBinaryPath.length === 0 ||
    value.codexBinaryPath.length > 4_096 ||
    /[\r\n\0]/.test(value.codexBinaryPath)
  ) throw new HostBootstrapError("invalid_message");
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 12 * 1024) {
    throw new HostBootstrapError("invalid_message");
  }
  return value as unknown as FinanceHostInitialization;
}

export function prepareFinanceHostPaths(dataRoot: string): FinanceHostPaths {
  if (!isAbsolute(dataRoot)) throw new HostBootstrapError("invalid_configuration");
  const canonicalRoot = resolve(dataRoot);
  ensureOwnerDirectory(canonicalRoot);
  const paths = {
    consentJournal: join(canonicalRoot, "consent", "journal.ndjson"),
    runtimeDirectory: join(canonicalRoot, "runtime"),
    temporaryDirectory: join(canonicalRoot, "tmp"),
  };
  for (const directory of [
    dirname(paths.consentJournal),
    paths.runtimeDirectory,
    paths.temporaryDirectory,
  ]) ensureOwnerDirectory(directory);
  return paths;
}

export class HostBootstrapError extends Error {
  readonly code:
    | "invalid_configuration"
    | "invalid_message"
    | "invalid_permissions"
    ;

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
