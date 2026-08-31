import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { signBundle } = require("../scripts/adhoc-sign-macos.cjs");

test("free macOS packaging signs and strictly verifies the complete bundle without a certificate", async () => {
  const calls = [];
  await signBundle("/private/tmp/Chelaro.app", {
    execFileAsync: async (...args) => calls.push(args),
  });

  const options = { timeout: 120_000, windowsHide: true };
  assert.deepEqual(calls, [
    [
      "/usr/bin/codesign",
      ["--force", "--deep", "--sign", "-", "--timestamp=none", "/private/tmp/Chelaro.app"],
      options,
    ],
    [
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", "--verbose=2", "/private/tmp/Chelaro.app"],
      options,
    ],
  ]);
});

test("ad-hoc signing rejects paths that are not absolute application bundles", async () => {
  await assert.rejects(() => signBundle("Chelaro.app"), /absolute .app bundle/);
  await assert.rejects(() => signBundle("/private/tmp/Chelaro.dmg"), /absolute .app bundle/);
});
