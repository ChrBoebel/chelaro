import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import nextConfig from "./next.config";

describe("standalone output tracing", () => {
  test("includes the exact helper target without scanning pnpm's shared store", () => {
    const require = createRequire(import.meta.url);
    const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
    const helpersDirectory = path.dirname(require.resolve("@swc/helpers/package.json"));
    const expectedEsmGlob = `${path
      .relative(projectDirectory, path.join(helpersDirectory, "esm"))
      .split(path.sep)
      .join("/")}/**/*`;
    const includes = nextConfig.outputFileTracingIncludes?.["/*"];

    expect(includes).toEqual([expectedEsmGlob]);
    expect(expectedEsmGlob.slice(0, expectedEsmGlob.indexOf("/esm/"))).not.toContain("*");
  });
});
