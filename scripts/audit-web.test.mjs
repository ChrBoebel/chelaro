import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isMitigatedAdvisory, loadBraces, verifyBracesMitigation } from "./audit-web.mjs";

test("braces rejects excessive brace and parenthesis nesting without changing ordinary globs", () => {
  verifyBracesMitigation();
  const braces = loadBraces();
  assert.deepEqual(braces.expand("src/{web,desktop}/*.{js,ts}"), [
    "src/web/*.js", "src/web/*.ts", "src/desktop/*.js", "src/desktop/*.ts",
  ]);
  assert.equal(braces.compile("src/{web,desktop}"), "src/(web|desktop)");
  for (const [open, close] of [["{", "}"], ["(", ")"]]) {
    const input = open.repeat(2000) + "x" + close.repeat(2000);
    for (const method of ["parse", "compile", "expand", "stringify"]) {
      assert.throws(() => braces[method](input, { maxDepth: Infinity }), /nesting exceeds safety limit/);
    }
  }
});

test("braces bounds directly supplied ASTs before recursive walkers exhaust the stack", () => {
  const braces = loadBraces();
  for (const method of ["compile", "expand", "stringify"]) {
    const ast = { type: "root", nodes: [] };
    let node = ast;
    for (let depth = 0; depth < 512; depth++) {
      const child = { type: "brace", nodes: [], parent: node };
      node.nodes.push(child);
      node = child;
    }
    assert.throws(() => braces[method](ast), /nesting exceeds safety limit/);
  }
});

test("audit exception is restricted to the patched version and exact development-tool path", () => {
  const advisory = {
    github_advisory_id: "GHSA-vfj7-8cjw-p6xm", module_name: "braces",
    findings: [{ version: "3.0.3", paths: ["apps__web>eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>braces"] }],
  };
  assert.equal(isMitigatedAdvisory(advisory), true);
  for (const changed of [
    { ...advisory, github_advisory_id: "GHSA-new-advisory" },
    { ...advisory, findings: [{ version: "3.0.4", paths: advisory.findings[0].paths }] },
    { ...advisory, findings: [{ version: "3.0.3", paths: ["apps__web>runtime>braces"] }] },
    { ...advisory, findings: [] },
    { ...advisory, findings: [{ version: "3.0.3", paths: [] }] },
  ]) assert.equal(isMitigatedAdvisory(changed), false);
});

test("audit rejects a modified or missing mitigation patch", () => {
  const temporary = mkdtempSync(join(tmpdir(), "chelaro-audit-test-"));
  try {
    const patch = join(temporary, "modified.patch");
    writeFileSync(patch, "modified");
    assert.throws(() => verifyBracesMitigation(patch), /reviewed braces patch has changed/);
    assert.throws(() => verifyBracesMitigation(join(temporary, "missing.patch")), /ENOENT/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
