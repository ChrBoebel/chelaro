import { realpathSync } from "node:fs";

import type { GetAccountResponse } from "../generated/codex/ts/v2/GetAccountResponse.js";
import type { LoginAccountResponse } from "../generated/codex/ts/v2/LoginAccountResponse.js";
import type { ThreadStartResponse } from "../generated/codex/ts/v2/ThreadStartResponse.js";
import type { TurnStartResponse } from "../generated/codex/ts/v2/TurnStartResponse.js";
import { PINNED_CODEX_VERSION } from "./isolation.js";
import {
  ProtocolValidationError,
  validateGetAccountResponse,
  validateLoginAccountResponse,
  validateThreadStartResponse,
  validateTurnStartResponse,
} from "./runtime-validator.js";

const exactThreadResponseKeys = [
  "activePermissionProfile",
  "approvalPolicy",
  "approvalsReviewer",
  "cwd",
  "instructionSources",
  "model",
  "modelProvider",
  "multiAgentMode",
  "reasoningEffort",
  "runtimeWorkspaceRoots",
  "sandbox",
  "serviceTier",
  "thread",
].sort();

export function assertFinanceAccountResponse(value: unknown): asserts value is GetAccountResponse {
  validateGetAccountResponse(value);
  if (value.account !== null && value.account.type !== "chatgpt") {
    throw unsafe("The finance assistant requires ChatGPT account authentication.");
  }
}

export function assertFinanceLoginResponse(value: unknown): asserts value is LoginAccountResponse & {
  type: "chatgptDeviceCode";
} {
  validateLoginAccountResponse(value);
  if (value.type !== "chatgptDeviceCode") {
    throw unsafe("The finance assistant requires ChatGPT device-code authentication.");
  }
}

export function assertSafeFinanceThreadResponse(
  value: unknown,
  runtimeDirectory: string,
): asserts value is ThreadStartResponse {
  validateThreadStartResponse(value);
  const response = value as ThreadStartResponse & Record<string, unknown>;
  const runtimeRoot = realpathSync(runtimeDirectory);
  if (
    JSON.stringify(Object.keys(response).sort()) !== JSON.stringify(exactThreadResponseKeys) ||
    response.approvalPolicy !== "never" ||
    response.approvalsReviewer !== "user" ||
    response.modelProvider !== "openai" ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(response.model) ||
    realpathSync(response.cwd) !== runtimeRoot ||
    response.instructionSources.length !== 0 ||
    !isEmptyArray(response.runtimeWorkspaceRoots) ||
    response.activePermissionProfile !== null ||
    response.multiAgentMode !== "explicitRequestOnly" ||
    response.sandbox.type !== "readOnly" ||
    response.sandbox.networkAccess !== false ||
    realpathSync(response.thread.cwd) !== runtimeRoot ||
    response.thread.ephemeral !== true ||
    response.thread.path !== null ||
    response.thread.parentThreadId !== null ||
    response.thread.forkedFromId !== null ||
    response.thread.agentNickname !== null ||
    response.thread.agentRole !== null ||
    response.thread.gitInfo !== null ||
    response.thread.modelProvider !== "openai" ||
    response.thread.cliVersion !== PINNED_CODEX_VERSION ||
    response.thread.threadSource !== "appServer" ||
    response.thread.status.type !== "idle" ||
    response.thread.turns.length !== 0 ||
    !validProviderId(response.thread.id)
  ) {
    throw unsafe("Codex returned an unsafe finance thread configuration.");
  }
}

export function assertFinanceTurnStartResponse(value: unknown): asserts value is TurnStartResponse {
  validateTurnStartResponse(value);
  if (
    !isRecord(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["turn"]) ||
    value.turn.status !== "inProgress" ||
    value.turn.error !== null ||
    value.turn.completedAt !== null ||
    value.turn.items.length !== 0 ||
    !validProviderId(value.turn.id)
  ) {
    throw unsafe("Codex returned an unsafe finance turn state.");
  }
}

export function assertEmptyCodexResponse(value: unknown): asserts value is Record<string, never> {
  if (!isRecord(value) || Object.keys(value).length !== 0) {
    throw unsafe("Codex returned an unexpected response.");
  }
}

function validProviderId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isEmptyArray(value: unknown): value is [] {
  return Array.isArray(value) && value.length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unsafe(message: string): ProtocolValidationError {
  return new ProtocolValidationError(message);
}
