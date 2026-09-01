import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { providerSnapshot, SCHEMA_CODEX_VERSION } from "../src/codex-provider.js";
import { FinanceGateway, type FinanceGatewayService } from "../src/finance-gateway.js";
import type { FinanceAgentSnapshot } from "../src/finance-agent-service.js";
import type { FinanceModelSelection } from "../src/finance-thread-contract.js";

const TOKEN = "a".repeat(64);

class StubService implements FinanceGatewayService {
  readonly calls: Array<{ operation: string; values: unknown[] }> = [];
  state: FinanceAgentSnapshot = {
    appServer: "ready",
    auth: "authenticated",
    consent: { status: "granted", version: "2026-08-31.v2" },
    host: "ready",
    models: {
      available: [{ efforts: ["low", "medium", "high"], model: "gpt-5.5", supportsFastMode: true }],
      selected: { effort: "medium", fastMode: false, model: "gpt-5.5" },
    },
    provider: providerSnapshot("ready", SCHEMA_CODEX_VERSION),
    session: null,
    turn: null,
    usage: null,
  };

  snapshot(): FinanceAgentSnapshot { return structuredClone(this.state); }
  async grantConsent(): Promise<void> { this.calls.push({ operation: "grant", values: [] }); }
  async revokeConsent(): Promise<void> { this.calls.push({ operation: "revoke", values: [] }); }
  async refreshProvider(): Promise<void> { this.calls.push({ operation: "refreshProvider", values: [] }); }
  async refreshModelCatalog(): Promise<void> {
    this.calls.push({ operation: "refreshModelCatalog", values: [] });
  }
  async createSession(
    sessionId: string,
    conversationId: string,
    selection?: FinanceModelSelection,
  ): Promise<void> {
    this.calls.push({ operation: "createSession", values: [sessionId, conversationId, selection] });
  }
  async closeSession(sessionId: string): Promise<void> {
    this.calls.push({ operation: "closeSession", values: [sessionId] });
  }
  async deleteConversation(conversationId: string): Promise<void> {
    this.calls.push({ operation: "deleteConversation", values: [conversationId] });
  }
  async startTurn(sessionId: string, turnId: string, prompt: string): Promise<void> {
    this.calls.push({ operation: "startTurn", values: [sessionId, turnId, prompt] });
  }
  async interruptTurn(): Promise<void> { this.calls.push({ operation: "interrupt", values: [] }); }
}

async function fixture(t: TestContext) {
  const service = new StubService();
  const gateway = new FinanceGateway({ capabilityToken: TOKEN, service });
  const { origin } = await gateway.start();
  t.after(() => gateway.stop());
  return { gateway, origin, service };
}

function request(origin: string, pathname: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${origin}${pathname}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });
}

test("finance gateway: requires a bearer capability and rejects browser-origin traffic", async (t) => {
  const { origin } = await fixture(t);
  assert.equal((await fetch(`${origin}/v1/status`)).status, 401);
  assert.equal((await fetch(`${origin}/v1/status?token=${TOKEN}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  })).status, 400);
  assert.equal((await request(origin, "/v1/status", { headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await request(origin, "/v1/status", { headers: { cookie: "session=foreign" } })).status, 401);
});

test("finance gateway: validates exact commands before invoking the service", async (t) => {
  const { origin, service } = await fixture(t);
  const created = await request(origin, "/v1/sessions", {
    body: JSON.stringify({
      conversation_id: "123e4567-e89b-42d3-a456-426614174000",
      model_selection: { effort: "medium", fast_mode: false, model: "gpt-5.5" },
      session_id: "session_1",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(created.status, 201);
  const turn = await request(origin, "/v1/turns", {
    body: JSON.stringify({ prompt: "Wie ist mein Stand?", session_id: "session_1", turn_id: "turn_1" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(turn.status, 202);
  assert.deepEqual(service.calls, [
    {
      operation: "createSession",
      values: [
        "session_1",
        "123e4567-e89b-42d3-a456-426614174000",
        { effort: "medium", fastMode: false, model: "gpt-5.5" },
      ],
    },
    { operation: "startTurn", values: ["session_1", "turn_1", "Wie ist mein Stand?"] },
  ]);

  const extended = await request(origin, "/v1/sessions", {
    body: JSON.stringify({
      conversation_id: "123e4567-e89b-42d3-a456-426614174000",
      extra: true,
      model_selection: { effort: "medium", fast_mode: false, model: "gpt-5.5" },
      session_id: "session_2",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(extended.status, 400);
  assert.equal(service.calls.length, 2);

  const deleted = await request(
    origin,
    "/v1/conversations/123e4567-e89b-42d3-a456-426614174000",
    { method: "DELETE" },
  );
  assert.equal(deleted.status, 200);
  assert.deepEqual(service.calls.at(-1), {
    operation: "deleteConversation",
    values: ["123e4567-e89b-42d3-a456-426614174000"],
  });
});

test("finance gateway: refreshes system Codex status without owning global login", async (t) => {
  const { origin, service } = await fixture(t);
  const refreshed = await request(origin, "/v1/provider/refresh", {
    body: "{}",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(refreshed.status, 200);
  assert.deepEqual(service.calls, [{ operation: "refreshProvider", values: [] }]);

  assert.equal((await request(origin, "/v1/auth/login", {
    body: "{}",
    headers: { "content-type": "application/json" },
    method: "POST",
  })).status, 404);
  assert.equal((await request(origin, "/v1/auth/logout", {
    body: "{}",
    headers: { "content-type": "application/json" },
    method: "POST",
  })).status, 404);
});

test("finance gateway: streams authenticated replayable events without cache", async (t) => {
  const { gateway, origin, service } = await fixture(t);
  gateway.publish({ snapshot: service.snapshot(), type: "state.changed" });
  const response = await request(origin, "/v1/events?after=0");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = response.body!.getReader();
  const first = await reader.read();
  const text = new TextDecoder().decode(first.value);
  assert.match(text, /id: 1/);
  assert.match(text, /state.changed/);
  await reader.cancel();
});

test("finance gateway: new subscribers receive current state instead of stale chat replay", async (t) => {
  const { gateway, origin, service } = await fixture(t);
  gateway.publish({
    messageId: "message_1",
    sessionId: "old_session",
    turnId: "old_turn",
    type: "assistant.message.started",
  });
  service.state = { ...service.state, auth: "logged_out" };

  const response = await request(origin, "/v1/events");
  const reader = response.body!.getReader();
  const first = await reader.read();
  const text = new TextDecoder().decode(first.value);

  assert.match(text, /event: reset/);
  assert.match(text, /logged_out/);
  assert.doesNotMatch(text, /assistant\.message\.started/);
  await reader.cancel();
});

test("finance gateway: uses safe error codes and body limits", async (t) => {
  const { origin } = await fixture(t);
  const invalid = await request(origin, "/v1/turns", {
    body: "{",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.deepEqual(await invalid.json(), { error: { code: "invalid_json" } });
  const oversized = await request(origin, "/v1/turns", {
    body: JSON.stringify({ prompt: "x".repeat(71 * 1024), session_id: "session_1", turn_id: "turn_1" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(oversized.status, 413);
});
