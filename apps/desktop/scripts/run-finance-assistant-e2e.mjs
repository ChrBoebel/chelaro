import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(currentDirectory, "..");
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "finance-os-e2e-"));
const resultPath = path.join(temporaryRoot, "finance-assistant-e2e-result.json");
const electron = path.join(desktopRoot, "node_modules/.bin/electron");
let succeeded = false;

try {
  const environment = {
    ...process.env,
    FINANCE_OS_DATABASE_URL: sqliteDatabaseUrl(path.join(temporaryRoot, "finance-os.sqlite3")),
    FINANCE_OS_DOCUMENT_ROOT: path.join(temporaryRoot, "documents"),
    FINANCE_OS_ENV: "test",
    FINANCE_OS_E2E_DATA_ROOT: temporaryRoot,
    FINANCE_OS_E2E_SCENARIO: "finance-assistant",
    FINANCE_OS_QUARANTINE_ROOT: path.join(temporaryRoot, "quarantine"),
  };
  delete environment.ELECTRON_RUN_AS_NODE;

  const child = spawn(electron, ["."], {
    cwd: desktopRoot,
    detached: true,
    env: environment,
    stdio: "inherit",
  });
  const exitCode = await waitForExit(child, 180_000);
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  if (exitCode !== 0 || result.error || result.financeToolProposalCreated !== true) {
    throw new Error(`Finance Assistant E2E failed: ${JSON.stringify(result)}`);
  }
  succeeded = true;
  process.stdout.write(`Finance Assistant E2E passed: ${JSON.stringify(result)}\n`);
} finally {
  if (succeeded) {
    await rm(temporaryRoot, { force: true, recursive: true });
  } else {
    process.stderr.write(`Finance Assistant E2E diagnostics kept at ${temporaryRoot}\n`);
  }
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      reject(new Error("Finance Assistant E2E timed out."));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

function sqliteDatabaseUrl(databasePath) {
  return `sqlite+aiosqlite:///${path.resolve(databasePath).replaceAll("\\", "/")}`;
}
