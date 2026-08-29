import { randomUUID } from "node:crypto";

import type { ServerNotification } from "../generated/codex/ts/ServerNotification.js";
import type { ServerRequest } from "../generated/codex/ts/ServerRequest.js";
import { CodexProcess, type CodexProcessOptions } from "./codex-process.js";
import {
  FINANCE_CONSENT_VERSION,
  FinanceConsentJournal,
  type FinanceConsentSnapshot,
} from "./consent-journal.js";
import {
  FinanceAuthController,
  type FinanceAuthProcessPort,
  type FinanceAuthStatus,
  type FinanceDeviceLogin,
} from "./finance-auth-controller.js";
import {
  FinanceAssistantStreamProjector,
  type FinanceChatStreamEvent,
} from "./finance-chat-stream.js";
import {
  assertEmptyCodexResponse,
  assertFinanceTurnStartResponse,
  assertSafeFinanceThreadResponse,
} from "./finance-response-validator.js";
import { FinanceServerRequestHandler } from "./finance-server-request-handler.js";
import { buildFinanceThreadStartParams } from "./finance-thread-contract.js";
import {
  FINANCE_TOOL_NAMES,
  FINANCE_TOOL_NAMESPACE,
} from "./finance-tool-contract.js";
import {
  FinanceToolDispatcher,
  type FinanceToolApi,
} from "./finance-tool-dispatcher.js";
import {
  INITIAL_FINANCE_CHAT_STATE,
  reduceFinanceChatState,
  type FinanceChatEvent,
  type FinanceChatState,
} from "./session-manager.js";

export const MAX_USER_PROMPT_BYTES = 64 * 1024;
export const MAX_EARLY_TURN_NOTIFICATIONS = 64;

interface FinanceCodexProcessPort extends FinanceAuthProcessPort {
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface ProcessCallbacks {
  onFatalError: (error: Error) => void;
  onNotification: (notification: ServerNotification) => void;
  onServerRequest: (request: ServerRequest) => Promise<unknown>;
}

export interface FinanceAgentServiceOptions {
  codexProcess?: Omit<CodexProcessOptions, "onFatalError" | "onNotification" | "onServerRequest">;
  consentJournal: FinanceConsentJournal;
  emit: (event: FinanceAgentEvent) => void;
  hostEpoch?: string;
  model?: string;
  processFactory?: (callbacks: ProcessCallbacks) => FinanceCodexProcessPort;
  runtimeDirectory: string;
}

export interface FinanceAgentSnapshot {
  appServer: FinanceChatState["appServer"];
  auth: FinanceChatState["auth"];
  consent: FinanceChatState["consent"];
  host: FinanceChatState["host"];
  session: null | { id: string; status: NonNullable<FinanceChatState["session"]>["status"] };
  turn: null | { id: string; status: NonNullable<FinanceChatState["turn"]>["status"] };
}

export type FinanceAgentEvent =
  | { snapshot: FinanceAgentSnapshot; type: "state.changed" }
  | FinanceChatStreamEvent;

export class FinanceAgentService {
  readonly #consent: FinanceConsentJournal;
  #auth: FinanceAuthController | undefined;
  readonly #emitEvent: (event: FinanceAgentEvent) => void;
  readonly #hostEpoch: string;
  readonly #model: string | undefined;
  readonly #options: FinanceAgentServiceOptions;
  #dispatcher: FinanceToolDispatcher | undefined;
  #handler: FinanceServerRequestHandler | undefined;
  #process: FinanceCodexProcessPort | undefined;
  #projector: FinanceAssistantStreamProjector | undefined;
  #state: FinanceChatState = INITIAL_FINANCE_CHAT_STATE;
  #turnStarting = false;
  #earlyTurnNotifications: ServerNotification[] = [];

  constructor(options: FinanceAgentServiceOptions) {
    this.#options = options;
    this.#consent = options.consentJournal;
    this.#emitEvent = options.emit;
    this.#hostEpoch = validId(options.hostEpoch ?? randomUUID());
    this.#model = options.model;
  }

