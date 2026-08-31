import { realpathSync } from "node:fs";

import type { GetAccountResponse } from "../generated/codex/ts/v2/GetAccountResponse.js";
import type { ThreadStartResponse } from "../generated/codex/ts/v2/ThreadStartResponse.js";
import type { ThreadResumeResponse } from "../generated/codex/ts/v2/ThreadResumeResponse.js";
import type { ThreadUnsubscribeResponse } from "../generated/codex/ts/v2/ThreadUnsubscribeResponse.js";
import type { TurnStartResponse } from "../generated/codex/ts/v2/TurnStartResponse.js";
import { SUPPORTED_CODEX_VERSION } from "./codex-provider.js";
import {
  ProtocolValidationError,
  validateGetAccountResponse,
  validateThreadStartResponse,
  validateThreadResumeResponse,
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

export function assertSafeFinanceThreadResponse(
  value: unknown,
  runtimeDirectory: string,
  operation: "resume" | "start" = "start",
): asserts value is ThreadResumeResponse | ThreadStartResponse {
  if (operation === "resume") validateThreadResumeResponse(value);
  else validateThreadStartResponse(value);
  const response = value as (ThreadResumeResponse | ThreadStartResponse) & Record<string, unknown>;
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
    response.thread.ephemeral !== false ||
    typeof response.thread.path !== "string" ||
    !response.thread.path.startsWith("/") ||
    response.thread.parentThreadId !== null ||
    response.thread.forkedFromId !== null ||
    response.thread.agentNickname !== null ||
    response.thread.agentRole !== null ||
    response.thread.gitInfo !== null ||
    response.thread.modelProvider !== "openai" ||
    response.thread.cliVersion !== SUPPORTED_CODEX_VERSION ||
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

export function assertFinanceThreadUnsubscribeResponse(
  value: unknown,
): asserts value is ThreadUnsubscribeResponse & { status: "unsubscribed" } {
  if (
    !isRecord(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["status"]) ||
    value.status !== "unsubscribed"
  ) throw unsafe("Codex did not unsubscribe the finance thread.");
}

export function assertFinanceThreadDeleteResponse(value: unknown): void {
  if (!isRecord(value) || Object.keys(value).length !== 0) {
    throw unsafe("Codex did not delete the finance thread.");
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
