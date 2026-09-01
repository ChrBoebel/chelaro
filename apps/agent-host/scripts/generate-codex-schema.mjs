import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedRoot = join(packageRoot, "generated", "codex");
const codexEntry = join(packageRoot, "node_modules", "@openai", "codex", "bin", "codex.js");
const codexPackagePath = join(packageRoot, "node_modules", "@openai", "codex", "package.json");
const checkOnly = process.argv.includes("--check");

if (!existsSync(codexEntry) || !existsSync(codexPackagePath)) {
  throw new Error("Pinned @openai/codex dependency is missing; run pnpm install first.");
}
const codexPackage = JSON.parse(readFileSync(codexPackagePath, "utf8"));
if (codexPackage.version !== "0.152.0" || codexPackage.license !== "Apache-2.0") {
  throw new Error("Unexpected @openai/codex version or license metadata.");
}

function generate(targetRoot) {
  const commands = [
    ["generate-ts", join(targetRoot, "ts")],
    ["generate-json-schema", join(targetRoot, "schema")],
  ];

  for (const [command, output] of commands) {
    const result = spawnSync(
      process.execPath,
      [codexEntry, "app-server", command, "--out", output],
      { cwd: packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    if (result.status !== 0) {
      throw new Error(
        `Codex schema generation failed (${command}): ${result.stderr || result.stdout}`,
      );
    }
  }
  writeFileSync(
    join(targetRoot, "manifest.json"),
    `${JSON.stringify(
      {
        package: "@openai/codex",
        version: codexPackage.version,
        license: codexPackage.license,
        experimental: false,
      },
      null,
      2,
    )}\n`,
  );
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .map((path) => relative(root, path))
    .sort();
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertEqual(expectedRoot, actualRoot) {
  const expectedFiles = listFiles(expectedRoot);
  const actualFiles = listFiles(actualRoot);
  if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) {
    throw new Error("Generated Codex schema file list differs; run pnpm generate:codex-schema.");
  }
  for (const file of expectedFiles) {
    if (digest(join(expectedRoot, file)) !== digest(join(actualRoot, file))) {
      throw new Error(`Generated Codex schema drift detected in ${file}.`);
    }
  }
}

if (checkOnly) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "finance-os-codex-schema-"));
  try {
    generate(temporaryRoot);
    assertEqual(generatedRoot, temporaryRoot);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
} else {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "finance-os-codex-schema-"));
  try {
    generate(temporaryRoot);
    rmSync(generatedRoot, { recursive: true, force: true });
    cpSync(temporaryRoot, generatedRoot, { recursive: true });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
