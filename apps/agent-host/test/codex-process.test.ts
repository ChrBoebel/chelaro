import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildCodexAppServerArguments, CodexProcess, CodexProcessError } from "../src/codex-process.js";

const fakeRuntime = new URL("./fake-codex-runtime.js", import.meta.url).pathname;

test("codex process: disables global hooks and plugin features before App Server startup", () => {
  const argumentsList = buildCodexAppServerArguments();
  assert.equal(argumentsList.includes("features.hooks=false"), true);
  assert.equal(argumentsList.includes("features.plugins=false"), true);
  assert.equal(argumentsList.includes("skills.include_instructions=false"), true);
});

function fixture(options: { badIdentity?: boolean; onFatalError?: (error: Error) => void } = {}) {
  const root = mkdtempSync(join(tmpdir(), "chelaro-finance-codex-process-"));
  const codexHome = join(root, "codex");
  const temporaryDirectory = join(root, "tmp");
  for (const directory of [codexHome, temporaryDirectory]) mkdirSync(directory, { mode: 0o700 });
  const notifications: string[] = [];
  let resolveNotification: (() => void) | undefined;
  const notificationReceived = new Promise<void>((resolve) => { resolveNotification = resolve; });
  let verified = "";
  const runtime = new CodexProcess({
    argumentsPrefix: [fakeRuntime, ...(options.badIdentity ? ["--bad-identity"] : [])],
    binaryPath: process.execPath,
    codexHome,
    home: root,
    onFatalError: options.onFatalError ?? (() => undefined),
    onNotification: ({ method }) => { notifications.push(method); resolveNotification?.(); },
    onServerRequest: async () => ({ decision: "decline" }),
    runtimeDirectory: root,
    temporaryDirectory,
    verifyBinary: (path) => { verified = path; },
  });
  return {
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    notificationReceived,
    notifications,
    runtime,
    verified: () => verified,
  };
}

test("codex process: verifies, initializes, validates, and correlates the App Server", async (t) => {
  const state = fixture();
  t.after(async () => { await state.runtime.stop(); state.cleanup(); });
  await state.runtime.start();
  assert.equal(state.runtime.status, "ready");
  assert.equal(state.verified(), process.execPath);
  await state.notificationReceived;
  assert.equal(state.notifications.includes("account/updated"), true);
  assert.deepEqual(await state.runtime.request("test/echo", { safe: true }), { safe: true });
  assert.deepEqual(await state.runtime.request("test/serverRequest", {}), { decision: "decline" });
  assert.equal(state.runtime.stderrByteCount > 0, true);
  assert.equal(JSON.stringify(state.runtime).includes("sk-not-a-real-secret"), false);
});

test("codex process: protocol drift fails closed and leaves no running child", async (t) => {
  const failures: Error[] = [];
  const state = fixture({ badIdentity: true, onFatalError: (error) => failures.push(error) });
  t.after(async () => { await state.runtime.stop(); state.cleanup(); });
  await assert.rejects(
    () => state.runtime.start(),
    (error: unknown) => error instanceof CodexProcessError && error.code === "startup_failed",
  );
  assert.equal(state.runtime.status, "stopped");
  assert.equal(failures.length, 1);
});

test("codex process: unknown notifications fail the live protocol closed", async (t) => {
  const failures: Error[] = [];
  let resolveFailure: (() => void) | undefined;
  const failure = new Promise<void>((resolve) => { resolveFailure = resolve; });
  const state = fixture({ onFatalError: (error) => { failures.push(error); resolveFailure?.(); } });
  t.after(async () => { await state.runtime.stop(); state.cleanup(); });
  await state.runtime.start();
  await state.runtime.request("test/badNotification", {});
  await failure;
  assert.equal(state.runtime.status, "crashed");
  assert.equal(failures.length, 1);
});
