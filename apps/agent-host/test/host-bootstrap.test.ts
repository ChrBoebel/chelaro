import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  HostBootstrapError,
  prepareFinanceHostPaths,
  resolvePinnedCodexExecutable,
  validateFinanceHostInitialization,
} from "../src/host-bootstrap.js";

test("host bootstrap: validates the exact one-shot secret delivery envelope", () => {
  const valid = {
    financeApiToken: "finance-token-safe-test-value",
    financeApiUrl: "http://127.0.0.1:8000/",
    gatewayToken: "a".repeat(64),
    protocolVersion: 1,
    requestId: "request_1",
    type: "finance.configure",
  };
  assert.deepEqual(validateFinanceHostInitialization(valid), valid);
  for (const invalid of [
    { ...valid, financeApiUrl: "https://127.0.0.1:8000/" },
    { ...valid, financeApiUrl: "http://localhost:8000/" },
    { ...valid, gatewayToken: "short" },
    { ...valid, extra: true },
    { ...valid, protocolVersion: 2 },
  ]) {
    assert.throws(
      () => validateFinanceHostInitialization(invalid),
      (error: unknown) => error instanceof HostBootstrapError && error.code === "invalid_message",
    );
  }
});

test("host bootstrap: creates isolated owner-only roots and an exact Codex config", () => {
  const parent = mkdtempSync(join(tmpdir(), "finance-host-bootstrap-"));
  const root = join(parent, "assistant");
  try {
    const paths = prepareFinanceHostPaths(root);
    for (const path of [paths.codexHome, paths.home, paths.runtimeDirectory, paths.temporaryDirectory]) {
      assert.equal(lstatSync(path).mode & 0o077, 0);
    }
    assert.equal(readFileSync(join(paths.codexHome, "config.toml"), "utf8"), "[analytics]\nenabled = false\n");
    assert.equal(lstatSync(join(paths.codexHome, "config.toml")).mode & 0o077, 0);
  } finally {
    rmSync(parent, { force: true, recursive: true });
  }
});

test("host bootstrap: refuses insecure roots and symlinked config targets", () => {
  const parent = mkdtempSync(join(tmpdir(), "finance-host-bootstrap-"));
  try {
    const insecure = join(parent, "insecure");
    prepareFinanceHostPaths(insecure);
    chmodSync(insecure, 0o755);
    assert.throws(() => prepareFinanceHostPaths(insecure));

    const linked = join(parent, "linked");
    const paths = prepareFinanceHostPaths(linked);
    const target = join(parent, "target.toml");
    writeFileSync(target, "unsafe", { mode: 0o600 });
    rmSync(join(paths.codexHome, "config.toml"));
    symlinkSync(target, join(paths.codexHome, "config.toml"));
    assert.throws(() => prepareFinanceHostPaths(linked));
  } finally {
    rmSync(parent, { force: true, recursive: true });
  }
});

test("host bootstrap: resolves only the pinned native arm64 Codex runtime", () => {
  const executable = resolvePinnedCodexExecutable();
  assert.match(executable, /aarch64-apple-darwin\/bin\/codex$/);
  assert.equal(lstatSync(executable).isFile(), true);
});
