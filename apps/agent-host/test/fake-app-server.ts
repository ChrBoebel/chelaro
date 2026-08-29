import { createInterface } from "node:readline";

const common = { threadId: "thread-test", turnId: "turn-test", itemId: "item-test" };

const requests = [
  {
    method: "item/commandExecution/requestApproval",
    id: 1,
    params: { ...common, startedAtMs: 1, environmentId: null, command: "pwd", cwd: "/workspace" },
  },
  {
    method: "item/fileChange/requestApproval",
    id: 2,
    params: { ...common, startedAtMs: 1, grantRoot: null },
  },
  {
    method: "item/tool/requestUserInput",
    id: 3,
    params: {
      ...common,
      isBlocking: true,
      questions: [
        { id: "q", header: "Question", question: "Continue?", isOther: false, isSecret: false, options: null },
      ],
    },
  },
  {
    method: "mcpServer/elicitation/request",
    id: 4,
    params: {
      threadId: common.threadId,
      turnId: common.turnId,
      serverName: "disabled-test-server",
      mode: "form",
      _meta: null,
      message: "Disabled",
      requestedSchema: { type: "object", properties: {} },
    },
  },
  {
    method: "item/permissions/requestApproval",
    id: 5,
    params: {
      ...common,
      environmentId: null,
      startedAtMs: 1,
      cwd: "/workspace",
      reason: null,
      permissions: { network: { enabled: true }, fileSystem: null },
    },
  },
  {
    method: "item/tool/call",
    id: 6,
    params: { threadId: common.threadId, turnId: common.turnId, callId: "call", namespace: null, tool: "disabled", arguments: {} },
  },
  {
    method: "account/chatgptAuthTokens/refresh",
    id: 7,
    params: { previousAccountId: null, reason: "unauthorized" },
  },
  { method: "attestation/generate", id: 8, params: {} },
  {
    method: "applyPatchApproval",
    id: 9,
    params: { conversationId: common.threadId, callId: "patch", fileChanges: {} },
  },
  {
    method: "execCommandApproval",
    id: 10,
    params: { conversationId: common.threadId, callId: "exec", approvalId: null, command: ["pwd"], cwd: "/workspace", reason: null, parsedCmd: [] },
  },
];

const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
const responses: unknown[] = [];
input.on("line", (line) => {
  responses.push(JSON.parse(line));
  if (responses.length === requests.length) {
    input.close();
    process.stdin.destroy();
    process.stdout.write(
      `${JSON.stringify({ method: "test/completed", params: { responses } })}\n`,
      () => process.exit(0),
    );
  }
});

for (const request of requests) {
  process.stdout.write(`${JSON.stringify(request)}\n`);
}
