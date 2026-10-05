import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isReviewedLegacySurface } from "./codex-reviewed-legacy-surfaces.mjs";

const file = "ts/v2/ThreadItem.ts";
const current = readFileSync(new URL(`../generated/codex/${file}`, import.meta.url), "utf8");
const legacy = current
  .replace('import type { AsyncUserInputQuestion } from "./AsyncUserInputQuestion";\n', "")
  .replace(' questions: Array<AsyncUserInputQuestion> | null,', "");

test("only the measured legacy releases accept the exact reviewed additive delta", () => {
  for (const version of ["0.151.0", "0.152.0"]) {
    assert.equal(isReviewedLegacySurface(version, file, current, legacy), true);
  }
  for (const version of ["0.150.0", "0.153.0", "0.153.3", "1.0.0"]) {
    assert.equal(isReviewedLegacySurface(version, file, current, legacy), false);
  }
});

test("a changed baseline, changed older payload, or different schema still fails closed", () => {
  assert.equal(isReviewedLegacySurface("0.152.0", file, `${current}\n`, legacy), false);
  assert.equal(isReviewedLegacySurface("0.152.0", file, current, `${legacy}\n`), false);
  assert.equal(isReviewedLegacySurface("0.152.0", "ts/v2/ThreadStartParams.ts", current, legacy), false);
});
