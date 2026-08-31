import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const PRODUCT_PACKAGES = {
  desktop: "apps/desktop/package.json",
  root: "package.json",
  web: "apps/web/package.json",
};

export function assertProductVersionBump(baseVersions, currentVersions) {
  const base = synchronizedVersion(baseVersions, "Base");
  const current = synchronizedVersion(currentVersions, "Current");
  if (compareSemanticVersions(current, base) <= 0) {
    throw new Error(`Product version must increase above main (main=${base}, current=${current}).`);
  }
  return { from: base, to: current };
}

async function main() {
  const baseReference = baseReferenceFromArguments(process.argv.slice(2));
  const [baseVersions, currentVersions] = await Promise.all([
    versionsFromGit(baseReference),
    versionsFromWorkspace(),
  ]);
  const result = assertProductVersionBump(baseVersions, currentVersions);
  process.stdout.write(`Product version increased from ${result.from} to ${result.to}.\n`);
}

export function baseReferenceFromArguments(argumentsList) {
  const values = argumentsList[0] === "--" ? argumentsList.slice(1) : argumentsList;
  if (values.length !== 1) throw new Error("Exactly one base Git reference is required.");
  return validGitReference(values[0]);
}

function synchronizedVersion(versions, label) {
  if (!isRecord(versions) || Object.keys(PRODUCT_PACKAGES).some((name) => !(name in versions))) {
    throw new Error(`${label} product versions are incomplete.`);
  }
  const values = Object.keys(PRODUCT_PACKAGES).map((name) => versions[name]);
  if (values.some((value) => !isSemanticVersion(value))) {
    throw new Error(`${label} product versions must use stable Semantic Versioning.`);
  }
  if (new Set(values).size !== 1) {
    throw new Error(`${label} root, desktop, and web product versions must stay synchronized.`);
  }
  return values[0];
}

function compareSemanticVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

async function versionsFromWorkspace() {
  return Object.fromEntries(await Promise.all(
    Object.entries(PRODUCT_PACKAGES).map(async ([name, file]) => [
      name,
      JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), "utf8")).version,
    ]),
  ));
}

function versionsFromGit(reference) {
  return Object.fromEntries(Object.entries(PRODUCT_PACKAGES).map(([name, file]) => {
    const contents = execFileSync("git", ["show", `${reference}:${file}`], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return [name, JSON.parse(contents).version];
  }));
}

function validGitReference(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) ||
    value.includes("..") ||
    value.includes("//")
  ) {
    throw new Error("A safe base Git reference is required.");
  }
  return value;
}

function isSemanticVersion(value) {
  return typeof value === "string" && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
