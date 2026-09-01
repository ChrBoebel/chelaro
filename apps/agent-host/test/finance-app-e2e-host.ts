import type { ServerNotification } from "../generated/codex/ts/ServerNotification.js";
import type { ServerRequest } from "../generated/codex/ts/ServerRequest.js";
import { SCHEMA_CODEX_VERSION } from "../src/codex-provider.js";
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

  async request(method: string, params?: unknown): Promise<unknown> {
    switch (method) {
      case "account/read":
        return {
          account: { email: null, planType: "plus", type: "chatgpt" },
          requiresOpenaiAuth: true,
        };
      case "config/read":
        return { config: { mcp_servers: {} }, layers: null, origins: {} };
      case "model/list":
        return { data: FINANCE_E2E_MODELS.map(catalogModel), nextCursor: null };
      case "thread/start":
        // ADR 0014 only accepts a thread that echoes the requested model,
        // effort, and service tier, so the synthetic App Server has to answer
        // the way the real one does.
        return echoedThread(this.#runtimeDirectory, params);
      case "thread/resume":
        // A resumed thread carries three more fields than a started one.
        return {
          ...echoedThread(this.#runtimeDirectory, params),
          initialTurnsPage: null,
          itemsBackwardsCursor: '{"scope":{"kind":"itemsByCreatedAtOrdinal"}}',
          runtimeWorkspaceRoots: [this.#runtimeDirectory],
          turnsBackwardsCursor: '{"scope":{"kind":"turns"}}',
        };
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
      case "thread/delete":
        return {};
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
      namespace: null,
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

const FINANCE_E2E_MODELS = ["gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"] as const;

function catalogModel(model: string): Record<string, unknown> {
  return {
    additionalSpeedTiers: [],
    availabilityNux: null,
    defaultReasoningEffort: "medium",
    defaultServiceTier: "default",
    description: `Synthetisches E2E-Modell ${model}.`,
    displayName: model,
    hidden: false,
    id: model,
    inputModalities: ["text"],
    isDefault: model === "gpt-5.6-sol",
    model,
    modelSpecialty: null,
    multiAgentVersion: null,
    serviceTiers: model === "gpt-5.4-mini"
      ? []
      : [{ description: "1.5x speed", id: "priority", name: "Fast" }],
    supportedReasoningEfforts: ["low", "medium", "high"].map((reasoningEffort) => ({
      description: reasoningEffort,
      reasoningEffort,
    })),
    supportsPersonality: false,
    upgrade: null,
    upgradeInfo: null,
  };
}

function echoedThread(runtimeDirectory: string, params: unknown): Record<string, unknown> {
  const requested = params as {
    config?: { model_reasoning_effort?: string };
    model?: string;
    serviceTier?: string;
  };
  return {
    ...safeThread(runtimeDirectory),
    model: requested.model ?? "gpt-5.6-luna",
    reasoningEffort: requested.config?.model_reasoning_effort ?? "medium",
    serviceTier: requested.serviceTier ?? "default",
  };
}

function safeThread(runtimeDirectory: string): Record<string, unknown> {
  return {
    activePermissionProfile: null,
    approvalPolicy: "never",
    approvalsReviewer: "user",
    cwd: runtimeDirectory,
    instructionSources: [],
    model: "gpt-5.6-luna",
    modelProvider: "openai",
    multiAgentMode: "explicitRequestOnly",
    reasoningEffort: "medium",
    runtimeWorkspaceRoots: [],
    sandbox: { networkAccess: false, type: "readOnly" },
    serviceTier: "default",
    thread: {
      agentNickname: null,
      agentRole: null,
      cliVersion: SCHEMA_CODEX_VERSION,
      createdAt: 1,
      cwd: runtimeDirectory,
      ephemeral: false,
      forkedFromId: null,
      gitInfo: null,
      id: "provider_thread_e2e",
      modelProvider: "openai",
      name: null,
      parentThreadId: null,
      path: `${runtimeDirectory}/provider-thread.jsonl`,
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
