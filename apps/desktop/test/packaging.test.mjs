import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiSpecUrl = new URL("../../api/finance-os-api.spec", import.meta.url);
const runtimeUrl = new URL("../src/runtime.mjs", import.meta.url);

test("embedded API uses a headless console bootloader on macOS", async () => {
  const specification = await readFile(apiSpecUrl, "utf8");

  assert.match(specification, /^\s*console=True,\s*$/m);
  assert.doesNotMatch(specification, /^\s*console=False,\s*$/m);
});

test("packaged web server uses Electron's background helper instead of a second app process", async () => {
  const runtime = await readFile(runtimeUrl, "utf8");

  assert.match(
    runtime,
    /startForked\("eingebettete Chelaro-Oberfläche", webServer,/,
  );
  assert.doesNotMatch(
    runtime,
    /startExecutable\("eingebettete Chelaro-Oberfläche"/,
  );
});
