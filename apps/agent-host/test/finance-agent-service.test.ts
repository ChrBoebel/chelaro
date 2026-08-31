import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ServerNotification } from "../generated/codex/ts/ServerNotification.js";
import type { JsonValue } from "../generated/codex/ts/serde_json/JsonValue.js";
import {
  FinanceAgentService,
  FinanceAgentServiceError,
  type FinanceAgentEvent,
  type FinanceAgentServiceOptions,
} from "../src/finance-agent-service.js";
import { FinanceConsentJournal } from "../src/consent-journal.js";
import type { FinanceToolApi } from "../src/finance-tool-dispatcher.js";
import type { FinanceModelSelection } from "../src/finance-thread-contract.js";
import { SessionTransitionError } from "../src/session-manager.js";
import { legacyConsentGrantLine } from "./consent-fixtures.js";

type Callbacks = Parameters<NonNullable<FinanceAgentServiceOptions["processFactory"]>>[0];

class StubProcess {
  readonly calls: Array<{ method: string; params: unknown }> = [];
  stopped = false;
  readonly #callbacks: Callbacks;
  readonly #runtimeDirectory: string;
  earlyTurn = false;

  constructor(callbacks: Callbacks, runtimeDirectory: string) {
    this.#callbacks = callbacks;
    this.#runtimeDirectory = runtimeDirectory;
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    this.stopped = true;
  }

  async request(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    switch (method) {
      case "account/read":
        return {
          account: { email: null, planType: "plus", type: "chatgpt" },
          requiresOpenaiAuth: true,
        };
      case "config/read":
        return { config: { mcp_servers: {} }, layers: null, origins: {} };
      case "thread/start":
      case "thread/resume":
        return echoedThread(this.#runtimeDirectory, params);
      case "turn/start":
        if (this.earlyTurn) this.#emitCompletedTurn();
        return { turn: turn("provider_turn_1", "inProgress", []) };
      case "turn/interrupt":
        return {};
      case "thread/unsubscribe":
        return { status: "unsubscribed" };
      case "thread/delete":
        return {};
      default:
        throw new Error(`Unexpected synthetic method: ${method}`);
    }
  }

  notification(notification: ServerNotification): void {
    this.#callbacks.onNotification(notification);
  }

  serverRequest(request: Parameters<Callbacks["onServerRequest"]>[0]): Promise<unknown> {
    return this.#callbacks.onServerRequest(request);
  }

  #emitCompletedTurn(): void {
    const message = agentMessage("Das ist dein Überblick.");
    for (const notification of [
      { method: "turn/started", params: { threadId: "provider_thread_1", turn: turn("provider_turn_1", "inProgress", []) } },
      {
        method: "item/agentMessage/delta",
        params: {
          delta: message.text,
          itemId: message.id,
          threadId: "provider_thread_1",
          turnId: "provider_turn_1",
        },
      },
      {
        method: "item/completed",
        params: { completedAtMs: 2, item: message, threadId: "provider_thread_1", turnId: "provider_turn_1" },
      },
      {
        method: "turn/completed",
        params: { threadId: "provider_thread_1", turn: turn("provider_turn_1", "completed", [message]) },
      },
    ] as ServerNotification[]) this.#callbacks.onNotification(notification);
  }
}

class StubApi implements FinanceToolApi {
  readonly calls: string[] = [];
  readonly historyCalls: string[] = [];
  providerThreadId: string | null = null;

  async call(name: Parameters<FinanceToolApi["call"]>[0]): Promise<JsonValue> {
    this.calls.push(name);
    return { currency: "EUR", period: "2026-08", total: "100.00" };
  }

  boundSelection: unknown;

  async bindConversationRuntime(
    _conversationId: string,
    providerThreadId: string,
    selection: unknown,
  ): Promise<void> {
    this.historyCalls.push("bind");
    this.providerThreadId = providerThreadId;
    this.boundSelection = selection;
  }

  async completeConversationTurn(): Promise<void> {
    this.historyCalls.push("complete");
  }

  async failConversationTurn(): Promise<void> {
    this.historyCalls.push("fail");
  }

  storedSelection: FinanceModelSelection = { effort: "medium", fastMode: false, model: "gpt-5.5" };

  async getConversationRuntime(): Promise<
    { providerThreadId: string; selection: FinanceModelSelection } | null
  > {
    this.historyCalls.push("runtime");
    return this.providerThreadId === null
      ? null
      : { providerThreadId: this.providerThreadId, selection: this.storedSelection };
  }

