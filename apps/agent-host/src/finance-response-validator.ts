import { realpathSync } from "node:fs";

import type { GetAccountResponse } from "../generated/codex/ts/v2/GetAccountResponse.js";
import type { ThreadStartResponse } from "../generated/codex/ts/v2/ThreadStartResponse.js";
import type { ThreadResumeResponse } from "../generated/codex/ts/v2/ThreadResumeResponse.js";
import type { ThreadUnsubscribeResponse } from "../generated/codex/ts/v2/ThreadUnsubscribeResponse.js";
import type { TurnStartResponse } from "../generated/codex/ts/v2/TurnStartResponse.js";
import { isSupportedCodexVersion } from "./codex-provider.js";
import {
  DEFAULT_FINANCE_MODEL_SELECTION,
  FINANCE_SERVICE_TIER_FAST,
  FINANCE_SUPPORTED_EFFORTS,
  FINANCE_SUPPORTED_MODELS,
  financeServiceTier,
  type FinanceEffort,
  type FinanceModelId,
  type FinanceModelSelection,
} from "./finance-thread-contract.js";
import {
  ProtocolValidationError,
  validateGetAccountResponse,
  validateModelListResponse,
  validateThreadStartResponse,
  validateThreadResumeResponse,
  validateTurnStartResponse,
} from "./runtime-validator.js";

export const MAX_FINANCE_MODEL_CATALOG_PAGES = 8;

export interface FinanceCatalogModel {
  efforts: FinanceEffort[];
  model: FinanceModelId;
  supportsFastMode: boolean;
}

export interface FinanceThreadUsage {
  contextWindow: number | null;
  totalTokens: number;
  usedTokens: number;
}

const exactThreadStartResponseKeys = [
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

/**
 * A resumed thread carries three fields a started one does not: the first page
 * of provider-side history and the two cursors for paging further back.
 * Chelaro's own database is the source of truth for the visible conversation
 * (ADR 0013), so the cursors are never followed and the page must stay empty.
 */
const exactThreadResumeResponseKeys = [
  ...exactThreadStartResponseKeys,
  "initialTurnsPage",
  "itemsBackwardsCursor",
  "turnsBackwardsCursor",
].sort();

const MAX_THREAD_CURSOR_LENGTH = 4096;

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
  selection: FinanceModelSelection = DEFAULT_FINANCE_MODEL_SELECTION,
): asserts value is ThreadResumeResponse | ThreadStartResponse {
  if (operation === "resume") validateThreadResumeResponse(value);
  else validateThreadStartResponse(value);
  const response = value as (ThreadResumeResponse | ThreadStartResponse) & Record<string, unknown>;
  const runtimeRoot = realpathSync(runtimeDirectory);
  const expectedKeys = operation === "resume"
    ? exactThreadResumeResponseKeys
    : exactThreadStartResponseKeys;
  if (
    JSON.stringify(Object.keys(response).sort()) !== JSON.stringify(expectedKeys) ||
    response.approvalPolicy !== "never" ||
    response.approvalsReviewer !== "user" ||
    response.modelProvider !== "openai" ||
    // Codex accepts an unknown model, effort, or service tier without an
    // error and silently reports a different or null value, so the requested
    // configuration only counts once the thread echoes it back unchanged.
    response.model !== selection.model ||
    response.reasoningEffort !== selection.effort ||
    response.serviceTier !== financeServiceTier(selection.fastMode) ||
    realpathSync(response.cwd) !== runtimeRoot ||
    response.instructionSources.length !== 0 ||
    // A started thread reports no workspace root at all; a resumed one reports
    // the directory it was started in. Both are exact: nothing outside
    // Chelaro's own runtime directory may ever appear here.
    !(operation === "resume"
      ? isRuntimeOnlyWorkspace(response.runtimeWorkspaceRoots, runtimeRoot)
      : isEmptyArray(response.runtimeWorkspaceRoots)) ||
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
    !isSupportedCodexVersion(response.thread.cliVersion) ||
    response.thread.threadSource !== "appServer" ||
    response.thread.status.type !== "idle" ||
    response.thread.turns.length !== 0 ||
    !validProviderId(response.thread.id)
  ) {
    throw unsafe("Codex returned an unsafe finance thread configuration.");
  }
  if (operation === "resume" && (
    // `excludeTurns` was requested, so a populated page would mean Codex sent
    // conversation content Chelaro neither asked for nor renders.
    response.initialTurnsPage !== null ||
    !isUnusedCursor(response.turnsBackwardsCursor) ||
    !isUnusedCursor(response.itemsBackwardsCursor)
  )) {
    throw unsafe("Codex returned unexpected history with the resumed finance thread.");
  }
}

