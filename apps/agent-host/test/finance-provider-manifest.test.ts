import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import { FINANCE_DYNAMIC_TOOLS } from "../src/finance-tool-contract.js";
import {
  buildFinanceInitializeParams,
  buildFinanceThreadStartParams,
} from "../src/finance-thread-contract.js";
import { JsonRpcClient } from "../src/json-rpc-client.js";

const codexEntry = resolve(
  dirname(new URL(import.meta.url).pathname),
  "../../node_modules/@openai/codex/bin/codex.js",
);

test("provider edge: real App Server exposes exactly the eight finance tools", async () => {
  const requests: Array<{ body: unknown; method: string; url: string }> = [];
  const provider = await startServer(async (request, response) => {
    const body = await readJsonBody(request);
    requests.push({ body, method: request.method ?? "", url: request.url ?? "" });
    const stream = [
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp-finance-manifest"}}',
      "",
      "event: response.completed",
      'data: {"type":"response.completed","response":{"id":"resp-finance-manifest","usage":{"input_tokens":0,"input_tokens_details":null,"output_tokens":0,"output_tokens_details":null,"total_tokens":0}}}',
      "",
      "",
    ].join("\n");
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(stream),
      "content-type": "text/event-stream",
    });
    response.end(stream);
  });
  const temporaryRoot = mkdtempSync(join(tmpdir(), "finance-os-provider-manifest-"));
  const codexHome = join(temporaryRoot, "codex-home");
  mkdirSync(codexHome, { mode: 0o700 });
  writeFileSync(join(codexHome, "config.toml"), [
    'model = "gpt-5.1-codex-mini"',
    'model_provider = "finance_test"',
    "",
    "[model_providers.finance_test]",
    'name = "Synthetic Finance Provider"',
    `base_url = "${provider.origin}/v1"`,
    'wire_api = "responses"',
    "requires_openai_auth = false",
    "supports_websockets = false",
    "request_max_retries = 0",
    "stream_max_retries = 0",
    "",
    "[analytics]",
    "enabled = false",
    "",
  ].join("\n"), { mode: 0o600 });
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
  let resolveTurnCompleted: (() => void) | undefined;
  const turnCompleted = new Promise<void>((resolve) => { resolveTurnCompleted = resolve; });
  const rpc = new JsonRpcClient({
    input: child.stdout,
    output: child.stdin,
    defaultTimeoutMs: 15_000,
    onNotification: ({ method }) => {
      if (method === "turn/completed") resolveTurnCompleted?.();
    },
    onServerRequest: async ({ method }) => { throw new Error(`Unexpected request: ${method}`); },
  });

  try {
    await rpc.request("initialize", buildFinanceInitializeParams("0.1.0"));
    const started = await rpc.request("thread/start", buildFinanceThreadStartParams()) as {
      thread: { id: string };
    };
    await rpc.request("turn/start", {
      threadId: started.thread.id,
      input: [{ type: "text", text: "Zeige meinen Finanzüberblick.", text_elements: [] }],
      approvalPolicy: "never",
      approvalsReviewer: "user",
    });
    await withTimeout(turnCompleted, 15_000, "Finance manifest turn timed out");

    const responseRequests = requests.filter(({ method, url }) => method === "POST" && url === "/v1/responses");
    assert.equal(responseRequests.length, 1);
    const body = responseRequests[0]?.body as { tools?: unknown[] };
    assert.deepEqual(body.tools, expectedProviderTools());
  } finally {
    rpc.close();
    child.kill("SIGTERM");
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolveClose) => child.once("close", resolveClose));
    }
    await provider.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

function expectedProviderTools(): unknown[] {
  return FINANCE_DYNAMIC_TOOLS.map((namespace) => {
    assert.equal(namespace.type, "namespace");
    return {
      type: "namespace",
      name: namespace.name,
      description: namespace.description,
      tools: namespace.tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        strict: false,
        parameters: providerSanitizedSchema(tool.inputSchema),
      })).sort((left, right) => left.name.localeCompare(right.name)),
    };
  });
}

function providerSanitizedSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(providerSanitizedSchema);
  if (typeof value !== "object" || value === null) return value;
  const removedKeywords = new Set([
    "maxItems",
    "maxLength",
    "maximum",
    "minItems",
    "minLength",
    "minProperties",
    "minimum",
    "pattern",
  ]);
  const sanitized = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !removedKeywords.has(key))
      .map(([key, nested]) => [key, providerSanitizedSchema(nested)]),
  );
  if (!("type" in sanitized) && Array.isArray(sanitized.enum) && sanitized.enum.every((item) => typeof item === "string")) {
    return { ...sanitized, type: "string" };
  }
  return sanitized;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > 1024 * 1024) throw new Error("Synthetic provider request is too large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function startServer(
  handler: RequestListener<typeof IncomingMessage, typeof ServerResponse>,
): Promise<{ close: () => Promise<void>; origin: string }> {
  const server: Server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch(() => {
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
      response.end('{"error":"synthetic provider failed"}');
    });
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing synthetic provider address");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
}