  async reserveConversationTurn(): Promise<void> {
    this.historyCalls.push("reserve");
  }
}

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "finance-agent-service-")));
  const events: FinanceAgentEvent[] = [];
  let process: StubProcess | undefined;
  const journal = new FinanceConsentJournal({ journalPath: join(root, "private", "consent.ndjson") });
  const service = new FinanceAgentService({
    consentJournal: journal,
    emit: (event) => events.push(event),
    hostEpoch: "host_epoch_1",
    processFactory: (callbacks) => {
      process = new StubProcess(callbacks, root);
      return process;
    },
    runtimeDirectory: root,
  });
  return {
    api: new StubApi(),
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    events,
    journal,
    process: () => {
      assert(process);
      return process;
    },
    service,
  };
}

test("finance agent service: legacy consent stays denied until an explicit current grant", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "finance-agent-service-legacy-")));
  const consentPath = join(root, "private", "consent.ndjson");
  mkdirSync(join(root, "private"), { mode: 0o700 });
  writeFileSync(consentPath, legacyConsentGrantLine(), { mode: 0o600 });
  const service = new FinanceAgentService({
    codexProvider: {
      binaryPath: "missing-codex",
      codexHome: root,
      home: root,
      path: "/usr/bin:/bin",
    },
    consentJournal: new FinanceConsentJournal({ journalPath: consentPath }),
    emit: () => undefined,
    runtimeDirectory: root,
    temporaryDirectory: root,
  });
  t.after(async () => { await service.stop(); rmSync(root, { force: true, recursive: true }); });

  await service.start();
  assert.deepEqual(service.snapshot().consent, {
    status: "revoked",
    version: "2026-08-28.v1",
  });
  assert.equal(service.snapshot().appServer, "stopped");
  assert.equal(service.snapshot().provider.status, "checking");

  await service.grantConsent();
  assert.equal(service.snapshot().consent.status, "granted");
  assert.equal(service.snapshot().appServer, "stopped");
  assert.equal(service.snapshot().provider.status, "not_found");
});

async function readyService(state: ReturnType<typeof fixture>): Promise<void> {
  await state.service.start();
  state.service.configureFinanceApi(state.api);
  await state.service.grantConsent();
  await state.service.createSession("session_1", "123e4567-e89b-42d3-a456-426614174000");
}

