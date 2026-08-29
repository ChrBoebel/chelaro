import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createInterface } from "node:readline";

import type { ServerRequest } from "../generated/codex/ts/ServerRequest.js";
import { ProtocolValidationError, validateServerRequest } from "../src/runtime-validator.js";
import {
  classifyServerRequest,
  SUPPORTED_SERVER_REQUEST_METHODS,
} from "../src/server-request-policy.js";

test("contract: policy method list exactly matches the generated ServerRequest union", () => {
  const schema = JSON.parse(
    readFileSync(
      new URL("../../generated/codex/schema/ServerRequest.json", import.meta.url),
      "utf8",
    ),
  );
  const generatedMethods = schema.oneOf.map(
    (variant: { properties: { method: { enum: string[] } } }) => variant.properties.method.enum[0],
  );
  assert.deepEqual(generatedMethods.sort(), [...SUPPORTED_SERVER_REQUEST_METHODS].sort());
});

test("contract: every pinned Codex ServerRequest receives a terminal policy", async () => {
  const child = spawn(process.execPath, [new URL("./fake-app-server.js", import.meta.url).pathname], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
  let requestCount = 0;
  let completion;

  for await (const line of output) {
    const message = JSON.parse(line);
    if (message.method === "test/completed") {
      completion = message;
      continue;
    }
    validateServerRequest(message);
    requestCount += 1;
    const outcome = classifyServerRequest(message as ServerRequest);
    const response = outcome.kind === "response"
      ? { id: message.id, result: outcome.result }
      : outcome.kind === "finance_tool"
        ? { id: message.id, result: { contentItems: [], success: false } }
        : { id: message.id, error: outcome.error };
    child.stdin.write(`${JSON.stringify(response)}\n`);
  }

  const exitCode = await new Promise((resolve) => child.once("close", resolve));
  assert.equal(exitCode, 0);
  assert.equal(requestCount, 10);
  assert.equal(completion.params.responses.length, 10);
});

test("contract: command capability escalation is denied and aborts the turn", () => {
  const networkRequest = {
    method: "item/commandExecution/requestApproval",
    id: 1,
    params: {
      threadId: "thread",
      turnId: "turn",
      itemId: "item",
      startedAtMs: 1,
      environmentId: null,
      command: "curl https://example.com",
      cwd: "/workspace",
      networkApprovalContext: { host: "example.com", protocol: "https" },
    },
  } as unknown as ServerRequest;
  const outcome = classifyServerRequest(networkRequest);
  assert.deepEqual(outcome, {
    kind: "response",
    result: { decision: "decline" },
    abortTurn: true,
  });
});

test("contract: unsupported capabilities abort the turn", () => {
  const outcome = classifyServerRequest({
    method: "attestation/generate",
    id: "request",
    params: {},
  });
  assert.deepEqual(outcome, {
    kind: "error",
    error: { code: -32601, message: "Method not supported" },
    abortTurn: true,
  });
});

test("contract: no-grant permission and MCP responses are exact", () => {
  assert.deepEqual(
    classifyServerRequest({
      method: "item/permissions/requestApproval",
      id: 1,
      params: {
        threadId: "thread",
        turnId: "turn",
        itemId: "item",
        environmentId: null,
        startedAtMs: 1,
        cwd: "/workspace",
        reason: null,
        permissions: { network: { enabled: true }, fileSystem: null },
      },
    }),
    {
      kind: "response",
      result: { permissions: {}, scope: "turn", strictAutoReview: true },
      abortTurn: true,
    },
  );
  assert.deepEqual(
    classifyServerRequest({
      method: "mcpServer/elicitation/request",
      id: 2,
      params: {
        threadId: "thread",
        turnId: "turn",
        serverName: "disabled",
        mode: "form",
        _meta: null,
        message: "Disabled",
        requestedSchema: { type: "object", properties: {} },
      },
    }),
    {
      kind: "response",
      result: { action: "decline", content: null, _meta: null },
      abortTurn: true,
    },
  );
});

test("contract: legacy execution and patch requests are denied without manual approval", () => {
  assert.deepEqual(classifyServerRequest({
    method: "execCommandApproval",
    id: 3,
    params: {
      conversationId: "thread",
      callId: "call",
      approvalId: null,
      command: ["pwd"],
      cwd: "/workspace",
      reason: null,
      parsedCmd: [],
    },
  }), {
    kind: "response",
    result: { decision: { denied: { rejection: "Command execution is disabled." } } },
    abortTurn: true,
  });
  assert.deepEqual(classifyServerRequest({
    method: "applyPatchApproval",
    id: 4,
    params: {
      conversationId: "thread",
      callId: "call",
      fileChanges: {},
      reason: null,
      grantRoot: "/workspace",
    },
  }), {
    kind: "response",
    result: { decision: { denied: { rejection: "File changes are disabled." } } },
    abortTurn: true,
  });
});

test("contract: only dynamic finance calls are delegated", () => {
  const request = {
    method: "item/tool/call",
    id: 5,
    params: {
      threadId: "thread",
      turnId: "turn",
      callId: "call",
      namespace: "chelaro_finance",
      tool: "finance_get_overview",
      arguments: {},
    },
  } as const;
  assert.deepEqual(classifyServerRequest(request), {
    kind: "finance_tool",
    params: request.params,
  });
});

test("contract: malformed and extended requests fail runtime validation", () => {
  assert.throws(
    () => validateServerRequest({ method: "unknown/request", id: 1, params: {} }),
    ProtocolValidationError,
  );
  assert.throws(
    () =>
      validateServerRequest({
        method: "attestation/generate",
        id: 1,
        params: {},
        unexpected: true,
      }),
    ProtocolValidationError,
  );
});
