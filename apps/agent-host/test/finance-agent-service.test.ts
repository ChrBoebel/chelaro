import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
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
        return safeThread(this.#runtimeDirectory);
      case "turn/start":
        if (this.earlyTurn) this.#emitCompletedTurn();
        return { turn: turn("provider_turn_1", "inProgress", []) };
      case "turn/interrupt":
        return {};
      case "thread/unsubscribe":
        return { status: "unsubscribed" };
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

  async call(name: Parameters<FinanceToolApi["call"]>[0]): Promise<JsonValue> {
    this.calls.push(name);
    return { currency: "EUR", period: "2026-08", total: "100.00" };
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

async function readyService(state: ReturnType<typeof fixture>): Promise<void> {
  await state.service.start();
  state.service.configureFinanceApi(state.api);
  await state.service.grantConsent();
  await state.service.createSession("session_1");
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

  assert.equal(state.service.snapshot().turn?.status, "completed");
  assert.equal(state.events.some((event) => event.type === "assistant.message.completed"), true);
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
  assert.equal(state.service.snapshot().turn?.status, "completed");
  const bytes = state.events
    .filter((event) => event.type === "assistant.message.chunk")
    .map((event) => event.type === "assistant.message.chunk" ? Buffer.from(event.dataBase64, "base64") : Buffer.alloc(0));
  assert.equal(Buffer.concat(bytes).toString(), "Das ist dein Überblick.");
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
    consent: { status: "revoked", version: "2026-08-28.v1" },
    host: "ready",
    provider: { status: "ready", version: "test" },
    session: { id: "session_1", status: "closed" },
    turn: { id: "turn_1", status: "interrupted" },
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
    () => state.service.createSession("session_1"),
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

function safeThread(runtimeDirectory: string): Record<string, unknown> {
  return {
    activePermissionProfile: null,
    approvalPolicy: "never",
    approvalsReviewer: "user",
    cwd: runtimeDirectory,
    instructionSources: [],
    model: "gpt-test",
    modelProvider: "openai",
    multiAgentMode: "explicitRequestOnly",
    reasoningEffort: null,
    runtimeWorkspaceRoots: [],
    sandbox: { networkAccess: false, type: "readOnly" },
    serviceTier: null,
    thread: {
      agentNickname: null,
      agentRole: null,
      cliVersion: "0.151.0",
      createdAt: 1,
      cwd: runtimeDirectory,
      ephemeral: true,
      forkedFromId: null,
      gitInfo: null,
      id: "provider_thread_1",
      modelProvider: "openai",
      name: null,
      parentThreadId: null,
      path: null,
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