test("finance agent service: runs consent-bound chat and tool callbacks without coding capabilities", async (t) => {
  const state = fixture();
  t.after(async () => { await state.service.stop(); state.cleanup(); });
  await readyService(state);
  await state.service.startTurn("session_1", "turn_1", "Wie ist mein Überblick?");

  const response = await state.process().serverRequest({
    id: 1,
    method: "item/tool/call",
    params: {
      arguments: { currency: "EUR", period: "2026-08" },
      callId: "call_1",
      namespace: null,
      threadId: "provider_thread_1",
      tool: "finance_get_overview",
      turnId: "provider_turn_1",
    },
  });
  assert.equal((response as { success: boolean }).success, true);
  assert.deepEqual(state.api.calls, ["finance_get_overview"]);

  const message = agentMessage("Dein Überblick ist ausgeglichen.");
  state.process().notification({
    method: "item/agentMessage/delta",
    params: {
      delta: message.text,
      itemId: message.id,
      threadId: "provider_thread_1",
      turnId: "provider_turn_1",
    },
  });

  state.process().notification({
    method: "item/completed",
    params: { completedAtMs: 2, item: message, threadId: "provider_thread_1", turnId: "provider_turn_1" },
  });
  state.process().notification({
    method: "turn/completed",
    params: { threadId: "provider_thread_1", turn: turn("provider_turn_1", "completed", [message]) },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(state.service.snapshot().turn?.status, "completed");
  assert.equal(state.events.some((event) => event.type === "assistant.message.completed"), true);
  assert.deepEqual(state.api.historyCalls, ["runtime", "bind", "reserve", "complete"]);
  assert.equal(JSON.stringify(state.service.snapshot()).includes("provider_"), false);
  await state.service.closeSession("session_1");
  assert.equal(state.process().calls.at(-1)?.method, "thread/unsubscribe");
});

test("finance agent service: replays bounded early notifications only after turn binding", async (t) => {
  const state = fixture();
  t.after(async () => { await state.service.stop(); state.cleanup(); });
  await readyService(state);
  state.process().earlyTurn = true;
  await state.service.startTurn("session_1", "turn_1", "Zeige meinen Überblick");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.service.snapshot().turn?.status, "completed");
  const bytes = state.events
    .filter((event) => event.type === "assistant.message.chunk")
    .map((event) => event.type === "assistant.message.chunk" ? Buffer.from(event.dataBase64, "base64") : Buffer.alloc(0));
  assert.equal(Buffer.concat(bytes).toString(), "Das ist dein Überblick.");
});

test("finance agent service: resumes the exact durable provider thread without fallback", async (t) => {
  const state = fixture();
  t.after(async () => { await state.service.stop(); state.cleanup(); });
  state.api.providerThreadId = "provider_thread_1";
  await state.service.start();
  state.service.configureFinanceApi(state.api);
  await state.service.grantConsent();
  await state.service.createSession(
    "session_1",
    "123e4567-e89b-42d3-a456-426614174000",
  );
  const resumed = state.process().calls.find(({ method }) => method === "thread/resume");
  assert.equal((resumed?.params as { threadId?: string }).threadId, "provider_thread_1");
  assert.equal(state.process().calls.some(({ method }) => method === "thread/start"), false);
  assert.deepEqual(state.api.historyCalls, ["runtime"]);
  await state.service.closeSession("session_1");
  await state.service.deleteConversation("123e4567-e89b-42d3-a456-426614174000");
  assert.equal(state.process().calls.at(-1)?.method, "thread/delete");
});

test("finance agent service: sends the explicit model configuration and keeps the stored binding", async (t) => {
  const state = fixture();
  t.after(async () => { await state.service.stop(); state.cleanup(); });
  await state.service.start();
  state.service.configureFinanceApi(state.api);
  await state.service.grantConsent();
  await state.service.createSession("session_1", "123e4567-e89b-42d3-a456-426614174000", {
    effort: "high",
    fastMode: true,
    model: "gpt-5.4-mini",
  });

  // Nothing may be inherited from the owner's Codex configuration: the model,
  // the reasoning effort, and the service tier all travel with the request.
  const started = state.process().calls.find(({ method }) => method === "thread/start");
  const params = started?.params as {
    config?: { model_reasoning_effort?: string };
    model?: string;
    serviceTier?: string;
  };
  assert.equal(params.model, "gpt-5.4-mini");
  assert.equal(params.config?.model_reasoning_effort, "high");
  assert.equal(params.serviceTier, "priority");
  assert.deepEqual(state.api.boundSelection, {
    effort: "high",
    fastMode: true,
    model: "gpt-5.4-mini",
  });
  assert.deepEqual(state.service.snapshot().models.selected, {
    effort: "high",
    fastMode: true,
    model: "gpt-5.4-mini",
  });

});

test("finance agent service: resumes a conversation on its stored model configuration", async (t) => {
  const state = fixture();
  t.after(async () => { await state.service.stop(); state.cleanup(); });
  state.api.providerThreadId = "provider_thread_1";
  state.api.storedSelection = { effort: "high", fastMode: true, model: "gpt-5.4-mini" };
  await state.service.start();
  state.service.configureFinanceApi(state.api);
  await state.service.grantConsent();
  // No explicit selection: the stored binding decides, not the host default,
  // so a reopened conversation keeps the model its history was produced under.
  await state.service.createSession("session_1", "123e4567-e89b-42d3-a456-426614174000");

  const resumed = state.process().calls.find(({ method }) => method === "thread/resume");
  const params = resumed?.params as {
    config?: { model_reasoning_effort?: string };
    model?: string;
    serviceTier?: string;
  };
  assert.equal(params.model, "gpt-5.4-mini");
  assert.equal(params.config?.model_reasoning_effort, "high");
  assert.equal(params.serviceTier, "priority");
  // An unchanged binding is not rewritten, so `provider_bound` in the audit
  // keeps meaning "new or changed configuration".
  assert.deepEqual(state.api.historyCalls, ["runtime"]);
  assert.deepEqual(state.service.snapshot().models.selected, {
    effort: "high",
    fastMode: true,
    model: "gpt-5.4-mini",
  });
});

test("finance agent service: reopens the same conversation twice in one host epoch", async (t) => {
  const state = fixture();
  t.after(async () => { await state.service.stop(); state.cleanup(); });
  await readyService(state);
  await state.service.closeSession("session_1");

  // ADR 0013 promises the same Codex context on reopening. The provider thread
  // identifier is necessarily the same one, which the epoch ledger used to
  // read as a collision, so continuing a conversation failed until a restart.
  await state.service.createSession("session_2", "123e4567-e89b-42d3-a456-426614174000");

  assert.equal(state.service.snapshot().session?.status, "ready");
  const resumes = state.process().calls.filter(({ method }) => method === "thread/resume");
  assert.equal(resumes.length, 1);
  assert.equal((resumes[0]?.params as { threadId?: string }).threadId, "provider_thread_1");
  await state.service.startTurn("session_2", "turn_2", "Und diesen Monat?");
  assert.equal(state.service.snapshot().turn?.id, "turn_2");
});

test("finance agent service: still refuses a provider thread that arrives as a turn identifier", async (t) => {
  const state = fixture();
  t.after(async () => { await state.service.stop(); state.cleanup(); });
  await readyService(state);

  // Reattaching a resumed thread is allowed; a provider turn wearing that same
  // identifier is not, so the ledger keeps its cross-role collision guard.
  await assert.rejects(
    () => state.service.startTurn("session_1", "provider_thread_1", "Wie war mein Monat?"),
    (error: unknown) => error instanceof SessionTransitionError &&
      error.code === "identifier_reused",
  );
});

test("finance agent service: reports thread token usage and context compaction", async (t) => {
  const state = fixture();
  t.after(async () => { await state.service.stop(); state.cleanup(); });
  await readyService(state);
  assert.equal(state.service.snapshot().usage, null);

  state.process().notification({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "provider_thread_1",
      tokenUsage: {
        last: tokenBreakdown(9_000),
        modelContextWindow: 272_000,
        total: tokenBreakdown(12_500),
      },
      turnId: "provider_turn_1",
    },
  });
  assert.deepEqual(state.service.snapshot().usage, {
    compactions: 0,
    contextWindow: 272_000,
    totalTokens: 12_500,
    usedTokens: 9_000,
  });

  // Compaction is what keeps a durable conversation inside the window; it is
  // counted once even though Codex announces it twice.
  state.process().notification({
    method: "thread/compacted",
    params: { threadId: "provider_thread_1", turnId: "provider_turn_1" },
  });
  state.process().notification({
    method: "thread/compacted",
    params: { threadId: "provider_thread_1", turnId: "provider_turn_1" },
  });
  assert.equal(state.service.snapshot().usage?.compactions, 1);

  // Usage belongs to the thread, so reopening starts from nothing again.
  await state.service.closeSession("session_1");
  await state.service.createSession("session_2", "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(state.service.snapshot().usage, null);
});

test("finance agent service: rejects token usage reported for a foreign thread", async (t) => {
  const state = fixture();
  t.after(async () => { await state.service.stop(); state.cleanup(); });
  await readyService(state);
  assert.throws(
    () => state.process().notification({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "provider_thread_9",
        tokenUsage: {
          last: tokenBreakdown(1),
          modelContextWindow: null,
          total: tokenBreakdown(1),
        },
        turnId: "provider_turn_1",
      },
    }),
    (error: unknown) => error instanceof FinanceAgentServiceError &&
      error.code === "protocol_incompatible",
  );
  assert.equal(state.service.snapshot().usage, null);
});

