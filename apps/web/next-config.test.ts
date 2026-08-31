import { describe, expect, test } from "vitest";

import nextConfig from "./next.config";

describe("standalone output tracing", () => {
  test("excludes prior desktop runtime and package artifacts", () => {
    expect(nextConfig.outputFileTracingExcludes?.["/*"]).toEqual([
      "../desktop/.runtime/**/*",
      "../desktop/dist/**/*",
      "../../node_modules/.pnpm/node_modules/desktop/.runtime/**/*",
      "../../node_modules/.pnpm/node_modules/desktop/dist/**/*",
    ]);
  });
});
