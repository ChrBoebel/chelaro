import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { realpathSync } from "node:fs";

import type { ServerNotification } from "../generated/codex/ts/ServerNotification.js";
import type { ServerRequest } from "../generated/codex/ts/ServerRequest.js";
import { buildFinanceInitializeParams } from "./finance-thread-contract.js";
import { assertPinnedCodexBinary, buildChildEnvironment, PINNED_CODEX_VERSION } from "./isolation.js";
import {
  JsonRpcClient,
  JsonRpcTransportError,
  type CodexNotification,
  type CodexServerRequest,
} from "./json-rpc-client.js";
import {
  ProtocolValidationError,
  validateInitializeResponse,
  validateServerNotification,
  validateServerRequest,
} from "./runtime-validator.js";

export const CODEX_SHUTDOWN_TIMEOUT_MS = 5_000;
export const CODEX_FORCE_KILL_TIMEOUT_MS = 1_000;
export const FINANCE_HOST_VERSION = "0.1.0";

export type CodexProcessStatus = "stopped" | "starting" | "ready" | "stopping" | "crashed";

export interface CodexProcessOptions {
  argumentsPrefix?: string[];
  binaryPath: string;
  codexHome: string;
  home: string;
  onFatalError: (error: Error) => void;
  onNotification: (notification: ServerNotification) => void;
  onServerRequest: (request: ServerRequest) => Promise<unknown>;
  path?: string;
  runtimeDirectory: string;
  spawnImplementation?: typeof spawn;
  temporaryDirectory: string;
  verifyBinary?: (binaryPath: string) => unknown;
}

export class CodexProcess {
  readonly #options: CodexProcessOptions;
  #child: ChildProcessWithoutNullStreams | undefined;
  #fatal = false;
  #rpc: JsonRpcClient | undefined;
  #status: CodexProcessStatus = "stopped";
  #stderrBytes = 0;

  constructor(options: CodexProcessOptions) {
    this.#options = options;
  }

  get status(): CodexProcessStatus {
    return this.#status;
  }

  get stderrByteCount(): number {
    return this.#stderrBytes;
  }

  async start(): Promise<void> {
    if (this.#status !== "stopped") {
      throw new CodexProcessError("invalid_state", "Codex App Server is already started.");
    }
    this.#status = "starting";
    this.#fatal = false;
    this.#stderrBytes = 0;
    try {
      (this.#options.verifyBinary ?? assertPinnedCodexBinary)(this.#options.binaryPath);
      const spawnImplementation = this.#options.spawnImplementation ?? spawn;
      const child = spawnImplementation(
        this.#options.binaryPath,
        [...(this.#options.argumentsPrefix ?? []), "app-server", "--stdio", "--strict-config"],
        {
          cwd: this.#options.runtimeDirectory,
          detached: true,
          env: buildChildEnvironment({
            codexHome: this.#options.codexHome,
            home: this.#options.home,
            temporaryDirectory: this.#options.temporaryDirectory,
            ...(this.#options.path === undefined ? {} : { path: this.#options.path }),
          }),
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      this.#child = child;
      child.stderr.on("data", (chunk: Buffer | string) => {
        this.#stderrBytes = Math.min(Number.MAX_SAFE_INTEGER, this.#stderrBytes + Buffer.byteLength(chunk));
      });
      child.once("error", () => {
        this.#fail(new CodexProcessError("process_failed", "Codex App Server process failed."));
      });
      child.once("exit", () => {
        if (this.#status !== "stopping" && this.#status !== "stopped") {
          this.#fail(new CodexProcessError("process_failed", "Codex App Server exited unexpectedly."));
        }
      });
      this.#rpc = new JsonRpcClient({
        input: child.stdout,
        output: child.stdin,
        onFatalError: (error) => this.#fail(error),
        onNotification: (notification) => this.#receiveNotification(notification),
        onServerRequest: (request) => this.#receiveServerRequest(request),
      });

      const initialized = await this.#rpc.request(
        "initialize",
        buildFinanceInitializeParams(FINANCE_HOST_VERSION),
      );
      validateInitializeResponse(initialized);
      if (
        realpathSync(initialized.codexHome) !== realpathSync(this.#options.codexHome) ||
        initialized.platformOs !== "macos" ||
        !initialized.userAgent.startsWith(`finance-os/${PINNED_CODEX_VERSION} `)
      ) {
        throw new ProtocolValidationError("Codex initialize identity did not match the pinned finance runtime.");
      }
      this.#status = "ready";
    } catch (error) {
      this.#fail(asError(error));
      await this.stop();
      throw new CodexProcessError("startup_failed", "Codex App Server startup failed.");
    }
  }

  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    if (this.#status !== "ready" || !this.#rpc) {
      return Promise.reject(new CodexProcessError("invalid_state", "Codex App Server is not ready."));
    }
    return timeoutMs === undefined
      ? this.#rpc.request(method, params)
      : this.#rpc.request(method, params, timeoutMs);
  }

  async stop(): Promise<void> {
    if (this.#status === "stopped") return;
    this.#status = "stopping";
    this.#rpc?.close();
    this.#rpc = undefined;
    const child = this.#child;
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
      signalProcessGroup(child, "SIGTERM");
      if (!(await resolvesWithin(closed, CODEX_SHUTDOWN_TIMEOUT_MS))) {
        signalProcessGroup(child, "SIGKILL");
        await resolvesWithin(closed, CODEX_FORCE_KILL_TIMEOUT_MS);
      }
    }
    this.#child = undefined;
    this.#status = "stopped";
  }

  async #receiveServerRequest(request: CodexServerRequest): Promise<unknown> {
    try {
      validateServerRequest(request);
      return await this.#options.onServerRequest(request as ServerRequest);
    } catch (error) {
      this.#fail(asError(error));
      throw error;
    }
  }

  #receiveNotification(notification: CodexNotification): void {
    try {
      const value = { method: notification.method, params: notification.params };
      validateServerNotification(value);
      this.#options.onNotification(value);
    } catch (error) {
      this.#fail(asError(error));
    }
  }

  #fail(error: Error): void {
    if (this.#fatal) return;
    this.#fatal = true;
    if (this.#status !== "stopping" && this.#status !== "stopped") this.#status = "crashed";
    this.#rpc?.close(
      error instanceof JsonRpcTransportError
        ? error
        : new JsonRpcTransportError("transport_failed", "Codex protocol failed."),
    );
    this.#options.onFatalError(error);
  }
}

export class CodexProcessError extends Error {
  readonly code: "invalid_state" | "process_failed" | "startup_failed";

  constructor(code: CodexProcessError["code"], message: string) {
    super(message);
    this.name = "CodexProcessError";
    this.code = code;
  }
}

function signalProcessGroup(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  try {
    if (child.pid) process.kill(-child.pid, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && ["EPERM", "ESRCH"].includes(String(error.code)))) {
      throw error;
    }
  }
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
}

async function resolvesWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const result = await Promise.race([promise.then(() => true as const), timeout]);
  clearTimeout(timer);
  return result;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Unknown Codex process failure.");
}
