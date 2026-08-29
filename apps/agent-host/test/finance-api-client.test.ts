import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from "node:http";
import { afterEach, test } from "node:test";

import { FinanceApiClient, FinanceApiClientError } from "../src/finance-api-client.js";

const token = "synthetic-finance-assistant-token";
const receivableId = "123e4567-e89b-42d3-a456-426614174000";
const proposalId = "223e4567-e89b-42d3-a456-426614174000";
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

test("calls bounded finance reads with the in-memory credential", async () => {
  const requests: Array<{ authorization?: string; url?: string }> = [];
  const origin = await startServer((request, response) => {
    requests.push({
      ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
      ...(request.url ? { url: request.url } : {}),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [] }));
  });
  const client = new FinanceApiClient({ baseUrl: origin });
  client.setCredential(token);

  assert.deepEqual(await client.call("finance_list_transactions", { limit: 2 }), { data: [] });
  assert.deepEqual(requests, [{ authorization: `Bearer ${token}`, url: "/api/v1/finance-assistant/transactions?limit=2" }]);
  client.clearCredential();
  await assert.rejects(() => client.call("finance_list_transactions", {}), FinanceApiClientError);
});

test("adds host correlation only to proposal requests", async () => {
  let received: unknown;
  const origin = await startServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({
        data: {
          id: proposalId,
          action: "receivable_update",
          receivable_id: receivableId,
          debtor_name: "Synthetische Person",
          expected_version: 1,
          current_version: 1,
          status: "pending",
        },
      }));
    });
  });
  const client = new FinanceApiClient({ baseUrl: origin });
  client.setCredential(token);
  const correlation = {
    idempotencyKey: "323e4567-e89b-42d3-a456-426614174000",
    providerCallId: "call_1",
    providerThreadId: "thread_1",
    providerTurnId: "turn_1",
  };

  await client.call("finance_propose_receivable_update", {
    receivable_id: receivableId,
    expected_version: 1,
    rationale: "Synthetischer Vorschlag",
    changes: { description: "Synthetische Änderung" },
  }, { correlation });

  assert.deepEqual(received, {
    receivable_id: receivableId,
    expected_version: 1,
    rationale: "Synthetischer Vorschlag",
    action: "receivable_update",
    changes: { description: "Synthetische Änderung" },
    idempotency_key: correlation.idempotencyKey,
    provider_thread_id: "thread_1",
    provider_turn_id: "turn_1",
    provider_call_id: "call_1",
  });
});

test("maps a receivable creation to a targetless review proposal", async () => {
  let received: unknown;
  const origin = await startServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({
        data: {
          id: proposalId,
          action: "receivable_create",
          receivable_id: null,
          debtor_name: "Synthetische Person",
          expected_version: null,
          current_version: null,
          status: "pending",
        },
      }));
    });
  });
  const client = new FinanceApiClient({ baseUrl: origin });
  client.setCredential(token);
  const correlation = {
    idempotencyKey: "323e4567-e89b-42d3-a456-426614174000",
    providerCallId: "call_create",
    providerThreadId: "thread_1",
    providerTurnId: "turn_1",
  };

  assert.deepEqual(await client.call("finance_propose_receivable_create", {
    debtor_name: "Synthetische Person",
    original_amount: "3000.00",
    currency: "EUR",
    due_date: null,
    description: "Synthetisches Privatdarlehen",
    rationale: "Die neue Forderung soll geprüft werden.",
  }, { correlation }), {
    data: {
      id: proposalId,
      action: "receivable_create",
      receivable_id: null,
      debtor_name: "Synthetische Person",
      expected_version: null,
      current_version: null,
      status: "pending",
    },
  });
  assert.deepEqual(received, {
    rationale: "Die neue Forderung soll geprüft werden.",
    action: "receivable_create",
    receivable: {
      debtor_name: "Synthetische Person",
      original_amount: "3000.00",
      currency: "EUR",
      due_date: null,
      description: "Synthetisches Privatdarlehen",
    },
    idempotency_key: correlation.idempotencyKey,
    provider_thread_id: "thread_1",
    provider_turn_id: "turn_1",
    provider_call_id: "call_create",
  });
});

test("rejects non-loopback configuration and malformed upstream projections", async () => {
  assert.throws(() => new FinanceApiClient({ baseUrl: "https://example.com" }), FinanceApiClientError);
  const origin = await startServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [], leaked_secret: "must-not-pass" }));
  });
  const client = new FinanceApiClient({ baseUrl: origin });
  client.setCredential(token);
  await assert.rejects(
    () => client.call("finance_list_receivables", {}),
    (error: unknown) => error instanceof FinanceApiClientError && error.code === "invalid_response",
  );
});

test("stops buffering oversized responses and redacts upstream failures", async () => {
  const oversizedOrigin = await startServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"data":"');
    response.end("x".repeat(70_000));
  });
  const oversized = new FinanceApiClient({ baseUrl: oversizedOrigin });
  oversized.setCredential(token);
  await assert.rejects(
    () => oversized.call("finance_list_transactions", {}),
    (error: unknown) => error instanceof FinanceApiClientError && error.code === "response_too_large",
  );

  const rejectedOrigin = await startServer((_request, response) => {
    response.writeHead(422, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "sensitive upstream detail" } }));
  });
  const rejected = new FinanceApiClient({ baseUrl: rejectedOrigin });
  rejected.setCredential(token);
  await assert.rejects(
    () => rejected.call("finance_list_transactions", {}),
    (error: unknown) =>
      error instanceof FinanceApiClientError &&
      error.code === "rejected" &&
      !error.message.includes("sensitive"),
  );
});

test("fails closed on timeouts and redirects", async () => {
  const timeoutOrigin = await startServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [] }));
    }, 100);
  });
  const timed = new FinanceApiClient({ baseUrl: timeoutOrigin, timeoutMs: 10 });
  timed.setCredential(token);
  await assert.rejects(
    () => timed.call("finance_list_transactions", {}),
    (error: unknown) => error instanceof FinanceApiClientError && error.code === "unavailable",
  );

  const redirectOrigin = await startServer((_request, response) => {
    response.writeHead(302, { location: "http://127.0.0.1:1/untrusted" });
    response.end();
  });
  const redirected = new FinanceApiClient({ baseUrl: redirectOrigin });
  redirected.setCredential(token);
  await assert.rejects(
    () => redirected.call("finance_list_transactions", {}),
    (error: unknown) => error instanceof FinanceApiClientError && error.code === "unavailable",
  );
});

async function startServer(
  handler: RequestListener<typeof IncomingMessage, typeof ServerResponse>,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  return `http://127.0.0.1:${address.port}`;
}
