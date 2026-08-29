import { fork, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const API_HEALTH_URL = "http://127.0.0.1:8000/health";
export const API_READY_URL = "http://127.0.0.1:8000/ready";
export const WEB_URL = "http://127.0.0.1:3000";

const STARTUP_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 300;
const HOST_IPC_PROTOCOL_VERSION = 1;
const HOST_STARTUP_TIMEOUT_MS = 30_000;

export function isAllowedNavigation(target, appOrigin) {
  try {
    const url = new URL(target);
    return url.origin === appOrigin && ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export async function isFinanceApiAvailable(fetchImplementation = fetch) {
  try {
    const response = await fetchImplementation(API_HEALTH_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.status === "ok" && body?.service === "Chelaro API";
  } catch {
    return false;
  }
}

export async function isFinanceApiReady(fetchImplementation = fetch) {
  try {
    const response = await fetchImplementation(API_READY_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.status === "ready" && body?.service === "Chelaro API";
  } catch {
    return false;
  }
}

export async function isFinanceWebAvailable(fetchImplementation = fetch) {
  try {
    const response = await fetchImplementation(WEB_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return false;
    return (await response.text()).includes("Chelaro");
  } catch {
    return false;
  }
}

export async function waitForUrl(
  url,
  {
    timeoutMs = STARTUP_TIMEOUT_MS,
    fetchImplementation = fetch,
    validate = (response) => response.ok,
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetchImplementation(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      if (await validate(response)) return;
      lastError = new Error(`${url} antwortete mit Status ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(
    `${url} wurde nicht rechtzeitig bereit.${lastError ? ` ${lastError.message}` : ""}`,
  );
}

export function createProcessManager({ repoRoot, logger = console } = {}) {
  if (!repoRoot) throw new Error("repoRoot is required");

  const children = new Set();
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  function start(label, args) {
    return startExecutable(label, pnpm, args);
  }

  function startExecutable(label, command, args, options = {}) {
    logger.info(`[desktop] Starte ${label} …`);
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      detached: process.platform !== "win32",
      stdio: "inherit",
    });
    children.add(child);
    child.once("exit", (code, signal) => {
      children.delete(child);
      logger.info(
        `[desktop] ${label} beendet (${signal ? `Signal ${signal}` : `Code ${code}`}).`,
      );
    });
    child.once("error", (error) => {
      logger.error(`[desktop] ${label} konnte nicht gestartet werden:`, error);
    });
    return child;
  }

  function startForked(label, modulePath, options = {}) {
    logger.info(`[desktop] Starte ${label} …`);
    const child = fork(modulePath, [], {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    children.add(child);
    child.once("exit", (code, signal) => {
      children.delete(child);
      logger.info(
        `[desktop] ${label} beendet (${signal ? `Signal ${signal}` : `Code ${code}`}).`,
      );
    });
    child.once("error", (error) => {
      logger.error(`[desktop] ${label} konnte nicht gestartet werden:`, error);
    });
    return child;
  }

  async function run(label, args) {
    logger.info(`[desktop] ${label} …`);
    await new Promise((resolve, reject) => {
      const child = spawn(pnpm, args, {
        cwd: repoRoot,
        env: process.env,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.add(child);
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-8_000);
      });
      child.stdout.on("data", (chunk) => logger.info(chunk.toString().trimEnd()));
      child.once("error", (error) => {
        children.delete(child);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        children.delete(child);
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            `${label} ist fehlgeschlagen (${signal ?? `Code ${code}`}).${stderr ? `\n${stderr.trim()}` : ""}`,
          ),
        );
      });
    });
  }

  async function stopAll() {
    const activeChildren = [...children].filter(
      (child) => child.pid && child.exitCode === null && child.signalCode === null,
    );
    const exits = activeChildren.map(
      (child) => new Promise((resolve) => child.once("exit", resolve)),
    );

    for (const child of activeChildren) signalProcess(child, "SIGTERM");
    await Promise.race([Promise.all(exits), delay(5_000)]);

    for (const child of activeChildren) {
      if (child.exitCode === null && child.signalCode === null) signalProcess(child, "SIGKILL");
    }
    children.clear();
  }

  function signalProcess(child, signal) {
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") logger.error("[desktop] Prozess-Stopp fehlgeschlagen:", error);
    }
  }

  return { repoRoot, run, start, startExecutable, startForked, stopAll };
}

export async function startFinanceServices(
  processManager,
  {
    agentDataRoot,
    agentHostEntryPath,
    environment = process.env,
    prepareDatabase = true,
  } = {},
) {
  const apiWasRunning = await isFinanceApiAvailable();
  const apiWasReady = apiWasRunning && (await isFinanceApiReady());
  const webWasRunning = await isFinanceWebAvailable();
  const credentials = apiWasRunning
    ? existingSourceCredentials(environment)
    : createSourceCredentials();

  if (!apiWasReady) {
    if (prepareDatabase) {
      await processManager.run("Lokale Datenbank vorbereiten", ["infra:up"]);
      await processManager.run("Datenbank-Migrationen anwenden", ["migrate:api"]);
    }
    if (!apiWasRunning) {
      processManager.startExecutable("Chelaro API", pnpmExecutable(), ["start:api"], {
        env: apiEnvironment(environment, credentials),
      });
    }
    await waitForUrl(API_READY_URL, {
      validate: async (response) => {
        if (!response.ok) return false;
        const body = await response.json();
        return body?.status === "ready" && body?.service === "Chelaro API";
      },
    });
  }

  let assistant;
  if (!webWasRunning && credentials?.financeAssistantToken && agentDataRoot) {
    try {
      await processManager.run("Finanzassistent bauen", ["build:agent-host"]);
      assistant = await startFinanceAgentHost(processManager, {
        agentDataRoot,
        environment,
        financeApiToken: credentials.financeAssistantToken,
        financeApiUrl: "http://127.0.0.1:8000/",
        hostEntryPath: agentHostEntryPath,
      });
    } catch (error) {
      console.error(
        "[desktop] Finanzassistent bleibt deaktiviert:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (!webWasRunning) {
    await processManager.run("Web-Oberfläche bauen", ["build:web"]);
    processManager.startExecutable("Chelaro Web", pnpmExecutable(), ["start:web"], {
      env: webEnvironment(environment, credentials?.ownerToken, assistant),
    });
    await waitForUrl(WEB_URL, {
      validate: async (response) => response.ok && (await response.text()).includes("Chelaro"),
    });
  }

  return {
    apiWasRunning,
    assistantAvailable: Boolean(assistant),
    webWasRunning,
    webUrl: WEB_URL,
  };
}

export async function startFinanceAgentHost(
  processManager,
  {
    agentDataRoot,
    environment = process.env,
    financeApiToken,
    financeApiUrl,
    hostEntryPath,
  },
) {
  if (!path.isAbsolute(agentDataRoot)) throw new Error("Agent data root must be absolute.");
  const gatewayToken = randomBytes(32).toString("hex");
  const requestId = randomBytes(16).toString("hex");
  const hostPath = hostEntryPath ?? path.join(
    processManager.repoRoot,
    "apps/agent-host/dist/src/main.js",
  );
  if (!path.isAbsolute(hostPath)) throw new Error("Finance host entry must be absolute.");
  const child = processManager.startForked("Chelaro Finanzassistent", hostPath, {
    env: hostEnvironment(environment, agentDataRoot),
  });

  await waitForChildMessage(child, (message) =>
    isExactRecord(message, {
      protocolVersion: HOST_IPC_PROTOCOL_VERSION,
      type: "finance.ready_for_configuration",
    }),
  );
  const configuredMessage = waitForChildMessage(
    child,
    (message) => isConfiguredHostMessage(message, requestId),
  );
  child.send({
    financeApiToken,
    financeApiUrl,
    gatewayToken,
    protocolVersion: HOST_IPC_PROTOCOL_VERSION,
    requestId,
    type: "finance.configure",
  });
  const configured = await configuredMessage;
  return { gatewayOrigin: configured.gatewayOrigin, gatewayToken };
}

export function createSourceCredentials() {
  return {
    financeAssistantToken: randomBytes(32).toString("hex"),
    ownerToken: randomBytes(32).toString("hex"),
  };
}

export function existingSourceCredentials(environment) {
  const ownerToken = environment.FINANCE_OS_API_TOKEN;
  const financeAssistantToken = environment.FINANCE_OS_FINANCE_ASSISTANT_TOKEN;
  if (!validCredential(ownerToken)) return undefined;
  return {
    financeAssistantToken:
      validCredential(financeAssistantToken) && ownerToken !== financeAssistantToken
        ? financeAssistantToken
        : undefined,
    ownerToken,
  };
}

export function apiEnvironment(environment, credentials) {
  return {
    ...withoutAssistantCapabilities(environment),
    FINANCE_OS_API_TOKEN: credentials.ownerToken,
    FINANCE_OS_FINANCE_ASSISTANT_TOKEN: credentials.financeAssistantToken,
  };
}

export function webEnvironment(environment, ownerToken, assistant) {
  const result = withoutBackendCapabilities(environment);
  if (ownerToken) result.FINANCE_OS_API_TOKEN = ownerToken;
  if (assistant) {
    result.FINANCE_OS_FINANCE_GATEWAY_URL = assistant.gatewayOrigin;
    result.FINANCE_OS_FINANCE_GATEWAY_TOKEN = assistant.gatewayToken;
  }
  return result;
}

export function hostEnvironment(environment, agentDataRoot) {
  const result = { FINANCE_OS_AGENT_DATA_ROOT: agentDataRoot };
  for (const name of ["LANG", "LC_ALL", "PATH", "SystemRoot", "TMPDIR"]) {
    if (typeof environment[name] === "string") result[name] = environment[name];
  }
  return result;
}

function withoutAssistantCapabilities(environment) {
  const result = { ...environment };
  delete result.FINANCE_OS_AGENT_TOKEN;
  delete result.FINANCE_OS_API_TOKEN;
  delete result.FINANCE_OS_FINANCE_ASSISTANT_TOKEN;
  delete result.FINANCE_OS_FINANCE_GATEWAY_TOKEN;
  delete result.FINANCE_OS_FINANCE_GATEWAY_URL;
  return result;
}

function withoutBackendCapabilities(environment) {
  const result = withoutAssistantCapabilities(environment);
  delete result.FINANCE_OS_DATABASE_URL;
  delete result.FINANCE_OS_DOCUMENT_ROOT;
  delete result.FINANCE_OS_POSTGRES_PASSWORD;
  delete result.FINANCE_OS_QUARANTINE_ROOT;
  return result;
}

function validCredential(value) {
  return typeof value === "string" && value.length >= 16 && value.length <= 512 && !/[\r\n]/.test(value);
}

function pnpmExecutable() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function waitForChildMessage(child, predicate, timeoutMs = HOST_STARTUP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Finance host startup timed out.")), timeoutMs);
    timer.unref?.();

    const onMessage = (message) => {
      if (isHostFailureMessage(message)) {
        finish(new Error(`Finance host rejected its configuration (${message.code}).`));
        return;
      }
      if (predicate(message)) finish(undefined, message);
    };
    const onError = (error) => finish(error);
    const onExit = (code, signal) => {
      finish(new Error(`Finance host exited before startup (${signal ?? `code ${code}`}).`));
    };
    const finish = (error, message) => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve(message);
    };

    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function isConfiguredHostMessage(message, requestId) {
  if (
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message) ||
    JSON.stringify(Object.keys(message).sort()) !==
      JSON.stringify(["gatewayOrigin", "protocolVersion", "requestId", "type"])
  ) return false;
  if (
    message.type !== "finance.configured" ||
    message.protocolVersion !== HOST_IPC_PROTOCOL_VERSION ||
    message.requestId !== requestId ||
    typeof message.gatewayOrigin !== "string"
  ) return false;
  try {
    const origin = new URL(message.gatewayOrigin);
    return (
      origin.protocol === "http:" &&
      origin.hostname === "127.0.0.1" &&
      origin.port !== "" &&
      origin.pathname === "/" &&
      origin.search === "" &&
      origin.hash === "" &&
      origin.username === "" &&
      origin.password === ""
    );
  } catch {
    return false;
  }
}

function isHostFailureMessage(message) {
  return Boolean(
    message &&
      typeof message === "object" &&
      !Array.isArray(message) &&
      message.type === "finance.configuration_failed" &&
      message.protocolVersion === HOST_IPC_PROTOCOL_VERSION &&
      typeof message.code === "string" &&
      /^[a-z_]{1,128}$/.test(message.code),
  );
}

function isExactRecord(value, expected) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) === JSON.stringify(Object.keys(expected).sort()) &&
      Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue),
  );
}

export async function startPackagedFinanceServices(
  processManager,
  { resourcesPath, userDataPath, executablePath },
) {
  const apiPort = await findAvailablePort();
  let webPort = await findAvailablePort();
  while (webPort === apiPort) webPort = await findAvailablePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const runtimeToken = randomBytes(32).toString("hex");
  const dataPath = path.join(userDataPath, "data");
  const apiExecutable = path.join(
    resourcesPath,
    "runtime/api",
    process.platform === "win32" ? "finance-os-api.exe" : "finance-os-api",
  );
  const webServer = path.join(resourcesPath, "runtime/web/apps/web/server.js");

  const apiEnvironment = {
    ...process.env,
    FINANCE_OS_ENV: "production",
    FINANCE_OS_API_HOST: "127.0.0.1",
    FINANCE_OS_API_PORT: String(apiPort),
    FINANCE_OS_API_TOKEN: runtimeToken,
    FINANCE_OS_DATABASE_URL: sqliteDatabaseUrl(path.join(dataPath, "finance-os.sqlite3")),
    FINANCE_OS_DOCUMENT_ROOT: path.join(dataPath, "documents"),
    FINANCE_OS_QUARANTINE_ROOT: path.join(dataPath, "quarantine"),
    FINANCE_OS_WEB_ORIGIN: webUrl,
  };
  processManager.startExecutable("eingebettete Chelaro API", apiExecutable, [], {
    cwd: path.dirname(apiExecutable),
    env: apiEnvironment,
  });
  await waitForUrl(`${apiUrl}/ready`, {
    validate: async (response) => {
      if (!response.ok) return false;
      const body = await response.json();
      return body?.status === "ready" && body?.service === "Chelaro API";
    },
  });

  processManager.startExecutable("eingebettete Chelaro-Oberfläche", executablePath, [webServer], {
    cwd: path.dirname(webServer),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      FINANCE_OS_API_URL: apiUrl,
      FINANCE_OS_API_TOKEN: runtimeToken,
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      PORT: String(webPort),
    },
  });
  await waitForUrl(webUrl, {
    validate: async (response) => response.ok && (await response.text()).includes("Chelaro"),
  });

  return { apiWasRunning: false, webWasRunning: false, webUrl };
}

export async function findAvailablePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("No local port was allocated."));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

export function sqliteDatabaseUrl(databasePath) {
  const normalizedPath = path.resolve(databasePath).replaceAll("\\", "/");
  return `sqlite+aiosqlite:///${normalizedPath}`;
}
