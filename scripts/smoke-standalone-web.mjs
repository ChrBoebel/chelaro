import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const serverPath = path.join(
  repositoryRoot,
  "apps/web/.next/standalone/apps/web/server.js",
);
const port = await availablePort();
let output = "";

const child = spawn(process.execPath, [serverPath], {
  cwd: path.dirname(serverPath),
  env: {
    FINANCE_OS_API_TOKEN: "standalone-smoke-test-capability",
    FINANCE_OS_API_URL: "http://127.0.0.1:1",
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    PATH: process.env.PATH ?? "",
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-8_000);
  });
}

try {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Standalone web server exited with code ${child.exitCode}.\n${output}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(1_000),
      });
      const body = await response.text();
      if (!response.ok || !body.includes("Chelaro")) {
        throw new Error(`Standalone web server returned status ${response.status}.`);
      }
      console.info(`Standalone Chelaro web runtime is ready on loopback port ${port}.`);
      process.exitCode = 0;
      break;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Standalone web server returned")) {
        throw error;
      }
    }
    await delay(200);
  }
  if (process.exitCode !== 0) {
    throw new Error(`Standalone web server did not become ready.\n${output}`);
  }
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(3_000).then(() => child.kill("SIGKILL")),
  ]);
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("No loopback port was allocated."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
