import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { completeStandaloneWeb } from "../../../scripts/complete-standalone-web.mjs";

test("standalone completion copies only the direct helper ESM directory", async () => {
  const repositoryDirectory = await mkdtemp(path.join(os.tmpdir(), "chelaro-standalone-"));
  const webDirectory = path.join(repositoryDirectory, "apps", "web");
  const helpersDirectory = path.join(
    repositoryDirectory,
    "node_modules",
    ".pnpm",
    "@swc+helpers@0.5.23",
    "node_modules",
    "@swc",
    "helpers",
  );

  try {
    await mkdir(path.join(helpersDirectory, "esm"), { recursive: true });
    await writeFile(path.join(helpersDirectory, "esm", "fixture.js"), "export const fixture = true;\n");
    await completeStandaloneWeb({ repositoryDirectory, webDirectory, helpersDirectory });

    const copiedFile = path.join(
      webDirectory,
      ".next",
      "standalone",
      path.relative(repositoryDirectory, helpersDirectory),
      "esm",
      "fixture.js",
    );
    assert.equal(await readFile(copiedFile, "utf8"), "export const fixture = true;\n");
  } finally {
    await rm(repositoryDirectory, { recursive: true, force: true });
  }
});
