/**
 * Decides whether a Codex CLI installation may be added to
 * `SUPPORTED_CODEX_VERSIONS`.
 *
 * The checked-in schemas under `generated/codex` come from exactly one release
 * (`SCHEMA_CODEX_VERSION`). Accepting a second release is only safe when that
 * release agrees with those schemas everywhere Chelaro touches the protocol:
 *
 *   1. Strict surface -- every type Chelaro sends, validates, or answers must
 *      be byte-identical, except for exact reviewed legacy deltas.
 *   2. Server-to-client unions -- the release may not offer a notification or
 *      request method the checked-in schemas do not describe, because an
 *      unknown method is one nobody classified against ADR 0010.
 *
 * Everything else is reported but does not fail. Those files describe
 * capabilities the finance thread does not enable and cannot reach, and a
 * release older than the checked-in schemas is legitimately missing the types
 * a newer one added.
 *
 * Usage:
 *   node scripts/check-codex-compat.mjs                    # the pinned dependency
 *   node scripts/check-codex-compat.mjs --binary /path/to/codex
 */
import { isReviewedLegacySurface } from "./codex-reviewed-legacy-surfaces.mjs";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedRoot = join(packageRoot, "generated", "codex");

/**
 * Everything Chelaro sends, validates against, or answers. Kept as explicit
 * paths so adding a validated response without extending this list is visible
 * in review rather than silently unprotected.
 */
const STRICT_SURFACE = [
  "schema/v1/InitializeResponse.json",
  "schema/v2/GetAccountResponse.json",
  "schema/v2/LoginAccountResponse.json",
  "schema/v2/ModelListResponse.json",
  "schema/v2/ThreadResumeResponse.json",
  "schema/v2/ThreadStartResponse.json",
  "schema/v2/TurnStartResponse.json",
  "ts/InitializeParams.ts",
  "ts/v2/DynamicToolCallParams.ts",
  "ts/v2/DynamicToolCallResponse.ts",
  "ts/v2/ThreadItem.ts",
  "ts/v2/ThreadStartParams.ts",
  "ts/v2/TurnStartParams.ts",
];

/**
 * The two server-to-client unions. These legitimately differ between releases,
 * so they are checked by membership rather than by bytes: an allowlisted
 * release may send fewer methods than the checked-in schemas describe, never
 * more. `SCHEMA_CODEX_VERSION` is the newest allowlisted release, so every
 * other one is older and its payloads validate against the superset schema.
 */
const UNION_SOURCES = [
  { label: "server notification", schema: "schema/ServerNotification.json", ts: "ts/ServerNotification.ts" },
  { label: "server request", schema: "schema/ServerRequest.json", ts: "ts/ServerRequest.ts" },
];

function parseArguments(argv) {
  const values = argv[0] === "--" ? argv.slice(1) : argv;
  if (values.length === 0) return { binary: null };
  if (values.length === 2 && values[0] === "--binary") {
    const binary = values[1];
    if (typeof binary !== "string" || binary.length === 0 || /[\r\n\0]/.test(binary)) {
      throw new Error("The Codex binary path is invalid.");
    }
    return { binary: resolve(binary) };
  }
  throw new Error("Usage: check-codex-compat.mjs [--binary <path to codex>]");
}

function pinnedEntry() {
  const entry = join(packageRoot, "node_modules", "@openai", "codex", "bin", "codex.js");
  const metadata = join(packageRoot, "node_modules", "@openai", "codex", "package.json");
  if (!existsSync(entry) || !existsSync(metadata)) {
    throw new Error("Pinned @openai/codex dependency is missing; run pnpm install first.");
  }
  return {
    command: process.execPath,
    prefix: [entry],
    version: JSON.parse(readFileSync(metadata, "utf8")).version,
  };
}

function externalBinary(binary) {
  if (!existsSync(binary)) throw new Error(`No Codex executable at ${binary}.`);
  const reported = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 15_000 });
  if (reported.status !== 0) throw new Error(`${binary} did not report a version.`);
  const match = /^codex-cli ([0-9]+\.[0-9]+\.[0-9]+)$/u.exec(reported.stdout.trim());
  if (!match) throw new Error(`${binary} reported an unreadable version: ${reported.stdout.trim()}`);
  return { command: binary, prefix: [], version: match[1] };
}

