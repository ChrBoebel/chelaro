import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

import {
  assertPinnedCodexBinary,
  assertSupportedPlatform,
  buildChildEnvironment,
  readPlatformIdentity,
} from "../src/isolation.js";

const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const repositoryRoot = resolve(packageRoot, "../..");
const nativeCodex = resolve(
  repositoryRoot,
  "node_modules/.pnpm/@openai+codex@0.149.1-darwin-arm64/node_modules/@openai/codex/vendor/aarch64-apple-darwin/bin/codex",
);

test("isolation: platform and signed Codex identity gates are exact", () => {
  const identity = readPlatformIdentity();
  assert.deepEqual(identity, {
    platform: "darwin",
    architecture: "arm64",
    macosVersion: "15.6",
  });
  assert.doesNotThrow(() => assertSupportedPlatform(identity));
  assert.throws(
    () => assertSupportedPlatform({ ...identity, macosVersion: "15.6.1" }),
    /Unsupported Codex isolation platform/,
  );
  const binary = assertPinnedCodexBinary(nativeCodex);
  assert.equal(binary.version, "0.149.1");
  assert.equal(binary.teamIdentifier, "2DC432GLL2");
  assert.match(binary.sha256, /^[a-f0-9]{64}$/);
});

test("isolation: child environment is allowlisted and contains no inherited finance secrets", () => {
  process.env.FINANCE_OS_API_TOKEN = "must-not-cross-process-boundary";
  process.env.FINANCE_OS_FINANCE_ASSISTANT_TOKEN = "must-not-cross-process-boundary";
  process.env.FINANCE_OS_DATABASE_URL = "must-not-cross-process-boundary";
  process.env.OPENAI_API_KEY = "must-not-cross-process-boundary";
  try {
    const environment = buildChildEnvironment({
      codexHome: "/control/codex-home",
      home: "/control/home",
      temporaryDirectory: "/control/tmp",
    });
    assert.deepEqual(Object.keys(environment).sort(), ["CODEX_HOME", "HOME", "LANG", "PATH", "TMPDIR"]);
    for (const forbidden of [
      "FINANCE_OS_API_TOKEN",
      "FINANCE_OS_FINANCE_ASSISTANT_TOKEN",
      "FINANCE_OS_DATABASE_URL",
      "OPENAI_API_KEY",
    ]) {
      assert.equal(environment[forbidden], undefined);
    }
  } finally {
    delete process.env.FINANCE_OS_API_TOKEN;
    delete process.env.FINANCE_OS_FINANCE_ASSISTANT_TOKEN;
    delete process.env.FINANCE_OS_DATABASE_URL;
    delete process.env.OPENAI_API_KEY;
  }
});

test("isolation evidence: nested macOS Seatbelt is unavailable", async () => {
  assertSupportedPlatform();
  const child = spawn(
    "/usr/bin/sandbox-exec",
    ["-p", "(version 1) (allow default)", "/usr/bin/sandbox-exec", "-p", "(version 1) (allow default)", "/usr/bin/true"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-16_384); });
  const code = await new Promise<number | null>((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Nested Seatbelt evidence timed out"));
    }, 5_000);
    child.once("error", reject);
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolveExit(exitCode);
    });
  });
  assert.equal(code, 71);
  assert.match(stderr, /sandbox_apply: Operation not permitted/);
});
