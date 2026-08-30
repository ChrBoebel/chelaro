import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  HostBootstrapError,
  prepareFinanceHostPaths,
  validateFinanceHostInitialization,
} from "../src/host-bootstrap.js";

test("host bootstrap: validates the exact system-Codex configuration envelope", () => {
  const valid = {
    codexBinaryPath: "codex",
    codexHome: "/Users/tester/.codex",
    financeApiToken: "finance-token-safe-test-value",
    financeApiUrl: "http://127.0.0.1:8000/",
    gatewayToken: "a".repeat(64),
    protocolVersion: 1,
    requestId: "request_1",
    type: "finance.configure",
    userHome: "/Users/tester",
  };
  assert.deepEqual(validateFinanceHostInitialization(valid), valid);
  for (const invalid of [
    { ...valid, codexHome: "relative" },
    { ...valid, userHome: "relative" },
    { ...valid, codexBinaryPath: "codex\nunsafe" },
    { ...valid, financeApiUrl: "https://127.0.0.1:8000/" },
    { ...valid, gatewayToken: "short" },
    { ...valid, extra: true },
  ]) {
    assert.throws(
      () => validateFinanceHostInitialization(invalid),
      (error: unknown) => error instanceof HostBootstrapError && error.code === "invalid_message",
    );
  }
});

test("host bootstrap: creates only owner-scoped runtime state and no credential home", () => {
  const parent = mkdtempSync(join(tmpdir(), "finance-host-bootstrap-"));
  try {
    const paths = prepareFinanceHostPaths(join(parent, "assistant"));
    for (const path of [dirname(paths.consentJournal), paths.runtimeDirectory, paths.temporaryDirectory]) {
      assert.equal(lstatSync(path).mode & 0o077, 0);
    }
    assert.equal("codexHome" in paths, false);
    assert.equal("home" in paths, false);
  } finally {
    rmSync(parent, { force: true, recursive: true });
  }
});

test("host bootstrap: refuses an insecure existing data root", () => {
  const parent = mkdtempSync(join(tmpdir(), "finance-host-bootstrap-"));
  try {
    const root = join(parent, "assistant");
    prepareFinanceHostPaths(root);
    chmodSync(root, 0o755);
    assert.throws(() => prepareFinanceHostPaths(root));
  } finally {
    rmSync(parent, { force: true, recursive: true });
  }
});
