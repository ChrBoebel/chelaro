import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  JsonRpcClient,
  JsonRpcDeferredServerError,
  JsonRpcDeferredServerResponse,
  JsonRpcServerRequestError,
  JsonRpcTransportError,
} from "../src/json-rpc-client.js";

function harness(options: { maxFrameBytes?: number; maxPendingRequests?: number } = {}) {
  const fromServer = new PassThrough();
  const toServer = new PassThrough();
  const notifications: unknown[] = [];
  const fatals: JsonRpcTransportError[] = [];
  const client = new JsonRpcClient({
    input: fromServer,
    output: toServer,
    onFatalError: (error) => fatals.push(error),
    onNotification: (notification) => notifications.push(notification),
    onServerRequest: async ({ method }) => ({ handled: method }),
    ...options,
  });
  return { client, fatals, fromServer, notifications, toServer };
}

test("json-rpc client: correlates responses and dispatches notifications and server requests", async () => {
  const { client, fromServer, notifications, toServer } = harness();
  const outbound: Buffer[] = [];
  toServer.on("data", (chunk: Buffer) => outbound.push(chunk));

  const result = client.request("thread/start", { cwd: "/workspace" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(Buffer.concat(outbound).toString(), /"method":"thread\/start"/);
  fromServer.write('{"method":"thread/started","params":{"id":"t"}}\n');
  fromServer.write('{"emittedAtMs":123,"method":"thread/status","params":{"ready":true}}\n');
  fromServer.write('{"id":1,"result":{"id":"t"}}\n');
  assert.deepEqual(await result, { id: "t" });
  assert.deepEqual(notifications, [
    { method: "thread/started", params: { id: "t" } },
    { emittedAtMs: 123, method: "thread/status", params: { ready: true } },
  ]);

  fromServer.write('{"id":7,"method":"approval","params":{}}\n');
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(Buffer.concat(outbound).toString(), /"id":7,"result":{"handled":"approval"}/);
  client.close();
});

test("json-rpc client: enforces pending limits and request timeouts", async () => {
  const { client } = harness({ maxPendingRequests: 1 });
  const pending = client.request("one", {}, 20);
  await assert.rejects(client.request("two", {}), (error: unknown) => {
    assert(error instanceof JsonRpcTransportError);
    return error.code === "queue_full";
  });
  await assert.rejects(pending, (error: unknown) => {
    assert(error instanceof JsonRpcTransportError);
    return error.code === "operation_timed_out";
  });
  assert.equal(client.pendingRequestCount, 0);
  client.close();
});

test("json-rpc client: rejects invalid methods without reserving queue capacity", async () => {
  const { client } = harness({ maxPendingRequests: 1 });
  await assert.rejects(client.request("", {}), /1 to 256 characters/);
  assert.equal(client.pendingRequestCount, 0);
  const pending = client.request("valid", {}, 10);
  assert.equal(client.pendingRequestCount, 1);
  await assert.rejects(pending, /timed out/);
  client.close();
});

test("json-rpc client: fails closed on malformed, oversized, and unknown response frames", async () => {
  for (const frame of [
    "not-json\n",
    '{"id":999,"result":{}}\n',
    '{"id":1,"result":{},"extra":true}\n',
  ]) {
    const { client, fatals, fromServer } = harness();
    fromServer.write(frame);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fatals[0]?.code, "invalid_frame");
    await assert.rejects(client.request("after-fatal", {}), /closed/);
  }

  const { client, fatals, fromServer } = harness({ maxFrameBytes: 8 });
  fromServer.write(Buffer.from("123456789"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fatals[0]?.code, "frame_too_large");
  client.close();
});

test("json-rpc client: validates error envelopes before resolving pending state", async () => {
  const { client, fatals, fromServer } = harness();
  const pending = client.request("test", {});
  fromServer.write('{"id":1,"error":"raw upstream text"}\n');
  await assert.rejects(pending, /error response is invalid/);
  assert.equal(fatals[0]?.code, "invalid_frame");
  assert.equal(client.pendingRequestCount, 0);
});

test("json-rpc client: rejects all pending work when the child stream exits", async () => {
  const { client, fatals, fromServer } = harness();
  const first = client.request("one", {});
  const second = client.request("two", {});
  fromServer.end();
  await assert.rejects(first, /output ended/);
  await assert.rejects(second, /output ended/);
  assert.equal(fatals[0]?.code, "transport_failed");
});

test("json-rpc client: bounds outbound frames and drains backpressure", async () => {
  const { client, toServer } = harness({ maxFrameBytes: 40 });
  await assert.rejects(client.notify("large", { value: "x".repeat(100) }), (error: unknown) => {
    assert(error instanceof JsonRpcTransportError);
    return error.code === "frame_too_large";
  });

  const originalWrite = toServer.write.bind(toServer);
  let blocked = true;
  Object.assign(toServer, {
    write: (...args: Parameters<typeof toServer.write>) => {
      originalWrite(...args);
      if (blocked) {
        blocked = false;
        setImmediate(() => toServer.emit("drain"));
        return false;
      }
      return true;
    },
  });
  await client.notify("ok", {});
  client.close();
});

test("json-rpc client: runs abort hooks only after terminal server responses are written", async () => {
  const fromServer = new PassThrough();
  const toServer = new PassThrough();
  const events: string[] = [];
  toServer.on("data", (chunk: Buffer) => events.push(`write:${chunk.toString("utf8").trim()}`));
  const client = new JsonRpcClient({
    input: fromServer,
    output: toServer,
    onNotification: () => undefined,
    onServerRequest: async ({ id }) => id === 1
      ? new JsonRpcDeferredServerResponse({ decision: "decline" }, () => { events.push("abort:response"); })
      : new JsonRpcDeferredServerError(
          new JsonRpcServerRequestError(-32_601, "Method not supported"),
          () => { events.push("abort:error"); },
        ),
  });

  fromServer.write('{"id":1,"method":"unsafe","params":{}}\n');
  fromServer.write('{"id":2,"method":"unknown","params":{}}\n');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events, [
    'write:{"id":1,"result":{"decision":"decline"}}',
    "abort:response",
    'write:{"error":{"code":-32601,"message":"Method not supported"},"id":2}',
    "abort:error",
  ]);
  client.close();
});