test("finance agent service: durable revocation interrupts, closes, and stops before completion", async (t) => {
  const state = fixture();
  t.after(() => state.cleanup());
  await readyService(state);
  await state.service.startTurn("session_1", "turn_1", "Was ist offen?");
  const revoked = await state.service.revokeConsent();
  assert.equal(revoked.status, "revoked");
  assert.deepEqual(state.service.snapshot(), {
    appServer: "stopped",
    auth: "unknown",
    consent: { status: "revoked", version: "2026-08-31.v2" },
    host: "ready",
    models: {
      available: [],
      selected: { effort: "medium", fastMode: false, model: "gpt-5.5" },
    },
    provider: { status: "ready", version: "test" },
    session: { conversationId: null, id: "session_1", status: "closed" },
    turn: { id: "turn_1", status: "interrupted" },
    usage: null,
  });
  assert.equal(state.process().stopped, true);
  assert.equal(state.journal.load().status, "revoked");
});

test("finance agent service: rejects sessions before post-start API injection", async (t) => {
  const state = fixture();
  t.after(async () => { await state.service.stop(); state.cleanup(); });
  await state.service.start();
  await state.service.grantConsent();
  await assert.rejects(
    () => state.service.createSession("session_1", "123e4567-e89b-42d3-a456-426614174000"),
    (error: unknown) => error instanceof FinanceAgentServiceError && error.code === "finance_api_unavailable",
  );
  assert.equal(state.service.snapshot().session, null);
});

