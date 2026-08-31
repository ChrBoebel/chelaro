import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiSpecUrl = new URL("../../api/finance-os-api.spec", import.meta.url);

test("embedded API uses a headless console bootloader on macOS", async () => {
  const specification = await readFile(apiSpecUrl, "utf8");

  assert.match(specification, /^\s*console=True,\s*$/m);
  assert.doesNotMatch(specification, /^\s*console=False,\s*$/m);
});