function isUnusedCursor(value: unknown): boolean {
  return value === null ||
    (typeof value === "string" && value.length > 0 && value.length <= MAX_THREAD_CURSOR_LENGTH);
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

/**
 * Reduces a thread token usage report to the three numbers the assistant
 * shows. Fast Mode is sold as increased usage, so the report has to be
 * trustworthy enough to display: an unexpected shape is rejected rather than
 * turned into a plausible-looking number.
 */
export function assertFinanceThreadUsage(value: unknown): FinanceThreadUsage {
  if (
    !isRecord(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(["last", "modelContextWindow", "total"]) ||
    !isRecord(value.total) ||
    !isRecord(value.last) ||
    !(value.modelContextWindow === null || isTokenCount(value.modelContextWindow))
  ) {
    throw unsafe("Codex reported an unusable finance thread token usage.");
  }
  return {
    contextWindow: value.modelContextWindow as number | null,
    totalTokens: tokenCount(value.total.totalTokens),
    // The most recent turn's input is the conversation Codex actually sent, so
    // that number — not the cumulative total — is what fills the context window.
    usedTokens: tokenCount(value.last.inputTokens),
  };
}

/**
 * Reduces one `model/list` page to the models the finance assistant may use.
 * Anything outside `FINANCE_SUPPORTED_MODELS` is dropped rather than rejected:
 * Codex ships new models independently of Chelaro, and an unreviewed model
 * must stay invisible instead of breaking the picker.
 */
export function assertFinanceModelCatalogPage(value: unknown): {
  models: FinanceCatalogModel[];
  nextCursor: string | null;
} {
  validateModelListResponse(value);
  const page = value as { data: unknown; nextCursor: unknown };
  if (!Array.isArray(page.data) || page.data.length > 64) {
    throw unsafe("Codex returned an unusable finance model catalog.");
  }
  if (page.nextCursor !== null && !isSafeCursor(page.nextCursor)) {
    throw unsafe("Codex returned an unusable finance model catalog cursor.");
  }
  const models: FinanceCatalogModel[] = [];
  for (const entry of page.data) {
    if (!isRecord(entry) || typeof entry.model !== "string") {
      throw unsafe("Codex returned an unusable finance model catalog entry.");
    }
    if (entry.hidden === true) continue;
    if (!FINANCE_SUPPORTED_MODELS.includes(entry.model as FinanceModelId)) continue;
    if (models.some((known) => known.model === entry.model)) continue;
    models.push({
      efforts: supportedEfforts(entry.supportedReasoningEfforts),
      model: entry.model as FinanceModelId,
      supportsFastMode: supportsFastMode(entry.serviceTiers),
    });
  }
  return { models, nextCursor: (page.nextCursor as string | null) ?? null };
}

function supportedEfforts(value: unknown): FinanceEffort[] {
  if (!Array.isArray(value)) {
    throw unsafe("Codex returned an unusable finance model effort list.");
  }
  const offered = new Set(
    value.flatMap((option) =>
      isRecord(option) && typeof option.reasoningEffort === "string" ? [option.reasoningEffort] : [],
    ),
  );
  return FINANCE_SUPPORTED_EFFORTS.filter((effort) => offered.has(effort));
}

function supportsFastMode(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (!Array.isArray(value)) {
    throw unsafe("Codex returned an unusable finance model service tier list.");
  }
  return value.some((tier) => isRecord(tier) && tier.id === FINANCE_SERVICE_TIER_FAST);
}

function tokenCount(value: unknown): number {
  if (!isTokenCount(value)) throw unsafe("Codex reported an unusable finance token count.");
  return value;
}

function isTokenCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSafeCursor(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && /^[A-Za-z0-9._~-]{1,512}$/.test(value);
}

function validProviderId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isEmptyArray(value: unknown): value is [] {
  return Array.isArray(value) && value.length === 0;
}

function isRuntimeOnlyWorkspace(value: unknown, runtimeRoot: string): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((root) => {
    if (typeof root !== "string") return false;
    try {
      return realpathSync(root) === runtimeRoot;
    } catch {
      return false;
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unsafe(message: string): ProtocolValidationError {
  return new ProtocolValidationError(message);
}
