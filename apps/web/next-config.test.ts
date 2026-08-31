import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import nextConfig from "./next.config";

describe("standalone output tracing", () => {
  test("does not trace helpers through pnpm's shared store", () => {
    expect(nextConfig.outputFileTracingIncludes).toBeUndefined();
  });

  test("completes the standalone helper target after Next builds", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));

    expect(packageJson.scripts.build).toBe(
      "next build && node ../../scripts/complete-standalone-web.mjs",
    );
  });
});
