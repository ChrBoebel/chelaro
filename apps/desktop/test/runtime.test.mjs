import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  apiEnvironment,
  createSourceCredentials,
  existingSourceCredentials,
  hostEnvironment,
  isAllowedNavigation,
  isFinanceApiAvailable,
  isFinanceApiReady,
  isFinanceWebAvailable,
  findAvailablePort,
  sqliteDatabaseUrl,
  startFinanceAgentHost,
  waitForUrl,
  webEnvironment,
} from "../src/runtime.mjs";

test("navigation remains on the local Chelaro origin", () => {
  assert.equal(isAllowedNavigation("http://127.0.0.1:3000/api/documents", "http://127.0.0.1:3000"), true);
  assert.equal(isAllowedNavigation("https://example.com", "http://127.0.0.1:3000"), false);
  assert.equal(isAllowedNavigation("file:///tmp/document", "http://127.0.0.1:3000"), false);
});

test("API detection verifies the Chelaro service identity", async () => {
  const matchingFetch = async () => new Response(
    JSON.stringify({ status: "ok", service: "Chelaro API" }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  const unrelatedFetch = async () => new Response(
    JSON.stringify({ status: "ok", service: "Other API" }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

  assert.equal(await isFinanceApiAvailable(matchingFetch), true);
  assert.equal(await isFinanceApiAvailable(unrelatedFetch), false);
});

test("API readiness rejects a healthy service without a database", async () => {
  const readyFetch = async () => new Response(
    JSON.stringify({ status: "ready", service: "Chelaro API" }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  const unavailableFetch = async () => new Response(
    JSON.stringify({ error: { code: "database_unavailable" } }),
    { status: 503, headers: { "content-type": "application/json" } },
  );

  assert.equal(await isFinanceApiReady(readyFetch), true);
  assert.equal(await isFinanceApiReady(unavailableFetch), false);
});

test("web detection rejects an unrelated service on the configured port", async () => {
  assert.equal(
    await isFinanceWebAvailable(async () => new Response("<title>Chelaro</title>")),
    true,
  );
  assert.equal(
    await isFinanceWebAvailable(async () => new Response("<title>Other</title>")),
    false,
  );
});

test("readiness polling accepts a validated response", async () => {
  let requests = 0;
  await waitForUrl("http://service.test/ready", {
    timeoutMs: 1_000,
    fetchImplementation: async () => {
      requests += 1;
      return new Response(null, { status: requests === 1 ? 503 : 200 });
    },
  });
  assert.equal(requests, 2);
});

test("packaged runtime allocates a loopback port", async () => {
  const port = await findAvailablePort();
  assert.equal(Number.isInteger(port), true);
  assert.equal(port > 0 && port <= 65_535, true);
});

test("desktop database URL uses an absolute SQLite path", () => {
  assert.equal(
    sqliteDatabaseUrl("/tmp/Chelaro/data.sqlite3"),
    "sqlite+aiosqlite:////tmp/Chelaro/data.sqlite3",
  );
});

test("source credentials are distinct high-entropy capabilities", () => {
  const credentials = createSourceCredentials();
  assert.match(credentials.ownerToken, /^[a-f0-9]{64}$/);
  assert.match(credentials.financeAssistantToken, /^[a-f0-9]{64}$/);
  assert.notEqual(credentials.ownerToken, credentials.financeAssistantToken);
});

test("existing source services keep owner access while assistant access remains deny by default", () => {
  assert.deepEqual(
    existingSourceCredentials({
      FINANCE_OS_API_TOKEN: "owner-capability-123456789",
      FINANCE_OS_FINANCE_ASSISTANT_TOKEN: "assistant-capability-123456789",
    }),
    {
      ownerToken: "owner-capability-123456789",
      financeAssistantToken: "assistant-capability-123456789",
    },
  );
  assert.deepEqual(
    existingSourceCredentials({ FINANCE_OS_API_TOKEN: "only-owner-token-1234" }),
    { ownerToken: "only-owner-token-1234", financeAssistantToken: undefined },
  );
  assert.deepEqual(
    existingSourceCredentials({
      FINANCE_OS_API_TOKEN: "same-capability-123456",
      FINANCE_OS_FINANCE_ASSISTANT_TOKEN: "same-capability-123456",
    }),
    { ownerToken: "same-capability-123456", financeAssistantToken: undefined },
  );
  assert.equal(existingSourceCredentials({ FINANCE_OS_API_TOKEN: "too-short" }), undefined);
});

test("desktop partitions API, web, and host capabilities", () => {
  const inherited = {
    FINANCE_OS_AGENT_TOKEN: "legacy-agent-secret",
    FINANCE_OS_API_TOKEN: "old-owner-secret",
    FINANCE_OS_FINANCE_ASSISTANT_TOKEN: "old-assistant-secret",
    FINANCE_OS_FINANCE_GATEWAY_TOKEN: "old-gateway-secret",
    FINANCE_OS_FINANCE_GATEWAY_URL: "http://127.0.0.1:1",
    FINANCE_OS_DATABASE_URL: "postgresql://must-not-cross",
    FINANCE_OS_DOCUMENT_ROOT: "/private/documents",
    FINANCE_OS_POSTGRES_PASSWORD: "must-not-cross",
    FINANCE_OS_QUARANTINE_ROOT: "/private/quarantine",
    LANG: "de_DE.UTF-8",
    PATH: "/usr/bin",
    SAFE_SETTING: "kept",
  };
  const credentials = {
    ownerToken: "new-owner-capability-123456",
    financeAssistantToken: "new-assistant-capability-123456",
  };
  const assistant = {
    gatewayOrigin: "http://127.0.0.1:43210",
    gatewayToken: "a".repeat(64),
  };

  assert.deepEqual(apiEnvironment(inherited, credentials), {
    FINANCE_OS_API_TOKEN: credentials.ownerToken,
    FINANCE_OS_FINANCE_ASSISTANT_TOKEN: credentials.financeAssistantToken,
    FINANCE_OS_DATABASE_URL: "postgresql://must-not-cross",
    FINANCE_OS_DOCUMENT_ROOT: "/private/documents",
    FINANCE_OS_POSTGRES_PASSWORD: "must-not-cross",
    FINANCE_OS_QUARANTINE_ROOT: "/private/quarantine",
    LANG: "de_DE.UTF-8",
    PATH: "/usr/bin",
    SAFE_SETTING: "kept",
  });
  assert.deepEqual(webEnvironment(inherited, credentials.ownerToken, assistant), {
    FINANCE_OS_API_TOKEN: credentials.ownerToken,
    FINANCE_OS_FINANCE_GATEWAY_TOKEN: assistant.gatewayToken,
    FINANCE_OS_FINANCE_GATEWAY_URL: assistant.gatewayOrigin,
    LANG: "de_DE.UTF-8",
    PATH: "/usr/bin",
    SAFE_SETTING: "kept",
  });
  assert.deepEqual(hostEnvironment(inherited, "/tmp/chelaro-agent"), {
    FINANCE_OS_AGENT_DATA_ROOT: "/tmp/chelaro-agent",
    LANG: "de_DE.UTF-8",
    PATH: "/usr/bin",
  });
});

test("finance host receives secrets only after its authenticated IPC handshake", async () => {
  const child = new EventEmitter();
  let startOptions;
  let configuredMessage;
  child.send = (message) => {
    configuredMessage = message;
    setImmediate(() => child.emit("message", {
      gatewayOrigin: "http://127.0.0.1:43210",
      protocolVersion: 1,
      requestId: message.requestId,
      type: "finance.configured",
    }));
  };
  const processManager = {
    repoRoot: "/repo",
    startForked(_label, _modulePath, options) {
      startOptions = options;
      setImmediate(() => child.emit("message", {
        protocolVersion: 1,
        type: "finance.ready_for_configuration",
      }));
      return child;
    },
  };

  const result = await startFinanceAgentHost(processManager, {
    agentDataRoot: "/tmp/chelaro-agent",
    environment: {
      FINANCE_OS_API_TOKEN: "must-not-cross",
      FINANCE_OS_FINANCE_ASSISTANT_TOKEN: "must-not-cross",
      PATH: "/usr/bin",
    },
    financeApiToken: "assistant-capability-123456789",
    financeApiUrl: "http://127.0.0.1:8000/",
  });

  assert.equal(startOptions.env.FINANCE_OS_FINANCE_ASSISTANT_TOKEN, undefined);
  assert.equal(startOptions.env.FINANCE_OS_FINANCE_GATEWAY_TOKEN, undefined);
  assert.equal(configuredMessage.financeApiToken, "assistant-capability-123456789");
  assert.match(configuredMessage.gatewayToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(result, {
    gatewayOrigin: "http://127.0.0.1:43210",
    gatewayToken: configuredMessage.gatewayToken,
  });
});
