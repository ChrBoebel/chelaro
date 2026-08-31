import { randomUUID } from "node:crypto";

import type { ServerNotification } from "../generated/codex/ts/ServerNotification.js";
import type { ServerRequest } from "../generated/codex/ts/ServerRequest.js";
import { CodexProcess } from "./codex-process.js";
import type { AssistantHistoryApi } from "./finance-api-client.js";
import {
  FINANCE_CONSENT_VERSION,
  FinanceConsentJournal,
  type FinanceConsentSnapshot,
} from "./consent-journal.js";
import {
  FinanceAuthController,
  type FinanceAuthProcessPort,
  type FinanceAuthStatus,
} from "./finance-auth-controller.js";
import {
  inspectCodexProvider,
  type CodexProviderOptions,
  type CodexProviderSnapshot,
} from "./codex-provider.js";
import {
  FinanceAssistantStreamProjector,
  type FinanceChatStreamEvent,
} from "./finance-chat-stream.js";
import {
  assertFinanceThreadUnsubscribeResponse,
  assertFinanceThreadDeleteResponse,
  assertFinanceTurnStartResponse,
  assertSafeFinanceThreadResponse,
} from "./finance-response-validator.js";
import { FinanceServerRequestHandler } from "./finance-server-request-handler.js";
import {
  buildFinanceThreadStartParams,
  buildFinanceThreadResumeParams,
  configuredMcpServerNames,
} from "./finance-thread-contract.js";
import {
  FINANCE_TOOL_NAMES,
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
  codexProvider?: CodexProviderOptions;
  consentJournal: FinanceConsentJournal;
  emit: (event: FinanceAgentEvent) => void;
  hostEpoch?: string;
  model?: string;
  processFactory?: (callbacks: ProcessCallbacks) => FinanceCodexProcessPort;
  runtimeDirectory: string;
  temporaryDirectory?: string;
}

