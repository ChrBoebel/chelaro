import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  inspectCodexProvider,
  providerSnapshot,
  SCHEMA_CODEX_VERSION,
  SUPPORTED_CODEX_VERSIONS,
} from "../src/codex-provider.js";

function fixture(version = SCHEMA_CODEX_VERSION) {
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
    assert.deepEqual(provider.snapshot, providerSnapshot("ready", SCHEMA_CODEX_VERSION));
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
      snapshot: providerSnapshot("not_found", null),
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
      snapshot: providerSnapshot("unsupported", "0.150.0"),
    });
  } finally {
    unsupported.cleanup();
  }
});

test("codex provider: the schema release is the newest verified one", () => {
  // The checked-in schemas describe one release. Every other accepted release
  // must be older, because that is what makes the compatibility argument hold:
  // an older App Server sends a subset of the notifications and requests the
  // checked-in schemas describe, so its messages still validate. A newer one
  // could send shapes nobody reviewed, so raising the CLI means regenerating
  // the schemas rather than widening this list.
  const ordered = [...SUPPORTED_CODEX_VERSIONS].sort(descendingSemanticVersion);
  assert.deepEqual([...SUPPORTED_CODEX_VERSIONS], ordered, "Verified releases must be listed newest first.");
  assert.equal(SUPPORTED_CODEX_VERSIONS[0], SCHEMA_CODEX_VERSION);
  assert.equal(new Set(SUPPORTED_CODEX_VERSIONS).size, SUPPORTED_CODEX_VERSIONS.length);
});

test("codex provider: accepts every verified release and still refuses the rest", () => {
  assert(SUPPORTED_CODEX_VERSIONS.includes(SCHEMA_CODEX_VERSION));
  for (const version of SUPPORTED_CODEX_VERSIONS) {
    const state = fixture(version);
    try {
      const provider = inspectCodexProvider({
        binaryPath: state.executable,
        codexHome: state.codexHome,
        home: state.home,
        path: state.path,
      });
      assert.deepEqual(provider.snapshot, providerSnapshot("ready", version));
      assert.equal(provider.launch?.version, version);
    } finally {
      state.cleanup();
    }
  }

  for (const version of ["0.150.0", "0.153.0", "1.0.0"]) {
    assert(!SUPPORTED_CODEX_VERSIONS.includes(version));
    const state = fixture(version);
    try {
      assert.deepEqual(
        inspectCodexProvider({
          binaryPath: state.executable,
          codexHome: state.codexHome,
          home: state.home,
          path: state.path,
        }).snapshot,
        providerSnapshot("unsupported", version),
      );
    } finally {
      state.cleanup();
    }
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

function descendingSemanticVersion(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return rightParts[index]! - leftParts[index]!;
  }
  return 0;
}
