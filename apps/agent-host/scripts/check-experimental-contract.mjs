import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const codexEntry = join(packageRoot, "node_modules", "@openai", "codex", "bin", "codex.js");
const pinnedVersion = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).devDependencies["@openai/codex"];
const codexPackagePath = join(packageRoot, "node_modules", "@openai", "codex", "package.json");

if (!existsSync(codexEntry) || !existsSync(codexPackagePath)) {
  throw new Error("Pinned @openai/codex dependency is missing; run pnpm install first.");
}
const metadata = JSON.parse(readFileSync(codexPackagePath, "utf8"));
if (metadata.version !== pinnedVersion) throw new Error("Unexpected Codex package version.");

const temporaryRoot = mkdtempSync(join(tmpdir(), "finance-os-codex-experimental-"));
try {
  for (const [command, directory] of [
    ["generate-ts", "ts"],
    ["generate-json-schema", "schema"],
  ]) {
    const result = spawnSync(
      process.execPath,
      [codexEntry, "app-server", command, "--experimental", "--out", join(temporaryRoot, directory)],
      { cwd: packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    if (result.status !== 0) {
      throw new Error(`Experimental Codex schema generation failed: ${result.stderr || result.stdout}`);
    }
  }

  const typeSource = readFileSync(join(temporaryRoot, "ts", "v2", "ThreadStartParams.ts"), "utf8");
  for (const exactFragment of [
    "environments?: Array<TurnEnvironmentParams> | null",
    "dynamicTools?: Array<DynamicToolSpec> | null",
  ]) {
    if (!typeSource.includes(exactFragment)) {
      throw new Error(`Pinned experimental ThreadStartParams is missing: ${exactFragment}`);
    }
  }
  const schema = JSON.parse(
    readFileSync(join(temporaryRoot, "schema", "v2", "ThreadStartParams.json"), "utf8"),
  );
  const properties = schema.properties ?? {};
  if (!properties.dynamicTools || !properties.environments) {
    throw new Error("Pinned experimental JSON schema omits finance thread fields.");
  }
  const stableSchema = JSON.parse(
    readFileSync(join(packageRoot, "generated", "codex", "schema", "v2", "ThreadStartParams.json"), "utf8"),
  );
  if (stableSchema.properties?.dynamicTools || stableSchema.properties?.environments) {
    throw new Error("Stable runtime schema unexpectedly exposes experimental finance fields.");
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
