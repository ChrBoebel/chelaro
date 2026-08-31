import { describe, expect, test } from "vitest";

import nextConfig from "./next.config";

describe("standalone output tracing", () => {
  test("includes helpers through the web package instead of pnpm's shared store", () => {
    const includes = nextConfig.outputFileTracingIncludes?.["/*"];

    expect(includes).toEqual(["node_modules/@swc/helpers/esm/**/*"]);
    expect(includes?.some((pattern) => pattern.includes(".pnpm"))).toBe(false);
  });
});
