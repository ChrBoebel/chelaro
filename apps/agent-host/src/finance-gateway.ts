import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { FinanceAgentEvent, FinanceAgentSnapshot } from "./finance-agent-service.js";
import {
  assertFinanceModelSelection,
  type FinanceModelSelection,
} from "./finance-thread-contract.js";

export const MAX_GATEWAY_BODY_BYTES = 70 * 1024;
export const MAX_GATEWAY_EVENT_BYTES = 80 * 1024;
export const MAX_GATEWAY_REPLAY_BYTES = 2 * 1024 * 1024;
export const MAX_GATEWAY_SUBSCRIBERS = 4;

export interface FinanceGatewayService {
  closeSession(sessionId: string): Promise<void>;
  createSession(
    sessionId: string,
    conversationId: string,
    selection?: FinanceModelSelection,
  ): Promise<void>;
  deleteConversation(conversationId: string): Promise<void>;
  grantConsent(): Promise<unknown>;
  interruptTurn(): Promise<void>;
  refreshModelCatalog(): Promise<unknown>;
  refreshProvider(): Promise<void>;
  revokeConsent(): Promise<unknown>;
  snapshot(): FinanceAgentSnapshot;
  startTurn(sessionId: string, turnId: string, prompt: string): Promise<void>;
}

export interface FinanceGatewayOptions {
  capabilityToken: string;
  service: FinanceGatewayService;
}

interface ReplayEvent {
  bytes: number;
  event: FinanceAgentEvent;
  id: number;
}

export class FinanceGateway {
  readonly #capabilityToken: Buffer;
  readonly #replay: ReplayEvent[] = [];
  #replayBytes = 0;
  readonly #server: Server;
  readonly #service: FinanceGatewayService;
  readonly #subscribers = new Set<ServerResponse>();
  #nextEventId = 1;

