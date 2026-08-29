import { FinanceAgentService } from "./finance-agent-service.js";
import { FinanceApiClient } from "./finance-api-client.js";
import { FinanceConsentJournal } from "./consent-journal.js";
import { FinanceGateway } from "./finance-gateway.js";
import {
  HOST_CONFIGURATION_TIMEOUT_MS,
  HOST_IPC_PROTOCOL_VERSION,
  prepareFinanceHostPaths,
  resolvePinnedCodexExecutable,
  validateFinanceHostInitialization,
} from "./host-bootstrap.js";

let apiClient: FinanceApiClient | undefined;
let gateway: FinanceGateway | undefined;
let stopping = false;

async function run(): Promise<void> {
  if (typeof process.send !== "function" || !process.connected) throw new Error("Parent IPC is required.");
  const dataRoot = requiredAbsoluteEnvironment("FINANCE_OS_AGENT_DATA_ROOT");
  const paths = prepareFinanceHostPaths(dataRoot);
  const service = new FinanceAgentService({
    codexProcess: {
      binaryPath: resolvePinnedCodexExecutable(),
      codexHome: paths.codexHome,
      home: paths.home,
      runtimeDirectory: paths.runtimeDirectory,
      temporaryDirectory: paths.temporaryDirectory,
    },
    consentJournal: new FinanceConsentJournal({ journalPath: paths.consentJournal }),
    emit: (event) => gateway?.publish(event),
    runtimeDirectory: paths.runtimeDirectory,
  });

  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    gateway && await gateway.stop().catch(() => undefined);
    gateway = undefined;
    apiClient?.clearCredential();
    apiClient = undefined;
    await service.stop().catch(() => undefined);
  };

  process.once("disconnect", () => { void shutdown().finally(() => process.exit(0)); });
  process.once("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
  process.once("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });

  await service.start();
  send({ protocolVersion: HOST_IPC_PROTOCOL_VERSION, type: "finance.ready_for_configuration" });
  const timer = setTimeout(() => { void shutdown().finally(() => process.exit(1)); }, HOST_CONFIGURATION_TIMEOUT_MS);
  timer.unref();
  process.once("message", (message) => {
    let stage = "validate";
    void (async () => {
      const initialization = validateFinanceHostInitialization(message);
      clearTimeout(timer);
      stage = "api_client";
      const client = new FinanceApiClient({ baseUrl: initialization.financeApiUrl });
      client.setCredential(initialization.financeApiToken);
      stage = "service";
      service.configureFinanceApi(client);
      stage = "gateway";
      const nextGateway = new FinanceGateway({
        capabilityToken: initialization.gatewayToken,
        service,
      });
      const address = await nextGateway.start();
      apiClient = client;
      gateway = nextGateway;
      await sendAsync({
        gatewayOrigin: address.origin,
        protocolVersion: HOST_IPC_PROTOCOL_VERSION,
        requestId: initialization.requestId,
        type: "finance.configured",
      });
    })().catch(async (error: unknown) => {
      send({
        code: `${stage}_${safeErrorCode(error)}`,
        protocolVersion: HOST_IPC_PROTOCOL_VERSION,
        type: "finance.configuration_failed",
      });
      await shutdown();
      process.exit(1);
    });
  });
}

function send(message: Record<string, unknown>): void {
  process.send?.(message);
}

function sendAsync(message: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    if (!process.send) return resolve();
    process.send(message, () => resolve());
  });
}

function requiredAbsoluteEnvironment(name: string): string {
  const value = process.env[name];
  if (!value || !value.startsWith("/")) throw new Error(`${name} is required.`);
  return value;
}

function safeErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z_]{1,64}$/.test(error.code)
  ) return error.code;
  return "configuration_rejected";
}

void run().catch(() => process.exit(1));
