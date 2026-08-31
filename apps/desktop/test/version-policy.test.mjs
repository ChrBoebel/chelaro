import assert from "node:assert/strict";
import test from "node:test";

import { assertProductVersionBump } from "../../../scripts/check-version-bump.mjs";

const versions = (version) => ({
  desktop: version,
  root: version,
  web: version,
});

test("version policy accepts one synchronized higher semantic version", () => {
  assert.deepEqual(assertProductVersionBump(versions("0.2.0"), versions("0.2.1")), {
    from: "0.2.0",
    to: "0.2.1",
  });
  assert.deepEqual(assertProductVersionBump(versions("0.2.9"), versions("0.3.0")), {
    from: "0.2.9",
    to: "0.3.0",
  });
});

test("version policy rejects unchanged, lower, malformed, and unsynchronized versions", () => {
  for (const current of [
    versions("0.2.0"),
    versions("0.1.9"),
    versions("0.2.1-beta.1"),
    { desktop: "0.2.1", root: "0.2.1", web: "0.2.0" },
  ]) {
    assert.throws(() => assertProductVersionBump(versions("0.2.0"), current));
  }
  assert.throws(() => assertProductVersionBump(
    { desktop: "0.2.0", root: "0.2.0", web: "0.1.9" },
    versions("0.2.1"),
  ));
});
