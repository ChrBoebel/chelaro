import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  inspectCodexProvider,
  SUPPORTED_CODEX_VERSION,
} from "../src/codex-provider.js";

function fixture(version = SUPPORTED_CODEX_VERSION) {
  const root = mkdtempSync(join(tmpdir(), "chelaro-codex-provider-"));
  const bin = join(root, "bin");
  const home = join(root, "home");
  const codexHome = join(home, ".codex");
  mkdirSync(bin, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  const executable = join(bin, "codex");
  writeFileSync(executable, `#!/bin/sh\nprintf 'codex-cli ${version}\\n'\n`, { mode: 0o700 });
  chmodSync(executable, 0o700);
  return {
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    codexHome,
    executable,
    home,
    path: bin,
  };
}

test("codex provider: discovers the user CLI and reuses its normal credential home", () => {
  const state = fixture();
  try {
    const provider = inspectCodexProvider({
      binaryPath: "codex",
      codexHome: state.codexHome,
      home: state.home,
      path: state.path,
    });
    assert.deepEqual(provider.snapshot, {
      status: "ready",
      version: SUPPORTED_CODEX_VERSION,
    });
    assert(provider.launch);
    assert.equal(provider.launch.binaryPath, realpathSync(state.executable));
    assert.equal(provider.launch.home, state.home);
    assert.equal(provider.launch.codexHome, state.codexHome);
  } finally {
    state.cleanup();
  }
});

test("codex provider: reports missing and unsupported installations without crashing Chelaro", () => {
  const missing = fixture();
  try {
    assert.deepEqual(inspectCodexProvider({
      binaryPath: "codex",
      codexHome: missing.codexHome,
      home: missing.home,
      path: join(missing.home, "empty-bin"),
    }), {
      launch: null,
      snapshot: { status: "not_found", version: null },
    });
  } finally {
    missing.cleanup();
  }

  const unsupported = fixture("0.150.0");
  try {
    assert.deepEqual(inspectCodexProvider({
      binaryPath: unsupported.executable,
      codexHome: unsupported.codexHome,
      home: unsupported.home,
      path: unsupported.path,
    }), {
      launch: null,
      snapshot: { status: "unsupported", version: "0.150.0" },
    });
  } finally {
    unsupported.cleanup();
  }
});

test("codex provider: rejects relative homes and never receives an auth file path", () => {
  assert.throws(() => inspectCodexProvider({
    binaryPath: "codex",
    codexHome: ".codex",
    home: "relative-home",
    path: "/usr/bin",
  }), /absolute/);
});
