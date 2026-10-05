import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import { SCHEMA_CODEX_VERSION } from "../src/codex-provider.js";
import {
  assertSupportedCodexBinary,
  assertSupportedPlatform,
  buildChildEnvironment,
  readPlatformIdentity,
} from "../src/isolation.js";

const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const repositoryRoot = resolve(packageRoot, "../..");
// Built from the supported version so the store path follows the pin instead
// of pointing at whatever older release is still cached in the pnpm store.
const nativeCodex = resolve(
  repositoryRoot,
  `node_modules/.pnpm/@openai+codex@${SCHEMA_CODEX_VERSION}-darwin-arm64`,
  "node_modules/@openai/codex/vendor/aarch64-apple-darwin/bin/codex",
);

test("isolation: supported platform evidence and Codex version are exact", () => {
  const identity = readPlatformIdentity();
  assert.doesNotThrow(() => assertSupportedPlatform(identity));
  for (const macosVersion of ["15.6", "26.6.2"]) {
    assert.doesNotThrow(() => assertSupportedPlatform({ platform: "darwin", architecture: "arm64", macosVersion }));
  }
  for (const unsupported of [
    { ...identity, macosVersion: "15.6.1" },
    { ...identity, macosVersion: "26.6.3" },
    { ...identity, architecture: "x64" },
    { ...identity, platform: "linux" as const },
  ]) {
    assert.throws(() => assertSupportedPlatform(unsupported), /Unsupported Codex isolation platform/);
  }
  const binary = assertSupportedCodexBinary(nativeCodex);
  assert.equal(binary.version, SCHEMA_CODEX_VERSION);
  assert.equal(binary.path, nativeCodex);
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

test("isolation evidence: nested Seatbelt matches the platform and preserves write denials", (t) => {
  const identity = readPlatformIdentity();
  assertSupportedPlatform(identity);
  const allow = "(version 1) (allow default)";
  const denyWrites = `${allow} (deny file-write*)`;
  const runNested = (outer: string, inner: string, command: string, ...args: string[]) => spawnSync(
    "/usr/bin/sandbox-exec",
    ["-p", outer, "/usr/bin/sandbox-exec", "-p", inner, command, ...args],
    { encoding: "utf8", timeout: 5_000, maxBuffer: 16_384 },
  );
  const probe = runNested(allow, allow, "/usr/bin/true");
  assert.ifError(probe.error);
  // Allow-default nesting succeeds on 26.6.2, but restrictive nested profiles
  // still fail to apply. Verify the direct write denial separately below.
  if (identity.macosVersion === "15.6") {
    assert.equal(probe.status, 71);
    assert.match(probe.stderr, /sandbox_apply: Operation not permitted/);
    return;
  }
  assert.equal(probe.status, 0);
  const root = mkdtempSync(join(tmpdir(), "chelaro-seatbelt-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, "forbidden.txt");
  const direct = spawnSync("/usr/bin/sandbox-exec", ["-p", denyWrites, "/usr/bin/touch", target], {
    encoding: "utf8", timeout: 5_000, maxBuffer: 16_384,
  });
  assert.ifError(direct.error);
  assert.equal(direct.status, 1);
  assert.match(direct.stderr, /Operation not permitted/);
  assert.equal(existsSync(target), false);
  for (const [outer, inner] of [[denyWrites, allow], [allow, denyWrites]] as const) {
    const denied = runNested(outer, inner, "/usr/bin/touch", target);
    assert.ifError(denied.error);
    assert.equal(denied.status, 71);
    assert.match(denied.stderr, /sandbox_apply: Operation not permitted/);
    assert.equal(existsSync(target), false);
  }
});
