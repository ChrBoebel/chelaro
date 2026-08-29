import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AGENT_IMAGE_SPECS,
  assertManagedPath,
  initializeAgentStorageLayout,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_STORAGE_BYTES,
  removeManagedTree,
  resolveAgentStorageLayout,
} from "../src/layout.js";

test("agent storage layout: fixes four image capacities to 1.75 GiB under userData", () => {
  const root = mkdtempSync(join(tmpdir(), "chelaro-storage-layout-"));
  try {
    const layout = resolveAgentStorageLayout(root);
    assert.equal(AGENT_IMAGE_SPECS.length, 4);
    assert.equal(MAX_AGENT_IMAGE_BYTES, 1.75 * 1024 * 1024 * 1024);
    assert.equal(MAX_AGENT_STORAGE_BYTES, 2 * 1024 * 1024 * 1024);
    assert.equal(layout.sparseBundles.control, join(root, "agent/images/control.sparsebundle"));
    assert.equal(layout.mounts.recovery, join(root, "agent/mounts/recovery"));
    initializeAgentStorageLayout(layout);
    assert.equal(assertManagedPath(layout.agentRoot, layout.runtimeRoot), layout.runtimeRoot);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("agent storage layout: rejects relative roots, root cleanup, escapes, and symlink traversal", () => {
  assert.throws(() => resolveAgentStorageLayout("relative"), /must be absolute/);
  const root = mkdtempSync(join(tmpdir(), "chelaro-storage-path-"));
  const outside = mkdtempSync(join(tmpdir(), "chelaro-storage-outside-"));
  try {
    const layout = resolveAgentStorageLayout(root);
    initializeAgentStorageLayout(layout);
    assert.throws(() => assertManagedPath(layout.agentRoot, layout.agentRoot), /must be a child/);
    assert.throws(() => assertManagedPath(layout.agentRoot, outside), /must be a child/);
    symlinkSync(outside, join(layout.runtimeRoot, "escape"));
    assert.throws(() => assertManagedPath(layout.agentRoot, join(layout.runtimeRoot, "escape/file")), /symbolic links/);
  } finally {
    rmSync(root, { force: true, recursive: true });
    rmSync(outside, { force: true, recursive: true });
  }
});

test("agent storage layout: cleanup removes only a validated child without following links", () => {
  const root = mkdtempSync(join(tmpdir(), "chelaro-storage-cleanup-"));
  const outside = mkdtempSync(join(tmpdir(), "chelaro-storage-survivor-"));
  try {
    const layout = resolveAgentStorageLayout(root);
    initializeAgentStorageLayout(layout);
    const target = join(layout.runtimeRoot, "cleanup-target");
    mkdirSync(target, { mode: 0o700 });
    writeFileSync(join(outside, "survivor"), "safe");
    symlinkSync(outside, join(target, "outside-link"));
    removeManagedTree(layout.agentRoot, target);
    assert.equal(assertManagedPath(layout.agentRoot, join(layout.runtimeRoot, "next")), join(layout.runtimeRoot, "next"));
    assert.doesNotThrow(() => writeFileSync(join(outside, "survivor"), "still-safe"));
  } finally {
    rmSync(root, { force: true, recursive: true });
    rmSync(outside, { force: true, recursive: true });
  }
});
