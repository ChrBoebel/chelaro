import { FinanceAgentService } from "./finance-agent-service.js";
import { FinanceApiClient } from "./finance-api-client.js";
import { FinanceConsentJournal } from "./consent-journal.js";
import { FinanceGateway } from "./finance-gateway.js";
import {
  HOST_CONFIGURATION_TIMEOUT_MS,
  HOST_IPC_PROTOCOL_VERSION,
  prepareFinanceHostPaths,
  validateFinanceHostInitialization,
} from "./host-bootstrap.js";

let apiClient: FinanceApiClient | undefined;
let gateway: FinanceGateway | undefined;
let service: FinanceAgentService | undefined;
let stopping = false;

async function run(): Promise<void> {
  if (typeof process.send !== "function" || !process.connected) throw new Error("Parent IPC is required.");
  const dataRoot = requiredAbsoluteEnvironment("FINANCE_OS_AGENT_DATA_ROOT");
  const paths = prepareFinanceHostPaths(dataRoot);
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    gateway && await gateway.stop().catch(() => undefined);
    gateway = undefined;
    apiClient?.clearCredential();
    apiClient = undefined;
    await service?.stop().catch(() => undefined);
    service = undefined;
  };

  process.once("disconnect", () => { void shutdown().finally(() => process.exit(0)); });
  process.once("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
  process.once("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });

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
      const nextService = new FinanceAgentService({
        codexProvider: {
          binaryPath: initialization.codexBinaryPath,
          codexHome: initialization.codexHome,
          home: initialization.userHome,
          ...(process.env.PATH === undefined ? {} : { path: process.env.PATH }),
        },
        consentJournal: new FinanceConsentJournal({ journalPath: paths.consentJournal }),
        emit: (event) => gateway?.publish(event),
        runtimeDirectory: paths.runtimeDirectory,
        temporaryDirectory: paths.temporaryDirectory,
      });
      await nextService.start();
      nextService.configureFinanceApi(client);
      stage = "gateway";
      const nextGateway = new FinanceGateway({
        capabilityToken: initialization.gatewayToken,
        service: nextService,
      });
      const address = await nextGateway.start();
      apiClient = client;
      service = nextService;
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
