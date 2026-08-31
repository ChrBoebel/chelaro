import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { FinanceApiClient } from "../src/finance-api-client.js";
import { FinanceServerRequestHandler } from "../src/finance-server-request-handler.js";
import { buildFinanceInitializeParams, buildFinanceThreadStartParams } from "../src/finance-thread-contract.js";
import { FinanceToolDispatcher, type FinanceToolApi } from "../src/finance-tool-dispatcher.js";
import { JsonRpcClient } from "../src/json-rpc-client.js";

const codexEntry = resolve(
  dirname(new URL(import.meta.url).pathname),
  "../../node_modules/@openai/codex/bin/codex.js",
);

test("provider edge: real App Server completes a finance tool round trip", async () => {
  const providerRequests: unknown[] = [];
  const provider = await startProvider((requestIndex) => {
    if (requestIndex === 0) return toolCallStream();
    if (requestIndex === 1) return assistantMessageStream("Der sichere Finanzüberblick wurde geladen.");
    throw new Error("Synthetic provider received an unexpected retry.");
  }, providerRequests);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "finance-os-provider-tool-"));
  const codexHome = join(temporaryRoot, "codex-home");
  mkdirSync(codexHome, { mode: 0o700 });
  writeFileSync(join(codexHome, "config.toml"), providerConfig(provider.origin), { mode: 0o600 });
  const child = spawn(process.execPath, [codexEntry, "app-server", "--stdio", "--strict-config"], {
    cwd: temporaryRoot,
    env: {
      CODEX_HOME: codexHome,
      HOME: temporaryRoot,
      LANG: "C.UTF-8",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      TMPDIR: temporaryRoot,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const apiCalls: string[] = [];
  const api: FinanceToolApi = {
    call: async (name) => {
      apiCalls.push(name);
      return { currency: "EUR", period: "2026-08", balance: "1250.00" };
    },
  };
  const consent = { assertGranted: () => undefined };
  const dispatcher = new FinanceToolDispatcher(api, consent);
  let handler: FinanceServerRequestHandler | undefined;
  let bindTurn: (() => void) | undefined;
  const turnBound = new Promise<void>((resolveBound) => { bindTurn = resolveBound; });
  let assistantText = "";
  let resolveCompleted: (() => void) | undefined;
  const completed = new Promise<void>((resolve) => { resolveCompleted = resolve; });
  const rpc = new JsonRpcClient({
    input: child.stdout,
    output: child.stdin,
    defaultTimeoutMs: 15_000,
    onNotification: ({ method, params }) => {
      if (method === "item/agentMessage/delta") assistantText += (params as { delta: string }).delta;
      if (method === "turn/completed") resolveCompleted?.();
    },
    onServerRequest: async (request) => {
      await turnBound;
      if (!handler) throw new Error("Finance handler was not bound.");
      return handler.handle(request);
    },
  });

  try {
    await rpc.request("initialize", buildFinanceInitializeParams("0.1.0"));
    const started = await rpc.request("thread/start", buildFinanceThreadStartParams()) as { thread: { id: string } };
    dispatcher.startSession({
      consentVersion: "2026-08-31.v2",
      hostEpoch: "host_epoch_1",
      providerThreadId: started.thread.id,
      sessionId: "session_1",
    });
    handler = new FinanceServerRequestHandler({ dispatcher, onAbortTurn: () => undefined });
    const turnStarted = await rpc.request("turn/start", {
      input: [{ text: "Zeige meinen Finanzüberblick.", text_elements: [], type: "text" }],
      threadId: started.thread.id,
    }) as { turn: { id: string } };
    dispatcher.startTurn({ providerTurnId: turnStarted.turn.id });
    bindTurn?.();
    await withTimeout(completed, 15_000);

    assert.deepEqual(apiCalls, ["finance_get_overview"]);
    assert.equal(providerRequests.length, 2);
    assert.match(JSON.stringify(providerRequests[1]), /function_call_output|custom_tool_call_output/);
    assert.equal(assistantText, "Der sichere Finanzüberblick wurde geladen.");
  } finally {
    rpc.close();
    child.kill("SIGTERM");
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolveClose) => child.once("close", resolveClose));
    }
    await provider.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("provider edge: real App Server corrects invalid proposal arguments exactly once", async () => {
  const privateMarker = "PRIVATE_SYNTHETIC_MARKER";
  const providerRequests: unknown[] = [];
  const provider = await startProvider((requestIndex) => {
    if (requestIndex === 0) {
      return proposalToolCallStream("finance_bad_call", {
        debtor_name: privateMarker,
        original_amount: 500,
        currency: "EUR",
        description: "Synthetischer Zweck",
        rationale: "Synthetischer Vorschlag",
      });
    }
    if (requestIndex === 1) {
      return proposalToolCallStream("finance_corrected_call", {
        debtor_name: privateMarker,
        original_amount: "500.00",
        currency: "EUR",
        description: "Synthetischer Zweck",
        rationale: "Synthetischer Vorschlag",
      });
    }
    if (requestIndex === 2) return assistantMessageStream("Der prüfpflichtige Vorschlag wurde erstellt.");
    throw new Error("Synthetic provider received an unexpected retry.");
  }, providerRequests);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "finance-os-provider-correction-"));
  const codexHome = join(temporaryRoot, "codex-home");
  mkdirSync(codexHome, { mode: 0o700 });
  writeFileSync(join(codexHome, "config.toml"), providerConfig(provider.origin), { mode: 0o600 });
  const child = spawn(process.execPath, [codexEntry, "app-server", "--stdio", "--strict-config"], {
    cwd: temporaryRoot,
    env: {
      CODEX_HOME: codexHome,
      HOME: temporaryRoot,
      LANG: "C.UTF-8",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      TMPDIR: temporaryRoot,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const externalApi = financeE2eApiFromEnvironment();
  const apiCalls: Array<{ argumentsValue: Record<string, unknown>; name: string }> = [];
  const api: FinanceToolApi = {
    call: async (name, argumentsValue, options) => {
      apiCalls.push({ name, argumentsValue });
      if (externalApi) return externalApi.client.call(name, argumentsValue, options);
      return { id: "223e4567-e89b-42d3-a456-426614174000", status: "pending" };
    },
  };
  const dispatcher = new FinanceToolDispatcher(api, { assertGranted: () => undefined });
  let handler: FinanceServerRequestHandler | undefined;
  let bindTurn: (() => void) | undefined;
  const turnBound = new Promise<void>((resolveBound) => { bindTurn = resolveBound; });
  let assistantText = "";
  let resolveCompleted: (() => void) | undefined;
  const completed = new Promise<void>((resolve) => { resolveCompleted = resolve; });
  const rpc = new JsonRpcClient({
    input: child.stdout,
    output: child.stdin,
    defaultTimeoutMs: 15_000,
    onNotification: ({ method, params }) => {
      if (method === "item/agentMessage/delta") assistantText += (params as { delta: string }).delta;
      if (method === "turn/completed") resolveCompleted?.();
    },
    onServerRequest: async (request) => {
      await turnBound;
      if (!handler) throw new Error("Finance handler was not bound.");
      return handler.handle(request);
    },
  });

  try {
    await rpc.request("initialize", buildFinanceInitializeParams("0.1.0"));
    const started = await rpc.request("thread/start", buildFinanceThreadStartParams()) as { thread: { id: string } };
    dispatcher.startSession({
      consentVersion: "2026-08-31.v2",
      hostEpoch: "host_epoch_1",
      providerThreadId: started.thread.id,
      sessionId: "session_1",
    });
    handler = new FinanceServerRequestHandler({ dispatcher, onAbortTurn: () => undefined });
    const turnStarted = await rpc.request("turn/start", {
      input: [{ text: "Erstelle einen synthetischen Forderungsvorschlag.", text_elements: [], type: "text" }],
      threadId: started.thread.id,
    }) as { turn: { id: string } };
    dispatcher.startTurn({ providerTurnId: turnStarted.turn.id });
    bindTurn?.();
    await withTimeout(completed, 15_000);

    assert.equal(providerRequests.length, 3);
    const firstToolOutputs = toolOutputsOf(providerRequests[1]);
    assert.match(JSON.stringify(firstToolOutputs), /invalid_arguments/);
    assert.doesNotMatch(JSON.stringify(firstToolOutputs), new RegExp(privateMarker));
    assert.deepEqual(apiCalls, [{
      name: "finance_propose_receivable_create",
      argumentsValue: {
        debtor_name: privateMarker,
        original_amount: "500.00",
        currency: "EUR",
        description: "Synthetischer Zweck",
        rationale: "Synthetischer Vorschlag",
      },
    }]);
    assert.equal(assistantText, "Der prüfpflichtige Vorschlag wurde erstellt.");
    if (externalApi) await assertIsolatedProposalState(externalApi);
  } finally {
    rpc.close();
    child.kill("SIGTERM");
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolveClose) => child.once("close", resolveClose));
    }
    await provider.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

interface ExternalFinanceE2eApi {
  baseUrl: string;
  client: FinanceApiClient;
  ownerToken: string;
}

function financeE2eApiFromEnvironment(): ExternalFinanceE2eApi | undefined {
  const baseUrl = process.env.FINANCE_E2E_API_BASE_URL;
  const assistantToken = process.env.FINANCE_E2E_ASSISTANT_TOKEN;
  const ownerToken = process.env.FINANCE_E2E_OWNER_TOKEN;
  if (!baseUrl && !assistantToken && !ownerToken) return undefined;
  if (!baseUrl || !assistantToken || !ownerToken) {
    throw new Error("The isolated finance E2E API configuration is incomplete.");
  }
  const client = new FinanceApiClient({ baseUrl });
  client.setCredential(assistantToken);
  return { baseUrl, client, ownerToken };
}

async function assertIsolatedProposalState(externalApi: ExternalFinanceE2eApi): Promise<void> {
  const headers = { Authorization: `Bearer ${externalApi.ownerToken}` };
  const proposalsResponse = await fetch(
    new URL("/api/v1/finance/change-proposals?pending_only=true", externalApi.baseUrl),
    { headers },
  );
  assert.equal(proposalsResponse.status, 200);
  const proposals = await proposalsResponse.json() as { data: Array<{ action: string; status: string }> };
  assert.deepEqual(proposals.data.map(({ action, status }) => ({ action, status })), [{
    action: "receivable_create",
    status: "pending",
  }]);

  const receivablesResponse = await fetch(
    new URL("/api/v1/finance/receivables", externalApi.baseUrl),
    { headers },
  );
  assert.equal(receivablesResponse.status, 200);
  assert.deepEqual(await receivablesResponse.json(), { data: [] });
}

function toolCallStream(): string {
  const item = {
    arguments: '{"period":"2026-08","currency":"EUR"}',
    call_id: "finance_call_1",
    id: "fc_finance_1",
    name: "finance_get_overview",
    namespace: null,
    status: "completed",
    type: "function_call",
  };
  return sse([
    ["response.created", { response: { id: "resp_finance_tool" }, type: "response.created" }],
    ["response.output_item.done", { item, output_index: 0, type: "response.output_item.done" }],
    ["response.completed", { response: completedResponse("resp_finance_tool", [item]), type: "response.completed" }],
  ]);
}

function proposalToolCallStream(callId: string, argumentsValue: Record<string, unknown>): string {
  const item = {
    arguments: JSON.stringify(argumentsValue),
    call_id: callId,
    id: `fc_${callId}`,
    name: "finance_propose_receivable_create",
    namespace: null,
    status: "completed",
    type: "function_call",
  };
  return sse([
    ["response.created", { response: { id: `resp_${callId}` }, type: "response.created" }],
    ["response.output_item.done", { item, output_index: 0, type: "response.output_item.done" }],
    ["response.completed", { response: completedResponse(`resp_${callId}`, [item]), type: "response.completed" }],
  ]);
}

function assistantMessageStream(text: string): string {
  const pendingItem = {
    content: [],
    id: "msg_finance_1",
    role: "assistant",
    status: "in_progress",
    type: "message",
  };
  const part = { annotations: [], text, type: "output_text" };
  const item = {
    content: [part],
    id: "msg_finance_1",
    role: "assistant",
    status: "completed",
    type: "message",
  };
  return sse([
    ["response.created", { response: { id: "resp_finance_answer" }, type: "response.created" }],
    ["response.output_item.added", { item: pendingItem, output_index: 0, type: "response.output_item.added" }],
    ["response.content_part.added", {
      content_index: 0,
      item_id: item.id,
      output_index: 0,
      part: { annotations: [], text: "", type: "output_text" },
      type: "response.content_part.added",
    }],
    ["response.output_text.delta", {
      content_index: 0,
      delta: text,
      item_id: item.id,
      logprobs: [],
      output_index: 0,
      type: "response.output_text.delta",
    }],
    ["response.output_text.done", {
      content_index: 0,
      item_id: item.id,
      logprobs: [],
      output_index: 0,
      text,
      type: "response.output_text.done",
    }],
    ["response.content_part.done", {
      content_index: 0,
      item_id: item.id,
      output_index: 0,
      part,
      type: "response.content_part.done",
    }],
    ["response.output_item.done", { item, output_index: 0, type: "response.output_item.done" }],
    ["response.completed", { response: completedResponse("resp_finance_answer", [item]), type: "response.completed" }],
  ]);
}

function completedResponse(id: string, output: unknown[]): Record<string, unknown> {
  return {
    id,
    output,
    usage: {
      input_tokens: 1,
      input_tokens_details: null,
      output_tokens: 1,
      output_tokens_details: null,
      total_tokens: 2,
    },
  };
}

function sse(events: Array<[string, Record<string, unknown>]>): string {
  return `${events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n`).join("\n")}\n`;
}

function providerConfig(origin: string): string {
  return [
    'model = "gpt-5.1-codex-mini"',
    'model_provider = "finance_test"',
    "",
    "[model_providers.finance_test]",
    'name = "Synthetic Finance Provider"',
    `base_url = "${origin}/v1"`,
    'wire_api = "responses"',
    "requires_openai_auth = false",
    "supports_websockets = false",
    "request_max_retries = 0",
    "stream_max_retries = 0",
    "",
    "[analytics]",
    "enabled = false",
    "",
  ].join("\n");
}

async function startProvider(
  responseFor: (requestIndex: number) => string,
  requests: unknown[],
): Promise<{ close: () => Promise<void>; origin: string }> {
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void readJsonBody(request).then((body) => {
      const stream = responseFor(requests.length);
      requests.push(body);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(stream),
        "content-type": "text/event-stream",
      });
      response.end(stream);
    }).catch(() => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end('{"error":"synthetic provider failed"}');
    });
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing provider address.");
  return {
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
    origin: `http://127.0.0.1:${address.port}`,
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function toolOutputsOf(value: unknown): unknown[] {
  const outputs: unknown[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    const record = candidate as Record<string, unknown>;
    if (record.type === "function_call_output" || record.type === "custom_tool_call_output") {
      outputs.push(record);
    }
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(value);
  return outputs;
}

async function withTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Finance provider round trip timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
