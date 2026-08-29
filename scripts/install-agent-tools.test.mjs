import assert from "node:assert/strict";
import test from "node:test";

import {
  GITLEAKS_ARCHIVE_SHA256,
  GITLEAKS_ARCHIVE_URL,
  GITLEAKS_VERSION,
  sha256,
  validateArchiveEntries,
} from "./install-agent-tools.mjs";

test("pins the approved macOS arm64 gitleaks release", () => {
  assert.equal(GITLEAKS_VERSION, "8.30.1");
  assert.match(GITLEAKS_ARCHIVE_URL, /gitleaks_8\.30\.1_darwin_arm64\.tar\.gz$/);
  assert.equal(GITLEAKS_ARCHIVE_SHA256.length, 64);
});

test("hashes downloaded bytes deterministically", () => {
  assert.equal(
    sha256(Buffer.from("finance-os-agent-tool-test", "utf8")),
    "d5c0a695a240a7ca6db0a65f7c13e94efd503a2499971aefeaf797e1d4559e5b",
  );
});

test("rejects unexpected or traversal archive entries", () => {
  assert.doesNotThrow(() => validateArchiveEntries(["gitleaks", "README.md", "LICENSE"]));
  assert.throws(
    () => validateArchiveEntries(["gitleaks", "README.md", "LICENSE", "../escape"]),
    /Unexpected gitleaks archive entries/,
  );
});
