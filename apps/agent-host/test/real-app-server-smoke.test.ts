import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createInterface } from "node:readline";

const codexEntry = resolve(
  dirname(new URL(import.meta.url).pathname),
  "../../node_modules/@openai/codex/bin/codex.js",
);

test("contract: pinned real App Server accepts the restrictive initialize handshake", async () => {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");

  const temporaryRoot = mkdtempSync(join(tmpdir(), "finance-os-real-codex-"));
  const codexHome = join(temporaryRoot, "codex-home");
  mkdirSync(codexHome, { mode: 0o700 });
  writeFileSync(join(codexHome, "config.toml"), "[analytics]\nenabled = false\n", {
    mode: 0o600,
  });

  const child = spawn(
    process.execPath,
    [codexEntry, "app-server", "--stdio", "--strict-config"],
    {
      cwd: temporaryRoot,
      env: {
        CODEX_HOME: codexHome,
        HOME: temporaryRoot,
        LANG: "C.UTF-8",
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        TMPDIR: temporaryRoot,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-16_384);
  });

  try {
    const responsePromise = new Promise<Record<string, unknown>>((resolveResponse, reject) => {
      const output = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
      const timer = setTimeout(() => reject(new Error(`App Server initialize timed out: ${stderr}`)), 15_000);
      output.on("line", (line) => {
        const response = JSON.parse(line);
        if (response.id === 1) {
          clearTimeout(timer);
          output.close();
          resolveResponse(response);
        }
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timer);
          reject(new Error(`App Server exited with ${code}: ${stderr}`));
        }
      });
    });

    child.stdin.write(
      `${JSON.stringify({
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "finance-os", title: "Finance OS", version: "0.1.0" },
          capabilities: {
            experimentalApi: false,
            requestAttestation: false,
            mcpServerOpenaiFormElicitation: false,
            extensions: null,
          },
        },
      })}\n`,
    );
    const response = await responsePromise;
    assert.equal("error" in response, false, JSON.stringify(response));
    const result = response.result as Record<string, unknown>;
    assert.equal(realpathSync(String(result.codexHome)), realpathSync(codexHome));
    assert.equal(result.platformOs, "macos");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolveClose) => child.once("close", resolveClose));
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