  constructor(options: FinanceGatewayOptions) {
    if (!/^[a-f0-9]{64}$/.test(options.capabilityToken)) {
      throw new FinanceGatewayError("invalid_configuration");
    }
    this.#capabilityToken = Buffer.from(options.capabilityToken, "utf8");
    this.#service = options.service;
    this.#server = createServer((request, response) => {
      void this.#handle(request, response).catch((error) => this.#respondError(response, error));
    });
    this.#server.on("clientError", (_error, socket) => socket.destroy());
  }

  async start(): Promise<{ origin: string; port: number }> {
    if (this.#server.listening) throw new FinanceGatewayError("invalid_state");
    await new Promise<void>((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(0, "127.0.0.1", resolve);
    });
    const address = this.#server.address();
    if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
      await this.stop();
      throw new FinanceGatewayError("invalid_configuration");
    }
    return { origin: `http://127.0.0.1:${address.port}`, port: address.port };
  }

  async stop(): Promise<void> {
    for (const response of this.#subscribers) response.destroy();
    this.#subscribers.clear();
    if (!this.#server.listening) return;
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  publish(event: FinanceAgentEvent): void {
    const encoded = JSON.stringify(event);
    const bytes = Buffer.byteLength(encoded, "utf8");
    if (bytes > MAX_GATEWAY_EVENT_BYTES) {
      for (const response of this.#subscribers) response.destroy();
      this.#subscribers.clear();
      return;
    }
    const replayEvent = { bytes, event, id: this.#nextEventId++ };
    this.#replay.push(replayEvent);
    this.#replayBytes += bytes;
    while (this.#replayBytes > MAX_GATEWAY_REPLAY_BYTES && this.#replay.length > 0) {
      this.#replayBytes -= this.#replay.shift()!.bytes;
    }
    const frame = encodeSse(replayEvent);
    for (const response of [...this.#subscribers]) {
      if (!response.write(frame)) {
        response.destroy();
        this.#subscribers.delete(response);
      }
    }
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    setSecurityHeaders(response);
    if (!validHost(request.headers.host) || request.headers.origin !== undefined) {
      throw new FinanceGatewayHttpError(403, "forbidden");
    }
    this.#assertAuthorized(request);
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.searchParams.has("token") || url.searchParams.has("authorization")) {
      throw new FinanceGatewayHttpError(400, "invalid_request");
    }
    if (request.method === "GET" && url.pathname === "/v1/status") {
      return respondJson(response, 200, { snapshot: this.#service.snapshot() });
    }
    if (request.method === "GET" && url.pathname === "/v1/events") {
      return this.#subscribe(request, response, url);
    }
    if (request.method === "POST" && url.pathname === "/v1/consent/grant") {
      assertEmptyBody(await readJson(request));
      await this.#service.grantConsent();
      return respondJson(response, 200, { snapshot: this.#service.snapshot() });
    }
    if (request.method === "POST" && url.pathname === "/v1/consent/revoke") {
      assertEmptyBody(await readJson(request));
      await this.#service.revokeConsent();
      return respondJson(response, 200, { snapshot: this.#service.snapshot() });
    }
    if (request.method === "POST" && url.pathname === "/v1/provider/refresh") {
      assertEmptyBody(await readJson(request));
      await this.#service.refreshProvider();
      return respondJson(response, 200, { snapshot: this.#service.snapshot() });
    }
    if (request.method === "POST" && url.pathname === "/v1/models/refresh") {
      assertEmptyBody(await readJson(request));
      await this.#service.refreshModelCatalog();
      return respondJson(response, 200, { snapshot: this.#service.snapshot() });
    }
    if (request.method === "POST" && url.pathname === "/v1/sessions") {
      const body = exactObject(await readJson(request), [
        "conversation_id",
        "model_selection",
        "session_id",
      ]);
      const sessionId = publicId(body.session_id);
      await this.#service.createSession(
        sessionId,
        publicId(body.conversation_id),
        modelSelection(body.model_selection),
      );
      return respondJson(response, 201, { snapshot: this.#service.snapshot() });
    }
    const sessionMatch = /^\/v1\/sessions\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
    if (request.method === "DELETE" && sessionMatch) {
      assertNoRequestBody(request);
      await this.#service.closeSession(publicId(sessionMatch[1]));
      return respondJson(response, 200, { snapshot: this.#service.snapshot() });
    }
    const conversationMatch = /^\/v1\/conversations\/([A-Za-z0-9_-]{1,128})$/.exec(
      url.pathname,
    );
    if (request.method === "DELETE" && conversationMatch) {
      assertNoRequestBody(request);
      await this.#service.deleteConversation(publicId(conversationMatch[1]));
      return respondJson(response, 200, { deleted: true });
    }
    if (request.method === "POST" && url.pathname === "/v1/turns") {
      const body = exactObject(await readJson(request), ["prompt", "session_id", "turn_id"]);
      await this.#service.startTurn(
        publicId(body.session_id),
        publicId(body.turn_id),
        stringValue(body.prompt),
      );
      return respondJson(response, 202, { snapshot: this.#service.snapshot() });
    }
    if (request.method === "POST" && url.pathname === "/v1/turns/interrupt") {
      assertEmptyBody(await readJson(request));
      await this.#service.interruptTurn();
      return respondJson(response, 200, { snapshot: this.#service.snapshot() });
    }
    throw new FinanceGatewayHttpError(404, "not_found");
  }

  #subscribe(request: IncomingMessage, response: ServerResponse, url: URL): void {
    if (this.#subscribers.size >= MAX_GATEWAY_SUBSCRIBERS) {
      throw new FinanceGatewayHttpError(429, "capacity_reached");
    }
    const rawCursor = request.headers["last-event-id"] ?? url.searchParams.get("after");
    const isInitialSubscription = rawCursor === null || rawCursor === undefined;
    const after = isInitialSubscription ? 0 : eventCursor(rawCursor);
    response.writeHead(200, {
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    });
    response.flushHeaders();
    const firstAvailable = this.#replay[0]?.id ?? this.#nextEventId;
    if (isInitialSubscription || (after > 0 && after < firstAvailable - 1)) {
      const reset: ReplayEvent = {
        bytes: 0,
        event: { snapshot: this.#service.snapshot(), type: "state.changed" },
        id: this.#nextEventId - 1,
      };
      response.write(encodeSse(reset, "reset"));
    } else {
      for (const event of this.#replay) {
        if (event.id > after) response.write(encodeSse(event));
      }
    }
    this.#subscribers.add(response);
    request.once("close", () => this.#subscribers.delete(response));
  }

  #assertAuthorized(request: IncomingMessage): void {
    if (request.headers.cookie !== undefined) throw new FinanceGatewayHttpError(401, "unauthorized");
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
      throw new FinanceGatewayHttpError(401, "unauthorized");
    }
    const candidate = Buffer.from(authorization.slice(7), "utf8");
    if (candidate.length !== this.#capabilityToken.length || !timingSafeEqual(candidate, this.#capabilityToken)) {
      throw new FinanceGatewayHttpError(401, "unauthorized");
    }
  }

  #respondError(response: ServerResponse, error: unknown): void {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const status = error instanceof FinanceGatewayHttpError ? error.status : 409;
    const code = error instanceof FinanceGatewayHttpError ? error.code : publicErrorCode(error);
    respondJson(response, status, { error: { code } });
  }
}

export class FinanceGatewayError extends Error {
  readonly code: "invalid_configuration" | "invalid_state";

  constructor(code: FinanceGatewayError["code"]) {
    super("Finance gateway operation failed.");
    this.name = "FinanceGatewayError";
    this.code = code;
  }
}

class FinanceGatewayHttpError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string) {
    super("Finance gateway request was rejected.");
    this.name = "FinanceGatewayHttpError";
    this.status = status;
    this.code = code;
  }
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-security-policy", "default-src 'none'");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
}

function respondJson(response: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(encoded);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"]?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new FinanceGatewayHttpError(415, "unsupported_media_type");
  }
  const declared = Number(request.headers["content-length"] ?? 0);
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_GATEWAY_BODY_BYTES) {
    throw new FinanceGatewayHttpError(413, "body_too_large");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += part.length;
    if (bytes > MAX_GATEWAY_BODY_BYTES) throw new FinanceGatewayHttpError(413, "body_too_large");
    chunks.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new FinanceGatewayHttpError(400, "invalid_json");
  }
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new FinanceGatewayHttpError(400, "invalid_request");
  }
  return value;
}

function assertEmptyBody(value: unknown): void {
  exactObject(value, []);
}

function assertNoRequestBody(request: IncomingMessage): void {
  if (
    request.headers["transfer-encoding"] !== undefined ||
    (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")
  ) {
    throw new FinanceGatewayHttpError(400, "invalid_request");
  }
}

function publicId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new FinanceGatewayHttpError(400, "invalid_request");
  }
  return value;
}

function stringValue(value: unknown): string {
  if (typeof value !== "string") throw new FinanceGatewayHttpError(400, "invalid_request");
  return value;
}

function modelSelection(value: unknown): FinanceModelSelection {
  const body = exactObject(value, ["effort", "fast_mode", "model"]);
  const candidate = {
    effort: body.effort,
    fastMode: body.fast_mode,
    model: body.model,
  };
  try {
    assertFinanceModelSelection(candidate);
  } catch {
    throw new FinanceGatewayHttpError(400, "invalid_request");
  }
  return candidate;
}

function eventCursor(value: string | string[]): number {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === null || !/^[0-9]{1,16}$/.test(candidate ?? "")) {
    throw new FinanceGatewayHttpError(400, "invalid_cursor");
  }
  const parsed = Number(candidate);
  if (!Number.isSafeInteger(parsed)) throw new FinanceGatewayHttpError(400, "invalid_cursor");
  return parsed;
}

function validHost(value: string | undefined): boolean {
  return typeof value === "string" && /^127\.0\.0\.1(?::(?:[1-9][0-9]{0,4}))?$/.test(value);
}

function encodeSse(event: ReplayEvent, name = "finance"): string {
  return `id: ${event.id}\nevent: ${name}\ndata: ${JSON.stringify(event.event)}\n\n`;
}

function publicErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string" && /^[a-z_]{1,64}$/.test(error.code)) {
    return error.code;
  }
  return "operation_rejected";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