test("finance agent service: startup recovery keeps revoke-pending denied until shutdown completion", async (t) => {
  const state = fixture();
  t.after(async () => { await state.service.stop(); state.cleanup(); });
  state.journal.grant();
  state.journal.beginRevocation();
  await state.service.start();
  assert.equal(state.service.snapshot().consent.status, "revoke_pending");
  await state.service.revokeConsent();
  assert.equal(state.service.snapshot().consent.status, "revoked");
  assert.equal(state.journal.load().status, "revoked");
});

test("finance agent service: shared account loss aborts active work and loses the session context", async (t) => {
  const state = fixture();
  t.after(async () => { await state.service.stop(); state.cleanup(); });
  await readyService(state);
  await state.service.startTurn("session_1", "turn_1", "Was ist offen?");
  state.process().notification({ method: "account/updated", params: { authMode: null, planType: null } });
  assert.equal(state.service.snapshot().auth, "logged_out");
  assert.equal(state.service.snapshot().session?.status, "context_lost");
  assert.equal(state.service.snapshot().turn?.status, "failed");
});

test("finance agent service: accepts only a disabled passive remote-control status", async (t) => {
  const state = fixture();
  t.after(async () => { await state.service.stop(); state.cleanup(); });
  await state.service.start();
  state.process().notification({
    method: "remoteControl/status/changed",
    params: { environmentId: null, installationId: "local", serverName: "disabled", status: "disabled" },
  });
  assert.throws(
    () => state.process().notification({
      method: "remoteControl/status/changed",
      params: { environmentId: null, installationId: "local", serverName: "unexpected", status: "connected" },
    }),
    (error: unknown) => error instanceof FinanceAgentServiceError && error.code === "unsafe_codex_configuration",
  );
});

/** Mirrors the App Server, which echoes the accepted configuration back. */
function echoedThread(runtimeDirectory: string, params: unknown): Record<string, unknown> {
  const requested = params as {
    config?: { model_reasoning_effort?: string };
    model?: string;
    serviceTier?: string;
  };
  return {
    ...safeThread(runtimeDirectory),
    model: requested.model ?? "gpt-5.5",
    reasoningEffort: requested.config?.model_reasoning_effort ?? "medium",
    serviceTier: requested.serviceTier ?? "default",
  };
}

function safeThread(runtimeDirectory: string): Record<string, unknown> {
  return {
    activePermissionProfile: null,
    approvalPolicy: "never",
    approvalsReviewer: "user",
    cwd: runtimeDirectory,
    instructionSources: [],
    model: "gpt-5.5",
    modelProvider: "openai",
    multiAgentMode: "explicitRequestOnly",
    reasoningEffort: "medium",
    runtimeWorkspaceRoots: [],
    sandbox: { networkAccess: false, type: "readOnly" },
    serviceTier: "default",
    thread: {
      agentNickname: null,
      agentRole: null,
      cliVersion: "0.151.0",
      createdAt: 1,
      cwd: runtimeDirectory,
      ephemeral: false,
      forkedFromId: null,
      gitInfo: null,
      id: "provider_thread_1",
      modelProvider: "openai",
      name: null,
      parentThreadId: null,
      path: `${runtimeDirectory}/provider-thread.jsonl`,
      preview: "",
      projectId: null,
      recencyAt: 1,
      section: null,
      sectionEnteredAt: null,
      sessionId: "provider_thread_1",
      source: "appServer",
      status: { type: "idle" },
      threadSource: "appServer",
      turns: [],
      updatedAt: 1,
    },
  };
}

function tokenBreakdown(tokens: number) {
  return {
    cacheWriteInputTokens: 0,
    cachedInputTokens: 0,
    inputTokens: tokens,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: tokens,
  };
}

function agentMessage(text: string) {
  return {
    delivery: null,
    id: "provider_message_1",
    memoryCitation: null,
    phase: "final_answer" as const,
    text,
    type: "agentMessage" as const,
  };
}

function turn(id: string, status: "inProgress" | "completed", items: ReturnType<typeof agentMessage>[]) {
  return {
    completedAt: status === "completed" ? 2 : null,
    durationMs: status === "completed" ? 1_000 : null,
    error: null,
    id,
    items,
    itemsView: "full" as const,
    startedAt: 1,
    status,
  };
}