export interface FinanceAgentSnapshot {
  appServer: FinanceChatState["appServer"];
  auth: FinanceChatState["auth"];
  consent: FinanceChatState["consent"];
  host: FinanceChatState["host"];
  provider: CodexProviderSnapshot;
  session: null | {
    conversationId: string | null;
    id: string;
    status: NonNullable<FinanceChatState["session"]>["status"];
  };
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
  #history: AssistantHistoryApi | undefined;
  #conversationId: string | undefined;
  #process: FinanceCodexProcessPort | undefined;
  #provider: CodexProviderSnapshot = { status: "checking", version: null };
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
      provider: { ...this.#provider },
      session: this.#state.session
        ? {
            conversationId: this.#conversationId ?? null,
            id: this.#state.session.id,
            status: this.#state.session.status,
          }
        : null,
      turn: this.#state.turn ? { id: this.#state.turn.id, status: this.#state.turn.status } : null,
    };
  }

  async start(): Promise<void> {
    if (this.#process) throw new FinanceAgentServiceError("invalid_state");
    this.#loadConsent();
    this.#transition({ type: "host.status", status: "ready" });
    if (this.#options.processFactory) {
      this.#setProvider({ status: "ready", version: "test" });
      await this.#startProcessAfterGrant();
    } else if (this.#state.consent.status === "granted") {
      await this.refreshProvider();
    }
  }

  configureFinanceApi(api: FinanceToolApi & AssistantHistoryApi): void {
    if (this.#state.host !== "ready" || this.#dispatcher) {
      throw new FinanceAgentServiceError("invalid_state");
    }
    const dispatcher = new FinanceToolDispatcher(api, this.#consent);
    this.#history = api;
    this.#dispatcher = dispatcher;
    this.#handler = new FinanceServerRequestHandler({
      dispatcher,
      onAbortTurn: () => this.interruptTurn(),
    });
  }

  async grantConsent(): Promise<FinanceConsentSnapshot> {
    const snapshot = this.#consent.grant();
    this.#transition({ type: "consent.granted", version: FINANCE_CONSENT_VERSION });
    await this.refreshProvider();
    return snapshot;
  }

  async refreshProvider(): Promise<void> {
    if (this.#state.session && this.#state.session.status !== "closed") {
      throw new FinanceAgentServiceError("session_busy");
    }
    this.#consent.assertGranted(FINANCE_CONSENT_VERSION);
    if (this.#process && this.#auth) {
      await this.#auth.refresh();
      return;
    }
    await this.#startProcessAfterGrant();
    await this.#auth?.refresh().catch(() => {
      this.#syncAuth("logged_out");
    });
  }

  async createSession(sessionId: string, conversationId: string): Promise<void> {
    const dispatcher = this.#requiredDispatcher();
    const history = this.#requiredHistory();
    const validatedConversationId = validId(conversationId);
    this.#consent.assertGranted(FINANCE_CONSENT_VERSION);
    if (this.#state.auth !== "authenticated") throw new FinanceAgentServiceError("authentication_required");
    this.#transition({ type: "session.start", consentVersion: FINANCE_CONSENT_VERSION, sessionId });
    let dispatcherStarted = false;
    try {
      const process = this.#requiredProcess();
      const configuration = await process.request("config/read", {
        cwd: this.#options.runtimeDirectory,
        includeLayers: false,
      });
      const disabledServers = configuredMcpServerNames(configuration);
      const providerThreadId = await history.getConversationRuntime(validatedConversationId);
      const operation = providerThreadId === null ? "start" : "resume";
      const response = await process.request(
        operation === "start" ? "thread/start" : "thread/resume",
        operation === "start"
          ? buildFinanceThreadStartParams(this.#model, disabledServers)
          : buildFinanceThreadResumeParams(providerThreadId!, this.#model, disabledServers),
      );
      assertSafeFinanceThreadResponse(response, this.#options.runtimeDirectory, operation);
      if (providerThreadId !== null && response.thread.id !== providerThreadId) {
        throw new FinanceAgentServiceError("protocol_incompatible");
      }
      if (providerThreadId === null) {
        await history.bindConversationRuntime(validatedConversationId, response.thread.id);
      }
      dispatcher.startSession({
        consentVersion: FINANCE_CONSENT_VERSION,
        hostEpoch: this.#hostEpoch,
        providerThreadId: response.thread.id,
        sessionId,
      });
      dispatcherStarted = true;
      this.#conversationId = validatedConversationId;
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
      const response = await this.#process.request("thread/unsubscribe", { threadId: session.providerThreadId });
      assertFinanceThreadUnsubscribeResponse(response);
    }
    this.#dispatcher?.closeSession();
    this.#conversationId = undefined;
    this.#transition({ type: "session.close", sessionId });
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const validatedConversationId = validId(conversationId);
    if (this.#conversationId === validatedConversationId &&
      this.#state.session?.status !== "closed") {
      throw new FinanceAgentServiceError("session_busy");
    }
    const providerThreadId = await this.#requiredHistory().getConversationRuntime(
      validatedConversationId,
    );
    if (providerThreadId === null) return;
    const response = await this.#requiredProcess().request("thread/delete", {
      threadId: providerThreadId,
    });
    assertFinanceThreadDeleteResponse(response);
  }

  async startTurn(sessionId: string, turnId: string, prompt: string): Promise<void> {
    validPrompt(prompt);
    const conversationId = this.#conversationId;
    const session = this.#state.session;
    if (!session?.providerThreadId || !conversationId || session.id !== validId(sessionId)) {
      throw new FinanceAgentServiceError("resource_not_found");
    }
    this.#consent.assertGranted(session.consentVersion);
    await this.#requiredHistory().reserveConversationTurn(conversationId, validId(turnId), prompt);
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
      await this.#requiredHistory()
        .failConversationTurn(conversationId, turnId, "failed", "provider_turn_start_failed")
        .catch(() => undefined);
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
      await this.#persistFailedTurn(turnId, "interrupted", "consent_revoked");
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
      await this.#persistFailedTurn(turnId, "interrupted", "host_stopped");
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
        const projector = this.#projector;
        const messages = status === "completed" ? this.#requiredProjector().finishTurn() : [];
        if (status !== "completed") projector?.abort();
        this.#requiredDispatcher().finishTurn();
        void this.#persistTerminalTurn(
          turn.id,
          turn.providerTurnId,
          status === "completed" ? "completed" : status === "interrupted" ? "interrupted" : "failed",
          messages,
          projector,
        );
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
    const activeTurnId = isActiveTurn(this.#state.turn) ? this.#state.turn.id : undefined;
    this.#setProvider({ status: "error", version: this.#provider.version });
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
    if (activeTurnId) {
      void this.#persistFailedTurn(activeTurnId, "failed", "provider_process_failed");
    }
  }

  #syncAuth(status: FinanceAuthStatus): void {
    if (this.#state.auth === status) return;
    if (status === "logged_out" && isActiveTurn(this.#state.turn)) {
      const turnId = this.#state.turn.id;
      void this.interruptTurn().catch(() => undefined);
      this.#projector?.abort();
      this.#projector = undefined;
      try { this.#dispatcher?.finishTurn(); } catch { this.#dispatcher?.abandonSession(); }
      void this.#persistFailedTurn(turnId, "failed", "authentication_lost");
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
    let process: FinanceCodexProcessPort;
    if (this.#options.processFactory) {
      process = this.#options.processFactory(callbacks);
    } else {
      const providerOptions = this.#options.codexProvider;
      const temporaryDirectory = this.#options.temporaryDirectory;
      if (!providerOptions || !temporaryDirectory) throw new FinanceAgentServiceError("invalid_configuration");
      this.#setProvider({ status: "checking", version: null });
      const inspection = inspectCodexProvider(providerOptions);
      this.#setProvider(inspection.snapshot);
      if (!inspection.launch) return;
      process = new CodexProcess({
        binaryPath: inspection.launch.binaryPath,
        codexHome: inspection.launch.codexHome,
        home: inspection.launch.home,
        onFatalError: callbacks.onFatalError,
        onNotification: callbacks.onNotification,
        onServerRequest: callbacks.onServerRequest,
        path: inspection.launch.path,
        runtimeDirectory: this.#options.runtimeDirectory,
        temporaryDirectory,
      });
    }
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
    } catch {
      await process.stop().catch(() => undefined);
      this.#process = undefined;
      this.#setProvider({ status: "error", version: this.#provider.version });
      this.#transition({ type: "app_server.status", status: "stopping" });
      this.#transition({ type: "app_server.status", status: "stopped" });
    }
  }

  #setProvider(snapshot: CodexProviderSnapshot): void {
    if (this.#provider.status === snapshot.status && this.#provider.version === snapshot.version) return;
    this.#provider = { ...snapshot };
    this.#emit({ snapshot: this.snapshot(), type: "state.changed" });
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

  #requiredHistory(): AssistantHistoryApi {
    if (!this.#history) throw new FinanceAgentServiceError("finance_api_unavailable");
    return this.#history;
  }

  async #persistTerminalTurn(
    turnId: string,
    providerTurnId: string,
    status: "completed" | "failed" | "interrupted",
    messages: ReturnType<FinanceAssistantStreamProjector["finishTurn"]>,
    projector: FinanceAssistantStreamProjector | undefined,
  ): Promise<void> {
    const conversationId = this.#conversationId;
    if (!conversationId) return this.#finishPersistenceFailure(turnId);
    try {
      if (status === "completed") {
        await this.#requiredHistory().completeConversationTurn(
          conversationId,
          turnId,
          providerTurnId,
          messages,
        );
        projector?.publishCompletions();
      } else {
        await this.#requiredHistory().failConversationTurn(
          conversationId,
          turnId,
          status,
          status === "interrupted" ? "provider_interrupted" : "provider_failed",
        );
      }
      this.#projector = undefined;
      this.#transition({ type: "turn.finish", status, turnId });
    } catch {
      projector?.abort();
      this.#projector = undefined;
      this.#finishPersistenceFailure(turnId);
    }
  }

  #finishPersistenceFailure(turnId: string): void {
    if (isActiveTurn(this.#state.turn)) {
      this.#transition({ type: "turn.finish", status: "failed", turnId });
    }
  }

  async #persistFailedTurn(
    turnId: string,
    status: "failed" | "interrupted",
    errorCode: string,
  ): Promise<void> {
    if (!this.#conversationId || !this.#history) return;
    await this.#history.failConversationTurn(
      this.#conversationId,
      turnId,
      status,
      errorCode,
    ).catch(() => undefined);
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
    item.namespace !== null ||
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
