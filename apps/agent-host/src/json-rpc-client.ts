import type { Readable, Writable } from "node:stream";
import { once } from "node:events";

import { JsonLineFramer, MAX_CODEX_FRAME_BYTES } from "./jsonl-framer.js";

export const MAX_PENDING_CODEX_REQUESTS = 64;
export const DEFAULT_CODEX_REQUEST_TIMEOUT_MS = 15_000;

type RpcId = number;

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
  timer: NodeJS.Timeout;
}

export interface CodexServerRequest {
  id: RpcId;
  method: string;
  params: unknown;
}

export interface CodexNotification {
  emittedAtMs?: number;
  method: string;
  params: unknown;
}

export class JsonRpcServerRequestError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "JsonRpcServerRequestError";
    this.code = code;
  }
}

export class JsonRpcDeferredServerResponse {
  readonly afterResponse: () => Promise<void> | void;
  readonly result: unknown;

  constructor(result: unknown, afterResponse: () => Promise<void> | void) {
    this.result = result;
    this.afterResponse = afterResponse;
  }
}

export class JsonRpcDeferredServerError {
  readonly afterResponse: () => Promise<void> | void;
  readonly error: JsonRpcServerRequestError;

  constructor(error: JsonRpcServerRequestError, afterResponse: () => Promise<void> | void) {
    this.error = error;
    this.afterResponse = afterResponse;
  }
}

export interface JsonRpcClientOptions {
  defaultTimeoutMs?: number;
  input: Readable;
  maxFrameBytes?: number;
  maxPendingRequests?: number;
  onFatalError?: (error: JsonRpcTransportError) => void;
  onNotification: (notification: CodexNotification) => void;
  onServerRequest: (request: CodexServerRequest) => Promise<unknown>;
  output: Writable;
}

export class JsonRpcTransportError extends Error {
  readonly code:
    | "closed"
    | "frame_too_large"
    | "invalid_frame"
    | "operation_timed_out"
    | "queue_full"
    | "transport_failed";

  constructor(code: JsonRpcTransportError["code"], message: string) {
    super(message);
    this.name = "JsonRpcTransportError";
    this.code = code;
  }
}