  snapshot(): FinanceAgentSnapshot {
    return {
      appServer: this.#state.appServer,
      auth: this.#state.auth,
      consent: { ...this.#state.consent },
      host: this.#state.host,
      session: this.#state.session
        ? { id: this.#state.session.id, status: this.#state.session.status }
        : null,
      turn: this.#state.turn ? { id: this.#state.turn.id, status: this.#state.turn.status } : null,
    };
  }

  async start(): Promise<void> {
    if (this.#process) throw new FinanceAgentServiceError("invalid_state");
    this.#loadConsent();
    const callbacks: ProcessCallbacks = {
      onFatalError: () => this.#handleFatalProcessError(),
      onNotification: (notification) => this.#handleNotification(notification),
      onServerRequest: (request) => this.#handleServerRequest(request),
    };
    const process = this.#createProcess(callbacks);
    this.#process = process;
    this.#transition({ type: "app_server.status", status: "starting" });
    try {
      await process.start();
      this.#transition({ type: "app_server.status", status: "ready" });
      this.#auth = new FinanceAuthController({
        consent: this.#consent,
        emit: (status) => this.#syncAuth(status),
        process,
      });
      if (this.#state.consent.status === "granted") await this.#auth.refresh().catch(() => undefined);
      this.#transition({ type: "host.status", status: "ready" });
    } catch {
      await process.stop().catch(() => undefined);
      this.#process = undefined;
      if (this.#state.host === "starting") this.#transition({ type: "host.status", status: "degraded" });
      throw new FinanceAgentServiceError("agent_unavailable");
    }
  }

  configureFinanceApi(api: FinanceToolApi): void {
    if (this.#state.host !== "ready" || this.#dispatcher) {
      throw new FinanceAgentServiceError("invalid_state");
    }
    const dispatcher = new FinanceToolDispatcher(api, this.#consent);
    this.#dispatcher = dispatcher;
    this.#handler = new FinanceServerRequestHandler({
      dispatcher,
      onAbortTurn: () => this.interruptTurn(),
    });
  }

  async grantConsent(): Promise<FinanceConsentSnapshot> {
    const snapshot = this.#consent.grant();
    this.#transition({ type: "consent.granted", version: FINANCE_CONSENT_VERSION });
    if (!this.#process) await this.#startProcessAfterGrant();
    await this.#requiredAuth().refresh();
    return snapshot;
  }

  async startLogin(): Promise<FinanceDeviceLogin> {
    return this.#requiredAuth().startLogin();
  }

  async logout(): Promise<void> {
    if (this.#state.session && this.#state.session.status !== "closed") {
      throw new FinanceAgentServiceError("session_busy");
    }
    await this.#requiredAuth().logout();
  }

  async createSession(sessionId: string): Promise<void> {
    const dispatcher = this.#requiredDispatcher();
    this.#consent.assertGranted(FINANCE_CONSENT_VERSION);
    if (this.#state.auth !== "authenticated") throw new FinanceAgentServiceError("authentication_required");
    this.#transition({ type: "session.start", consentVersion: FINANCE_CONSENT_VERSION, sessionId });
    let dispatcherStarted = false;
    try {
      const response = await this.#requiredProcess().request(
        "thread/start",
        buildFinanceThreadStartParams(this.#model),
      );
      assertSafeFinanceThreadResponse(response, this.#options.runtimeDirectory);
      dispatcher.startSession({
        consentVersion: FINANCE_CONSENT_VERSION,
        hostEpoch: this.#hostEpoch,
        providerThreadId: response.thread.id,
        sessionId,
      });
      dispatcherStarted = true;
      this.#transition({ type: "session.ready", providerThreadId: response.thread.id, sessionId });
    } catch (error) {
      if (dispatcherStarted) {
        try { dispatcher.closeSession(); } catch { /* The failed session remains unavailable. */ }
      }
      this.#transition({ type: "session.fail", sessionId });
      throw mapServiceError(error, "unsafe_codex_configuration");
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.#state.session;
    if (!session || session.id !== validId(sessionId) || session.status === "closed") {
      throw new FinanceAgentServiceError("resource_not_found");
    }
    if (isActiveTurn(this.#state.turn)) throw new FinanceAgentServiceError("turn_busy");
    if (session.providerThreadId && this.#process) {
      const response = await this.#process.request("thread/close", { threadId: session.providerThreadId });
      assertEmptyCodexResponse(response);
    }
    this.#dispatcher?.closeSession();
    this.#transition({ type: "session.close", sessionId });
  }

  async startTurn(sessionId: string, turnId: string, prompt: string): Promise<void> {
    validPrompt(prompt);
    const session = this.#state.session;
    if (!session?.providerThreadId || session.id !== validId(sessionId)) {
      throw new FinanceAgentServiceError("resource_not_found");
    }
    this.#consent.assertGranted(session.consentVersion);
    this.#transition({ type: "turn.start", sessionId, turnId });
    this.#turnStarting = true;
    this.#earlyTurnNotifications = [];
    let dispatcherTurnStarted = false;
    try {
      const response = await this.#requiredProcess().request("turn/start", {
        clientUserMessageId: turnId,
        input: [{ text: prompt, text_elements: [], type: "text" }],
        threadId: session.providerThreadId,
      });
      assertFinanceTurnStartResponse(response);
      this.#requiredDispatcher().startTurn({ providerTurnId: response.turn.id });
      dispatcherTurnStarted = true;
      this.#projector = new FinanceAssistantStreamProjector({
        emit: (event) => this.#emit(event),
        providerThreadId: session.providerThreadId,
        providerTurnId: response.turn.id,
        sessionId,
        turnId,
      });
      this.#transition({ type: "turn.running", providerTurnId: response.turn.id, turnId });
      this.#turnStarting = false;
      const early = this.#earlyTurnNotifications;
      this.#earlyTurnNotifications = [];
      for (const notification of early) this.#dispatchTurnNotification(notification);
    } catch (error) {
      this.#turnStarting = false;
      this.#earlyTurnNotifications = [];
      this.#projector?.abort();
      this.#projector = undefined;
      if (dispatcherTurnStarted) {
        try { this.#requiredDispatcher().finishTurn(); } catch { /* The failed turn remains unavailable. */ }
      }
      if (isActiveTurn(this.#state.turn)) {
        this.#transition({ type: "turn.finish", status: "failed", turnId });
      }
      throw mapServiceError(error, "turn_failed");
    }
  }

  async interruptTurn(): Promise<void> {
    const turn = this.#state.turn;
    const session = this.#state.session;
    if (!turn || !session?.providerThreadId || !isActiveTurn(turn)) return;
    if (turn.status !== "interrupting") this.#transition({ type: "turn.interrupt", turnId: turn.id });
    this.#dispatcher?.interruptTurn();
    if (turn.providerTurnId && this.#process) {
      await this.#process.request("turn/interrupt", {
        threadId: session.providerThreadId,
        turnId: turn.providerTurnId,
      }).catch(() => undefined);
    }
  }

  async revokeConsent(): Promise<FinanceConsentSnapshot> {
    const pending = this.#consent.beginRevocation();
    if (this.#state.consent.status !== "revoke_pending") {
      this.#transition({ type: "consent.revoke_pending", version: FINANCE_CONSENT_VERSION });
    }
    await this.interruptTurn();
    if (isActiveTurn(this.#state.turn)) {
      const turnId = this.#state.turn.id;
      this.#projector?.abort();
      this.#projector = undefined;
      try { this.#dispatcher?.finishTurn(); } catch { /* Child shutdown is the final deny boundary. */ }
      this.#transition({ type: "turn.finish", status: "interrupted", turnId });
    }
    const session = this.#state.session;
    if (session && session.status !== "closed") {
      try {
        await this.closeSession(session.id);
      } catch {
        if (this.#state.session?.status !== "context_lost") this.#handleFatalProcessError();
      }
    }
    this.#auth?.stop();
    this.#auth = undefined;
    if (this.#process) {
      if (this.#state.appServer === "ready") this.#transition({ type: "app_server.status", status: "stopping" });
      await this.#process.stop();
      this.#process = undefined;
      if (this.#state.appServer === "stopping") this.#transition({ type: "app_server.status", status: "stopped" });
    }
    const completed = this.#consent.completeRevocation();
    this.#transition({ type: "consent.revoked", version: FINANCE_CONSENT_VERSION });
    return completed.sequence >= pending.sequence ? completed : pending;
  }

  async stop(): Promise<void> {
    await this.interruptTurn();
    if (isActiveTurn(this.#state.turn)) {
      const turnId = this.#state.turn.id;
      this.#projector?.abort();
      try { this.#dispatcher?.finishTurn(); } catch { /* Continue fail-closed shutdown. */ }
      this.#transition({ type: "turn.finish", status: "interrupted", turnId });
    }
    if (this.#state.session && this.#state.session.status !== "closed") {
      await this.closeSession(this.#state.session.id).catch(() => this.#handleFatalProcessError());
    }
    this.#auth?.stop();
    this.#auth = undefined;
    if (this.#state.host === "ready" || this.#state.host === "degraded") {
      this.#transition({ type: "host.status", status: "stopping" });
    } else if (this.#state.host === "starting") {
      this.#transition({ type: "host.status", status: "stopping" });
    }
    if (this.#process) {
      if (["ready", "crashed"].includes(this.#state.appServer)) {
        this.#transition({ type: "app_server.status", status: "stopping" });
      }
      await this.#process.stop();
      this.#process = undefined;
      if (this.#state.appServer === "stopping") this.#transition({ type: "app_server.status", status: "stopped" });
    }
    if (this.#state.host === "stopping") this.#transition({ type: "host.status", status: "stopped" });
  }

  #handleNotification(notification: ServerNotification): void {
    if (this.#auth?.handleNotification(notification)) return;
    if (notification.method === "remoteControl/status/changed") {
      if (notification.params.status !== "disabled") {
        throw new FinanceAgentServiceError("unsafe_codex_configuration");
      }
      return;
    }
    if (this.#turnStarting && isTurnNotification(notification)) {
      if (this.#earlyTurnNotifications.length >= MAX_EARLY_TURN_NOTIFICATIONS) {
        throw new FinanceAgentServiceError("protocol_incompatible");
      }
      this.#earlyTurnNotifications.push(notification);
      return;
    }
    if (isTurnNotification(notification)) {
      this.#dispatchTurnNotification(notification);
      return;
    }
    if (isForbiddenNotification(notification)) {
      throw new FinanceAgentServiceError("unsafe_codex_configuration");
    }
    if (notification.method === "error" && isActiveTurn(this.#state.turn)) {
      void this.interruptTurn();
    }
  }

  #dispatchTurnNotification(notification: ServerNotification): void {
    const session = this.#state.session;
    const turn = this.#state.turn;
    if (!session?.providerThreadId || !turn?.providerTurnId) {
      throw new FinanceAgentServiceError("protocol_incompatible");
    }
    switch (notification.method) {
      case "turn/started":
        assertProviderTurn(notification.params.threadId, notification.params.turn.id, session.providerThreadId, turn.providerTurnId);
        return;
      case "item/agentMessage/delta":
        this.#requiredProjector().receiveDelta(notification.params);
        return;
      case "item/started":
        assertProviderTurn(notification.params.threadId, notification.params.turnId, session.providerThreadId, turn.providerTurnId);
        assertAllowedThreadItem(notification.params.item);
        return;
      case "item/completed":
        assertProviderTurn(notification.params.threadId, notification.params.turnId, session.providerThreadId, turn.providerTurnId);
        assertAllowedThreadItem(notification.params.item);
        if (notification.params.item.type === "dynamicToolCall") assertFinanceToolItem(notification.params.item);
        this.#requiredProjector().completeItem(notification.params);
        return;
      case "turn/completed": {
        assertProviderTurn(notification.params.threadId, notification.params.turn.id, session.providerThreadId, turn.providerTurnId);
        const status = notification.params.turn.status;
        if (status === "inProgress") throw new FinanceAgentServiceError("protocol_incompatible");
        if (status === "completed") this.#requiredProjector().finishTurn();
        else this.#projector?.abort();
        this.#projector = undefined;
        this.#requiredDispatcher().finishTurn();
        this.#transition({
          type: "turn.finish",
          status: status === "completed" ? "completed" : status === "interrupted" ? "interrupted" : "failed",
          turnId: turn.id,
        });
        return;
      }
      default:
        if (isForbiddenNotification(notification)) {
          throw new FinanceAgentServiceError("unsafe_codex_configuration");
        }
    }
  }

  async #handleServerRequest(request: ServerRequest): Promise<unknown> {
    if (!this.#handler) throw new FinanceAgentServiceError("finance_api_unavailable");
    if (typeof request.id !== "number") throw new FinanceAgentServiceError("protocol_incompatible");
    return this.#handler.handle({ id: request.id, method: request.method, params: request.params });
  }

  #handleFatalProcessError(): void {
    this.#projector?.abort();
    this.#projector = undefined;
    this.#dispatcher?.abandonSession();
    if (this.#state.appServer !== "crashed" && this.#state.appServer !== "stopped") {
      try {
        this.#transition({ type: "child.exited" });
      } catch {
        // The first fatal transition is authoritative.
      }
    }
  }

  #syncAuth(status: FinanceAuthStatus): void {
    if (this.#state.auth === status) return;
    if (status === "logged_out" && isActiveTurn(this.#state.turn)) {
      void this.interruptTurn().catch(() => undefined);
      this.#projector?.abort();
      this.#projector = undefined;
      try { this.#dispatcher?.finishTurn(); } catch { this.#dispatcher?.abandonSession(); }
    }
    this.#transition({ type: "auth.status", status });
  }

  #loadConsent(): void {
    const snapshot = this.#consent.load();
    if (snapshot.status === "unknown") return;
    this.#transition({
      type: "consent.loaded",
      status: snapshot.status === "granted" ? "granted" : snapshot.status === "revoke_pending" ? "revoke_pending" : "revoked",
      version: snapshot.version ?? FINANCE_CONSENT_VERSION,
    });
  }

  async #startProcessAfterGrant(): Promise<void> {
    if (this.#state.appServer !== "stopped") throw new FinanceAgentServiceError("invalid_state");
    const callbacks: ProcessCallbacks = {
      onFatalError: () => this.#handleFatalProcessError(),
      onNotification: (notification) => this.#handleNotification(notification),
      onServerRequest: (request) => this.#handleServerRequest(request),
    };
    const process = this.#createProcess(callbacks);
    this.#process = process;
    this.#transition({ type: "app_server.status", status: "starting" });
    await process.start();
    this.#transition({ type: "app_server.status", status: "ready" });
    this.#auth = new FinanceAuthController({
      consent: this.#consent,
      emit: (status) => this.#syncAuth(status),
      process,
    });
  }

  #createProcess(callbacks: ProcessCallbacks): FinanceCodexProcessPort {
    if (this.#options.processFactory) return this.#options.processFactory(callbacks);
    if (!this.#options.codexProcess) throw new FinanceAgentServiceError("invalid_configuration");
    return new CodexProcess({ ...this.#options.codexProcess, ...callbacks });
  }

  #transition(event: FinanceChatEvent): void {
    this.#state = reduceFinanceChatState(this.#state, event);
    this.#emit({ snapshot: this.snapshot(), type: "state.changed" });
  }

  #emit(event: FinanceAgentEvent): void {
    try { this.#emitEvent(event); } catch { /* A disconnected renderer must not change host state. */ }
  }

  #requiredProcess(): FinanceCodexProcessPort {
    if (!this.#process) throw new FinanceAgentServiceError("agent_unavailable");
    return this.#process;
  }

  #requiredAuth(): FinanceAuthController {
    if (!this.#auth) throw new FinanceAgentServiceError("agent_unavailable");
    return this.#auth;
  }

  #requiredDispatcher(): FinanceToolDispatcher {
    if (!this.#dispatcher) throw new FinanceAgentServiceError("finance_api_unavailable");
    return this.#dispatcher;
  }

  #requiredProjector(): FinanceAssistantStreamProjector {
    if (!this.#projector) throw new FinanceAgentServiceError("protocol_incompatible");
    return this.#projector;
  }
}

export class FinanceAgentServiceError extends Error {
  readonly code:
    | "agent_unavailable"
    | "authentication_required"
    | "finance_api_unavailable"
    | "invalid_configuration"
    | "invalid_request"
    | "invalid_state"
    | "protocol_incompatible"
    | "resource_not_found"
    | "session_busy"
    | "turn_busy"
    | "turn_failed"
    | "unsafe_codex_configuration";

  constructor(code: FinanceAgentServiceError["code"]) {
    super("Finance agent service operation was rejected.");
    this.name = "FinanceAgentServiceError";
    this.code = code;
  }
}

function assertFinanceToolItem(item: Extract<Parameters<typeof assertAllowedThreadItem>[0], { type: "dynamicToolCall" }>): void {
  if (
    item.namespace !== FINANCE_TOOL_NAMESPACE ||
    !FINANCE_TOOL_NAMES.includes(item.tool as (typeof FINANCE_TOOL_NAMES)[number])
  ) {
    throw new FinanceAgentServiceError("unsafe_codex_configuration");
  }
}

function assertAllowedThreadItem(item: Parameters<FinanceAssistantStreamProjector["completeItem"]>[0]["item"]): void {
  if (!["userMessage", "agentMessage", "reasoning", "dynamicToolCall"].includes(item.type)) {
    throw new FinanceAgentServiceError("unsafe_codex_configuration");
  }
}

function assertProviderTurn(actualThread: string, actualTurn: string, expectedThread: string, expectedTurn: string): void {
  if (actualThread !== expectedThread || actualTurn !== expectedTurn) {
    throw new FinanceAgentServiceError("protocol_incompatible");
  }
}

function isTurnNotification(notification: ServerNotification): boolean {
  return [
    "turn/started",
    "turn/completed",
    "item/started",
    "item/completed",
    "item/agentMessage/delta",
  ].includes(notification.method);
}

function isForbiddenNotification(notification: ServerNotification): boolean {
  return /(?:command|process|fileChange|mcp|plan|hook|webSearch|image|collab|subAgent|permissions|patch|diff|approval|guardian|review|environment|externalAgent|thread\/goal|thread\/project|project\/|realtime|fs\/)/i.test(
    notification.method,
  );
}

function isActiveTurn(turn: FinanceChatState["turn"]): turn is NonNullable<FinanceChatState["turn"]> {
  return turn !== null && ["starting", "running", "interrupting"].includes(turn.status);
}

function validPrompt(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.includes("\0") ||
    /[\uD800-\uDFFF]/u.test(value) ||
    Buffer.byteLength(value, "utf8") > MAX_USER_PROMPT_BYTES
  ) {
    throw new FinanceAgentServiceError("invalid_request");
  }
  return value;
}

function validId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new FinanceAgentServiceError("resource_not_found");
  return value;
}

function mapServiceError(error: unknown, fallback: FinanceAgentServiceError["code"]): FinanceAgentServiceError {
  return error instanceof FinanceAgentServiceError ? error : new FinanceAgentServiceError(fallback);
}