function generate(runtime, targetRoot) {
  const commands = [
    ["generate-ts", join(targetRoot, "ts")],
    ["generate-json-schema", join(targetRoot, "schema")],
  ];
  for (const [command, output] of commands) {
    const result = spawnSync(
      runtime.command,
      [...runtime.prefix, "app-server", command, "--out", output],
      { cwd: packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 },
    );
    if (result.status !== 0) {
      throw new Error(`Codex schema generation failed (${command}): ${result.stderr || result.stdout}`);
    }
  }
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .filter((path) => path !== "manifest.json")
    .sort();
}

/**
 * Guards the list above against the code drifting away from it: every schema
 * the runtime validator compiles must be part of the strict surface, otherwise
 * a response Chelaro validates would go unprotected by this check.
 */
function assertStrictSurfaceCoversValidator() {
  const source = readFileSync(join(packageRoot, "src", "runtime-validator.ts"), "utf8");
  const compiled = [...source.matchAll(/compileSchema\(\s*"\.\.\/\.\.\/generated\/codex\/([^"]+)"/gu)]
    .map(([, path]) => `schema/${path.replace(/^schema\//u, "")}`);
  if (compiled.length === 0) throw new Error("No compiled Codex schemas were found in runtime-validator.ts.");
  const covered = [...STRICT_SURFACE, ...UNION_SOURCES.map(({ schema }) => schema)];
  const missing = compiled.filter((path) => !covered.includes(path));
  if (missing.length > 0) {
    throw new Error(
      `Neither STRICT_SURFACE nor UNION_SOURCES covers every validated Codex response: ${missing.join(", ")}.`,
    );
  }
}

function unionMethods(root, file) {
  const source = readFileSync(join(root, file), "utf8");
  return new Set([...source.matchAll(/\{ "method": "([^"]+)"/gu)].map(([, method]) => method));
}

function main() {
  const { binary } = parseArguments(process.argv.slice(2));
  assertStrictSurfaceCoversValidator();
  const runtime = binary === null ? pinnedEntry() : externalBinary(binary);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "chelaro-codex-compat-"));
  const failures = [];
  const notes = [];
  try {
    generate(runtime, temporaryRoot);

    const expected = listFiles(generatedRoot);
    const actual = new Set(listFiles(temporaryRoot));

    for (const file of STRICT_SURFACE) {
      if (!actual.has(file)) {
        failures.push(`does not produce ${file}`);
        continue;
      }
      const before = readFileSync(join(generatedRoot, file));
      const after = readFileSync(join(temporaryRoot, file));
      if (!before.equals(after) && !isReviewedLegacySurface(runtime.version, file, before, after)) failures.push(`changes ${file}, which Chelaro sends or validates`);
    }

    for (const { label, ts } of UNION_SOURCES) {
      if (!actual.has(ts)) {
        failures.push(`does not produce ${ts}`);
        continue;
      }
      const known = unionMethods(generatedRoot, ts);
      for (const method of unionMethods(temporaryRoot, ts)) {
        if (!known.has(method)) failures.push(`sends the unreviewed ${label} ${method}`);
      }
    }

    for (const file of expected) {
      if (STRICT_SURFACE.includes(file)) continue;
      if (!actual.has(file)) {
        notes.push(`${file} (absent)`);
      } else if (!readFileSync(join(generatedRoot, file)).equals(readFileSync(join(temporaryRoot, file)))) {
        notes.push(`${file} (differs)`);
      }
    }
    for (const file of actual) {
      if (!expected.includes(file)) notes.push(`${file} (added)`);
    }
    notes.sort();
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }

  const subject = `codex-cli ${runtime.version}`;
  if (notes.length > 0) {
    process.stdout.write(
      `${subject} differs from the checked-in schemas outside the surface Chelaro uses:\n` +
        `${notes.map((file) => `  ${file}\n`).join("")}` +
        "Review each one before adding the release to SUPPORTED_CODEX_VERSIONS.\n",
    );
  }
  if (failures.length > 0) {
    process.stderr.write(
      `${subject} is not compatible with the checked-in Codex schemas:\n` +
        `${failures.map((failure) => `  it ${failure}\n`).join("")}`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `${subject} matches every strict surface (including exact reviewed legacy deltas).\n`,
  );
}

main();
