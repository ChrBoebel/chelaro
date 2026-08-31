import type { ServerNotification } from "../generated/codex/ts/ServerNotification.js";
import type { ServerRequest } from "../generated/codex/ts/ServerRequest.js";
import { FinanceAgentService, type FinanceAgentServiceOptions } from "../src/finance-agent-service.js";
import { FinanceApiClient } from "../src/finance-api-client.js";
import { FinanceConsentJournal } from "../src/consent-journal.js";
import { FinanceGateway } from "../src/finance-gateway.js";
import {
  HOST_CONFIGURATION_TIMEOUT_MS,
  HOST_IPC_PROTOCOL_VERSION,
  prepareFinanceHostPaths,
  validateFinanceHostInitialization,
} from "../src/host-bootstrap.js";

type ProcessCallbacks = Parameters<NonNullable<FinanceAgentServiceOptions["processFactory"]>>[0];

let apiClient: FinanceApiClient | undefined;
let gateway: FinanceGateway | undefined;
let stopping = false;

class SyntheticFinanceProcess {
  readonly #callbacks: ProcessCallbacks;
  readonly #runtimeDirectory: string;
  #requestNumber = 0;
  #turnNumber = 0;

  constructor(callbacks: ProcessCallbacks, runtimeDirectory: string) {
    this.#callbacks = callbacks;
    this.#runtimeDirectory = runtimeDirectory;
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  async request(method: string): Promise<unknown> {
    switch (method) {
      case "account/read":
        return {
          account: { email: null, planType: "plus", type: "chatgpt" },
          requiresOpenaiAuth: true,
        };
      case "config/read":
        return { config: { mcp_servers: {} }, layers: null, origins: {} };
      case "thread/start":
        return safeThread(this.#runtimeDirectory);
      case "turn/start": {
        this.#turnNumber += 1;
        const providerTurnId = `provider_turn_e2e_${this.#turnNumber}`;
        setTimeout(() => {
          void this.#completeFinanceTurn(providerTurnId).catch((error: unknown) => {
            const failure = error instanceof Error ? error : new Error("Synthetic turn failed.");
            process.stderr.write(`[finance-e2e-host] ${failure.stack ?? failure.message}\n`);
            this.#callbacks.onFatalError(failure);
          });
        }, 25);
        return { turn: turn(providerTurnId, "inProgress", []) };
      }
      case "turn/interrupt":
        return {};
      case "thread/unsubscribe":
        return { status: "unsubscribed" };
      default:
        throw new Error(`Unexpected E2E process request: ${method}`);
    }
  }

  async #completeFinanceTurn(providerTurnId: string): Promise<void> {
    const threadId = "provider_thread_e2e";
    await this.#toolCall({
      arguments: {
        currency: "EUR",
        debtor_name: "Synthetische Testperson",
        description: "Testpizza",
        original_amount: "10.00",
        rationale: "Der synthetische E2E-Dialog bittet ausdrücklich um eine neue prüfbare Forderung.",
      },
      callId: "call_propose_create",
      namespace: "chelaro_finance",
      threadId,
      tool: "finance_propose_receivable_create",
      turnId: providerTurnId,
    });

    const message = agentMessage(
      "Ich habe die neue Forderung als prüfbaren Vorschlag vorbereitet. Deine Finanzdaten bleiben unverändert, bis du ihn in Chelaro prüfst und freigibst.",
    );
    for (const notification of [
      {
        method: "item/agentMessage/delta",
        params: { delta: message.text, itemId: message.id, threadId, turnId: providerTurnId },
      },
      {
        method: "item/completed",
        params: { completedAtMs: 2, item: message, threadId, turnId: providerTurnId },
      },
      {
        method: "turn/completed",
        params: { threadId, turn: turn(providerTurnId, "completed", [message]) },
      },
    ] as ServerNotification[]) this.#callbacks.onNotification(notification);
  }

  #toolCall(params: Extract<ServerRequest, { method: "item/tool/call" }>["params"]): Promise<unknown> {
    this.#requestNumber += 1;
    return this.#callbacks.onServerRequest({
      id: this.#requestNumber,
      method: "item/tool/call",
      params,
    });
  }
}

