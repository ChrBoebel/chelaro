import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import {
  buildFinanceInitializeParams,
  buildFinanceThreadStartParams,
} from "../src/finance-thread-contract.js";
import { assertSafeFinanceThreadResponse } from "../src/finance-response-validator.js";
import { JsonRpcClient } from "../src/json-rpc-client.js";

const codexEntry = resolve(
  dirname(new URL(import.meta.url).pathname),
  "../../node_modules/@openai/codex/bin/codex.js",
);

test("contract: pinned App Server accepts the no-environment finance thread", async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "finance-os-finance-thread-"));
  const codexHome = join(temporaryRoot, "codex-home");
  mkdirSync(codexHome, { mode: 0o700 });
  writeFileSync(join(codexHome, "config.toml"), "[analytics]\nenabled = false\n", { mode: 0o600 });
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
  const rpc = new JsonRpcClient({
    input: child.stdout,
    output: child.stdin,
    onNotification: () => undefined,
    onServerRequest: async ({ method }) => { throw new Error(`Unexpected request: ${method}`); },
  });

  try {
    await rpc.request("initialize", buildFinanceInitializeParams("0.1.0"));
    const result = await rpc.request("thread/start", buildFinanceThreadStartParams()) as {
      approvalPolicy: string;
      cwd: string;
      thread: { ephemeral: boolean; id: string; path: string | null };
    };
    assertSafeFinanceThreadResponse(result, temporaryRoot);
    assert.equal(result.approvalPolicy, "never");
    assert.equal(result.thread.ephemeral, false);
    assert.equal(typeof result.thread.path, "string");
  } finally {
    rpc.close();
    child.kill("SIGTERM");
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolveClose) => child.once("close", resolveClose));
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
