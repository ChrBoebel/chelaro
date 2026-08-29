import { createInterface } from "node:readline";

const badIdentity = process.argv.includes("--bad-identity");
const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
let pendingClientRequest: number | undefined;

input.on("line", (line) => {
  const message = JSON.parse(line) as Record<string, unknown>;
  if (message.method === "initialize") {
    process.stderr.write("synthetic stderr sk-not-a-real-secret\n");
    respond(message.id, {
      codexHome: process.env.CODEX_HOME,
      platformFamily: "unix",
      platformOs: badIdentity ? "linux" : "macos",
      userAgent: "finance-os/0.149.1 (fake)",
    });
    notify("account/updated", { authMode: null, planType: null });
    return;
  }
  if (message.method === "test/echo") {
    respond(message.id, message.params);
    return;
  }
  if (message.method === "test/serverRequest") {
    pendingClientRequest = message.id as number;
    process.stdout.write(`${JSON.stringify({
      id: 900,
      method: "item/commandExecution/requestApproval",
      params: {
        command: "pwd",
        cwd: "/workspace",
        environmentId: null,
        itemId: "item-test",
        startedAtMs: 1,
        threadId: "thread-test",
        turnId: "turn-test",
      },
    })}\n`);
    return;
  }
  if (message.id === 900) {
    respond(pendingClientRequest, message.result);
    return;
  }
  if (message.method === "test/badNotification") {
    respond(message.id, null);
    notify("future/unknown", {});
  }
});

function respond(id: unknown, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ id, result })}\n`);
}

function notify(method: string, params: unknown): void {
  process.stdout.write(`${JSON.stringify({ method, params })}\n`);
}