async function run(): Promise<void> {
  if (typeof process.send !== "function" || !process.connected) throw new Error("Parent IPC is required.");
  const dataRoot = process.env.FINANCE_OS_AGENT_DATA_ROOT;
  if (!dataRoot?.startsWith("/")) throw new Error("Absolute E2E data root required.");
  const paths = prepareFinanceHostPaths(dataRoot);
  const service = new FinanceAgentService({
    consentJournal: new FinanceConsentJournal({ journalPath: paths.consentJournal }),
    emit: (event) => gateway?.publish(event),
    processFactory: (callbacks) => new SyntheticFinanceProcess(callbacks, paths.runtimeDirectory),
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

  await service.start();
  process.send({ protocolVersion: HOST_IPC_PROTOCOL_VERSION, type: "finance.ready_for_configuration" });
  const timer = setTimeout(() => { void shutdown().finally(() => process.exit(1)); }, HOST_CONFIGURATION_TIMEOUT_MS);
  timer.unref();
  process.once("message", (message) => {
    void (async () => {
      const initialization = validateFinanceHostInitialization(message);
      clearTimeout(timer);
      const client = new FinanceApiClient({ baseUrl: initialization.financeApiUrl });
      client.setCredential(initialization.financeApiToken);
      service.configureFinanceApi(client);
      const nextGateway = new FinanceGateway({ capabilityToken: initialization.gatewayToken, service });
      const address = await nextGateway.start();
      apiClient = client;
      gateway = nextGateway;
      process.send?.({
        gatewayOrigin: address.origin,
        protocolVersion: HOST_IPC_PROTOCOL_VERSION,
        requestId: initialization.requestId,
        type: "finance.configured",
      });
    })().catch(async () => {
      process.send?.({
        code: "e2e_configuration_rejected",
        protocolVersion: HOST_IPC_PROTOCOL_VERSION,
        type: "finance.configuration_failed",
      });
      await shutdown();
      process.exit(1);
    });
  });
}

function safeThread(runtimeDirectory: string): Record<string, unknown> {
  return {
    activePermissionProfile: null,
    approvalPolicy: "never",
    approvalsReviewer: "user",
    cwd: runtimeDirectory,
    instructionSources: [],
    model: "gpt-e2e-finance",
    modelProvider: "openai",
    multiAgentMode: "explicitRequestOnly",
    reasoningEffort: null,
    runtimeWorkspaceRoots: [],
    sandbox: { networkAccess: false, type: "readOnly" },
    serviceTier: null,
    thread: {
      agentNickname: null,
      agentRole: null,
      cliVersion: "0.151.0",
      createdAt: 1,
      cwd: runtimeDirectory,
      ephemeral: true,
      forkedFromId: null,
      gitInfo: null,
      id: "provider_thread_e2e",
      modelProvider: "openai",
      name: null,
      parentThreadId: null,
      path: null,
      preview: "",
      projectId: null,
      recencyAt: 1,
      section: null,
      sectionEnteredAt: null,
      sessionId: "provider_thread_e2e",
      source: "appServer",
      status: { type: "idle" },
      threadSource: "appServer",
      turns: [],
      updatedAt: 1,
    },
  };
}

function agentMessage(text: string) {
  return {
    delivery: null,
    id: "provider_message_e2e",
    memoryCitation: null,
    phase: "final_answer" as const,
    text,
    type: "agentMessage" as const,
  };
}

function turn(id: string, status: "inProgress" | "completed", items: ReturnType<typeof agentMessage>[]) {
  return {
    completedAt: status === "completed" ? 2 : null,
    durationMs: status === "completed" ? 1_000 : null,
    error: null,
    id,
    items,
    itemsView: "full" as const,
    startedAt: 1,
    status,
  };
}

void run().catch(() => process.exit(1));
