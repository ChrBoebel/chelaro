import assert from "node:assert/strict";
import test from "node:test";

import { createMacOsQuarantineMarker } from "../src/macos-quarantine.mjs";

test("macOS downloads receive a deterministic quarantine xattr without invoking a shell", async () => {
  const calls = [];
  const markQuarantined = createMacOsQuarantineMarker({
    execFileAsync: async (...args) => calls.push(args),
    now: () => 1_700_000_000_000,
    createId: () => "fixture-id",
  });

  await markQuarantined("/private/tmp/Chelaro-0.3.2-arm64.dmg");

  assert.deepEqual(calls, [[
    "/usr/bin/xattr",
    [
      "-w",
      "com.apple.quarantine",
      "0083;6553f100;Chelaro;fixture-id",
      "/private/tmp/Chelaro-0.3.2-arm64.dmg",
    ],
    { timeout: 10_000, windowsHide: true },
  ]]);
});

test("macOS quarantine rejects non-absolute paths", async () => {
  const markQuarantined = createMacOsQuarantineMarker({ execFileAsync: async () => {} });

  await assert.rejects(() => markQuarantined("Chelaro.dmg"), /must be absolute/);
});
