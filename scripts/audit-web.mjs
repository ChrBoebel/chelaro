import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const patchedAdvisory = "GHSA-vfj7-8cjw-p6xm";
const patchedPath = "apps__web>eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>braces";
const patchHash = "571b108f2261e35515d22908ed244056944fc706063192667cfbda54cecfa888";

export function loadBraces() {
  let require = createRequire(new URL("apps/web/package.json", root));
  for (const dependency of ["eslint-config-next", "@next/eslint-plugin-next", "fast-glob", "micromatch"]) {
    require = createRequire(require.resolve(dependency));
  }
  assert.equal(require("braces/package.json").version, "3.0.3");
  return require("braces");
}

export function verifyBracesMitigation(patchFile = new URL("patches/braces@3.0.3.patch", root)) {
  const digest = createHash("sha256").update(readFileSync(patchFile)).digest("hex");
  assert.equal(digest, patchHash, "The reviewed braces patch has changed.");
  const braces = loadBraces();
  const nested = "{".repeat(256) + "a" + "}".repeat(256);
  for (const method of ["parse", "compile", "expand", "stringify"]) {
    assert.throws(() => braces[method](nested), /braces nesting exceeds safety limit/,
      `The installed braces.${method} does not enforce the reviewed nesting limit.`);
  }
}

export function isMitigatedAdvisory(advisory) {
  return advisory?.github_advisory_id === patchedAdvisory &&
    advisory.module_name === "braces" && Array.isArray(advisory.findings) &&
    advisory.findings.length > 0 && advisory.findings.every((finding) =>
      finding.version === "3.0.3" && Array.isArray(finding.paths) &&
      finding.paths.length > 0 && finding.paths.every((path) => path === patchedPath));
}

function main() {
  // A registry advisory still names the upstream version after pnpm applies a
  // patch. Accept only this exact development-tool path after checking both the
  // committed patch and the installed mitigation; every other high finding fails.
  verifyBracesMitigation();
  const result = spawnSync("pnpm", ["audit", "--json"], {
    cwd: fileURLToPath(root), encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || ![0, 1].includes(result.status)) {
    throw result.error ?? new Error(`Dependency audit failed: ${result.stderr}`);
  }
  const audit = JSON.parse(result.stdout);
  if (!audit.advisories || typeof audit.advisories !== "object" || !audit.metadata?.vulnerabilities) {
    throw new Error("Dependency audit returned an invalid response.");
  }
  const findings = Object.values(audit.advisories);
  for (const advisory of findings) {
    const mitigated = isMitigatedAdvisory(advisory);
    process.stdout.write(`${mitigated ? "Locally patched" : advisory.severity}: ${advisory.module_name} ${advisory.github_advisory_id}\n`);
  }
  const blockers = findings.filter((advisory) =>
    !isMitigatedAdvisory(advisory) &&
    (!['info', 'low', 'moderate'].includes(advisory.severity)));
  if (blockers.length) throw new Error(`${blockers.length} unmitigated high/critical dependency advisories.`);
  process.stdout.write("Dependency audit passed; the braces development-tool mitigation is verified.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
