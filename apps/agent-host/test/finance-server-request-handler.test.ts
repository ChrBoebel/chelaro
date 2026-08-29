import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FinanceServerRequestHandler,
} from "../src/finance-server-request-handler.js";
import {
  JsonRpcDeferredServerError,
  JsonRpcDeferredServerResponse,
} from "../src/json-rpc-client.js";

test("finance request handler delegates the exact dynamic tool call", async () => {
  const calls: unknown[] = [];
  const handler = new FinanceServerRequestHandler({
    dispatcher: {
      dispatch: async (params) => {
        calls.push(params);
        return {
          abortTurn: false,
          response: { success: true, contentItems: [{ type: "inputText", text: "{}" }] },
        };
      },
    },
    onAbortTurn: () => assert.fail("A valid tool must not abort the turn"),
  });
  const params = {
    threadId: "thread",
    turnId: "turn",
    callId: "call",
    namespace: "chelaro_finance",
    tool: "finance_get_overview",
    arguments: {},
  };

  assert.deepEqual(await handler.handle({ id: 1, method: "item/tool/call", params }), {
    success: true,
    contentItems: [{ type: "inputText", text: "{}" }],
  });
  assert.deepEqual(calls, [params]);
});

test("finance request handler denies execution and defers interruption until after the response", async () => {
  let aborted = false;
  const handler = new FinanceServerRequestHandler({
    dispatcher: { dispatch: async () => { throw new Error("Dispatcher must not be reached"); } },
    onAbortTurn: () => { aborted = true; },
  });

  const outcome = await handler.handle({
    id: 2,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread",
      turnId: "turn",
      itemId: "item",
      startedAtMs: 1,
      environmentId: null,
      command: "pwd",
      cwd: "/",
      networkApprovalContext: null,
      proposedExecpolicyAmendment: null,
      proposedNetworkPolicyAmendments: null,
      reason: null,
      commandActions: null,
      additionalPermissions: null,
    },
  });

  assert(outcome instanceof JsonRpcDeferredServerResponse);
  assert.equal(aborted, false);
  assert.deepEqual(outcome.result, { decision: "decline" });
  await outcome.afterResponse();
  assert.equal(aborted, true);
});

test("finance request handler fails closed on unsupported and malformed requests", async () => {
  const handler = new FinanceServerRequestHandler({
    dispatcher: { dispatch: async () => { throw new Error("Dispatcher must not be reached"); } },
    onAbortTurn: () => undefined,
  });
  const unsupported = await handler.handle({ id: 3, method: "attestation/generate", params: {} });
  assert(unsupported instanceof JsonRpcDeferredServerError);
  assert.equal(unsupported.error.code, -32_601);

  const malformed = await handler.handle({
    id: 4,
    method: "item/tool/call",
    params: { unexpected: true },
  });
  assert(malformed instanceof JsonRpcDeferredServerError);
  assert.equal(malformed.error.code, -32_600);
});
