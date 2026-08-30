import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const hostMain = new URL("../src/main.js", import.meta.url).pathname;

test("host main: receives finance credentials only after startup over inherited IPC", async (t) => {
  const dataRoot = mkdtempSync(join(tmpdir(), "finance-host-main-"));
  const gatewayToken = "b".repeat(64);
  const financeApiToken = "synthetic-finance-api-token-value";
  const child = fork(hostMain, [], {
    env: {
      FINANCE_OS_AGENT_DATA_ROOT: join(dataRoot, "assistant"),
      LANG: "C.UTF-8",
      PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
      TMPDIR: tmpdir(),
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  t.after(async () => {
    if (child.connected) child.disconnect();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await waitForExit(child).catch(() => undefined);
    rmSync(dataRoot, { force: true, recursive: true });
  });

  assert.equal(child.spawnargs.includes(financeApiToken), false);
  const ready = await nextMessage(child);
  assert.deepEqual(ready, { protocolVersion: 1, type: "finance.ready_for_configuration" });
  child.send({
    codexBinaryPath: "codex",
    codexHome: join(dataRoot, "user-home", ".codex"),
    financeApiToken,
    financeApiUrl: "http://127.0.0.1:65534/",
    gatewayToken,
    protocolVersion: 1,
    requestId: "configure_1",
    type: "finance.configure",
    userHome: join(dataRoot, "user-home"),
  });
  const configured = await nextMessage(child) as { gatewayOrigin: string; type: string };
  assert.equal(configured.type, "finance.configured", JSON.stringify(configured));
  assert.match(configured.gatewayOrigin, /^http:\/\/127\.0\.0\.1:[0-9]+$/);

  const status = await fetch(`${configured.gatewayOrigin}/v1/status`, {
    headers: { authorization: `Bearer ${gatewayToken}` },
  });
  assert.equal(status.status, 200);
  const body = await status.json() as { snapshot: { host: string } };
  assert.equal(body.snapshot.host, "ready");

  child.disconnect();
  await waitForExit(child);
  assert.equal(child.exitCode, 0);
});

async function nextMessage(child: ChildProcess): Promise<unknown> {
  return withTimeout(new Promise((resolve, reject) => {
    child.once("message", resolve);
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Finance host exited before IPC response (${code}).`)));
  }));
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await withTimeout(new Promise<void>((resolve) => child.once("exit", () => resolve())));
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Finance host IPC timed out.")), 15_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