export class JsonRpcClient {
  readonly #defaultTimeoutMs: number;
  readonly #input: Readable;
  readonly #maxFrameBytes: number;
  readonly #maxPendingRequests: number;
  readonly #onFatalError: ((error: JsonRpcTransportError) => void) | undefined;
  readonly #onNotification: (notification: CodexNotification) => void;
  readonly #onServerRequest: (request: CodexServerRequest) => Promise<unknown>;
  readonly #output: Writable;
  readonly #pending = new Map<RpcId, PendingRequest>();
  readonly #framer: JsonLineFramer;
  #closed = false;
  #nextId = 1;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(options: JsonRpcClientOptions) {
    this.#defaultTimeoutMs = positiveInteger(options.defaultTimeoutMs ?? DEFAULT_CODEX_REQUEST_TIMEOUT_MS, "timeout");
    this.#maxFrameBytes = positiveInteger(options.maxFrameBytes ?? MAX_CODEX_FRAME_BYTES, "frame limit");
    this.#maxPendingRequests = positiveInteger(options.maxPendingRequests ?? MAX_PENDING_CODEX_REQUESTS, "pending request limit");
    this.#input = options.input;
    this.#output = options.output;
    this.#onFatalError = options.onFatalError;
    this.#onNotification = options.onNotification;
    this.#onServerRequest = options.onServerRequest;
    this.#framer = new JsonLineFramer({
      maxFrameBytes: this.#maxFrameBytes,
      onFrame: (frame) => this.#receive(frame),
    });

    this.#input.on("data", this.#handleData);
    this.#input.once("end", this.#handleEnd);
    this.#input.once("error", this.#handleInputError);
    this.#output.once("error", this.#handleOutputError);
  }

  get pendingRequestCount(): number {
    return this.#pending.size;
  }

  async notify(method: string, params: unknown): Promise<void> {
    await this.#write({ method: validMethod(method), params });
  }

  request(method: string, params: unknown, timeoutMs = this.#defaultTimeoutMs): Promise<unknown> {
    if (this.#closed) {
      return Promise.reject(new JsonRpcTransportError("closed", "Codex transport is closed."));
    }
    if (this.#pending.size >= this.#maxPendingRequests) {
      return Promise.reject(new JsonRpcTransportError("queue_full", "Codex request queue is full."));
    }
    let checkedMethod: string;
    try {
      checkedMethod = validMethod(method);
    } catch (error) {
      return Promise.reject(error);
    }
    const id = this.#nextId++;
    const boundedTimeout = positiveInteger(timeoutMs, "timeout");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new JsonRpcTransportError("operation_timed_out", `Codex request ${id} timed out.`));
      }, boundedTimeout);
      this.#pending.set(id, { reject, resolve, timer });
      void this.#write({ id, method: checkedMethod, params }).catch((error: unknown) => {
        const pending = this.#pending.get(id);
        if (!pending) {
          return;
        }
        clearTimeout(pending.timer);
        this.#pending.delete(id);
        pending.reject(asTransportError(error));
      });
    });
  }

  close(reason = new JsonRpcTransportError("closed", "Codex transport closed.")): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#detach();
    this.#rejectPending(reason);
  }

  readonly #handleData = (chunk: Buffer | string): void => {
    try {
      this.#framer.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    } catch (error) {
      const code = String(error).includes("exceeds") ? "frame_too_large" : "invalid_frame";
      this.#fail(new JsonRpcTransportError(code, String(error)));
    }
  };

  readonly #handleEnd = (): void => {
    try {
      this.#framer.finish();
    } catch (error) {
      this.#fail(new JsonRpcTransportError("invalid_frame", String(error)));
      return;
    }
    this.#fail(new JsonRpcTransportError("transport_failed", "Codex output ended."));
  };

  readonly #handleInputError = (): void => {
    this.#fail(new JsonRpcTransportError("transport_failed", "Codex output stream failed."));
  };

  readonly #handleOutputError = (): void => {
    this.#fail(new JsonRpcTransportError("transport_failed", "Codex input stream failed."));
  };

  #receive(frame: string): void {
    let value: unknown;
    try {
      value = JSON.parse(frame);
    } catch {
      this.#fail(new JsonRpcTransportError("invalid_frame", "Codex emitted malformed JSON."));
      return;
    }
    if (!isRecord(value)) {
      this.#fail(new JsonRpcTransportError("invalid_frame", "Codex envelope must be an object."));
      return;
    }

    const keys = Object.keys(value).sort().join(",");
    if (keys === "id,result" || keys === "error,id") {
      this.#receiveResponse(value);
      return;
    }
    if (keys === "id,method,params") {
      if (!validIncomingId(value.id) || typeof value.method !== "string") {
        this.#fail(new JsonRpcTransportError("invalid_frame", "Codex request envelope is invalid."));
        return;
      }
      void this.#answerServerRequest({ id: value.id, method: value.method, params: value.params });
      return;
    }
    if (
      (keys === "method,params" || keys === "emittedAtMs,method,params") &&
      typeof value.method === "string" &&
      (value.emittedAtMs === undefined || validIncomingId(value.emittedAtMs))
    ) {
      this.#onNotification(
        value.emittedAtMs === undefined
          ? { method: value.method, params: value.params }
          : { emittedAtMs: value.emittedAtMs, method: value.method, params: value.params },
      );
      return;
    }
    this.#fail(new JsonRpcTransportError("invalid_frame", `Codex envelope shape is invalid (${keys}).`));
  }

  #receiveResponse(response: Record<string, unknown>): void {
    if (!validIncomingId(response.id)) {
      this.#fail(new JsonRpcTransportError("invalid_frame", "Codex response ID is invalid."));
      return;
    }
    const pending = this.#pending.get(response.id);
    if (!pending) {
      this.#fail(new JsonRpcTransportError("invalid_frame", "Codex response ID is unknown."));
      return;
    }
    if ("error" in response) {
      if (
        !isRecord(response.error) ||
        typeof response.error.code !== "number" ||
        !Number.isSafeInteger(response.error.code) ||
        typeof response.error.message !== "string"
      ) {
        this.#fail(new JsonRpcTransportError("invalid_frame", "Codex error response is invalid."));
        return;
      }
      clearTimeout(pending.timer);
      this.#pending.delete(response.id);
      pending.reject(new JsonRpcTransportError("transport_failed", `Codex request ${response.id} failed.`));
    } else {
      clearTimeout(pending.timer);
      this.#pending.delete(response.id);
      pending.resolve(response.result);
    }
  }

  async #answerServerRequest(request: CodexServerRequest): Promise<void> {
    try {
      const response = await this.#onServerRequest(request);
      if (response instanceof JsonRpcDeferredServerError) {
        await this.#write({
          error: { code: response.error.code, message: response.error.message },
          id: request.id,
        });
        await this.#runAfterResponse(response.afterResponse);
        return;
      }
      const deferred = response instanceof JsonRpcDeferredServerResponse ? response : undefined;
      const result = deferred ? deferred.result : response;
      await this.#write({ id: request.id, result: result === undefined ? null : result });
      if (deferred) await this.#runAfterResponse(deferred.afterResponse);
    } catch (error) {
      const safeError = error instanceof JsonRpcServerRequestError
        ? { code: error.code, message: error.message }
        : { code: -32_603, message: "Internal error" };
      await this.#write({
        error: safeError,
        id: request.id,
      }).catch((error: unknown) => this.#fail(asTransportError(error)));
    }
  }

  async #runAfterResponse(callback: () => Promise<void> | void): Promise<void> {
    try {
      await callback();
    } catch {
      this.#fail(new JsonRpcTransportError("transport_failed", "Post-response handling failed."));
    }
  }

  #write(message: unknown): Promise<void> {
    if (this.#closed) {
      return Promise.reject(new JsonRpcTransportError("closed", "Codex transport is closed."));
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(`${JSON.stringify(message)}\n`, "utf8");
    } catch {
      return Promise.reject(new JsonRpcTransportError("invalid_frame", "Codex request is not serializable."));
    }
    if (bytes.length - 1 > this.#maxFrameBytes) {
      return Promise.reject(new JsonRpcTransportError("frame_too_large", "Codex request frame is too large."));
    }

    const queued = this.#writeQueue.then(async () => {
      if (this.#closed) {
        throw new JsonRpcTransportError("closed", "Codex transport is closed.");
      }
      if (!this.#output.write(bytes)) {
        await once(this.#output, "drain");
      }
    });
    this.#writeQueue = queued.catch(() => undefined);
    return queued;
  }

  #fail(error: JsonRpcTransportError): void {
    if (this.#closed) {
      return;
    }
    this.close(error);
    this.#onFatalError?.(error);
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #detach(): void {
    this.#input.off("data", this.#handleData);
    this.#input.off("end", this.#handleEnd);
    this.#input.off("error", this.#handleInputError);
    this.#output.off("error", this.#handleOutputError);
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`Codex ${label} must be a positive safe integer.`);
  }
  return value;
}

function validIncomingId(value: unknown): value is RpcId {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validMethod(value: string): string {
  if (value.length === 0 || value.length > 256) {
    throw new TypeError("Codex method must contain 1 to 256 characters.");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTransportError(error: unknown): JsonRpcTransportError {
  return error instanceof JsonRpcTransportError
    ? error
    : new JsonRpcTransportError("transport_failed", "Codex transport failed.");
}
