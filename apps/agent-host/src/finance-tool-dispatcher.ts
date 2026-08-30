import { createHash } from "node:crypto";

import type { JsonValue } from "../generated/codex/ts/serde_json/JsonValue.js";
import type { DynamicToolCallParams } from "../generated/codex/ts/v2/DynamicToolCallParams.js";
import type { DynamicToolCallResponse } from "../generated/codex/ts/v2/DynamicToolCallResponse.js";
import {
  FinanceApiClientError,
  type ProposalCorrelation,
} from "./finance-api-client.js";
import {
  FinanceToolContractError,
  type FinanceToolName,
  validateFinanceToolCall,
} from "./finance-tool-contract.js";

export const FINANCE_TURN_READ_LIMIT = 12;
export const FINANCE_TURN_PROPOSAL_LIMIT = 1;
export const FINANCE_TURN_OUTPUT_LIMIT_BYTES = 256 * 1024;
export const FINANCE_SESSION_READ_LIMIT = 60;
export const FINANCE_SESSION_PROPOSAL_LIMIT = 5;
export const FINANCE_SESSION_OUTPUT_LIMIT_BYTES = 1024 * 1024;
export const FINANCE_TURN_CORRECTION_LIMIT = 1;
export const MAX_FINANCE_CALL_LEDGER_ENTRIES =
  FINANCE_SESSION_READ_LIMIT + FINANCE_SESSION_PROPOSAL_LIMIT;

const proposalTools = new Set<FinanceToolName>([
  "finance_propose_receivable_create",
  "finance_propose_receivable_update",
  "finance_propose_payment_record",
  "finance_propose_payment_reversal",
]);

export interface FinanceToolApi {
  call(
    name: FinanceToolName,
    argumentsValue: Record<string, JsonValue>,
    options?: { correlation?: ProposalCorrelation; signal?: AbortSignal },
  ): Promise<JsonValue>;
}

export interface FinanceConsentAuthority {
  assertGranted(consentVersion: string): Promise<void> | void;
}

export interface FinanceToolSessionBinding {
  consentVersion: string;
  hostEpoch: string;
  providerThreadId: string;
  sessionId: string;
}

export interface FinanceToolTurnBinding {
  providerTurnId: string;
}

export interface FinanceToolDispatchResult {
  abortTurn: boolean;
  response: DynamicToolCallResponse;
}

interface Usage {
  outputBytes: number;
  proposals: number;
  reads: number;
}

interface LedgerEntry {
  digest: string;
  result: FinanceToolDispatchResult;
}

export class FinanceToolDispatcher {
  readonly #api: FinanceToolApi;
  readonly #consent: FinanceConsentAuthority;
  #activeCall = false;
  #session: FinanceToolSessionBinding | undefined;
  #turn: (FinanceToolTurnBinding & { abortController: AbortController }) | undefined;
  #sessionUsage: Usage = emptyUsage();
  #turnUsage: Usage = emptyUsage();
  #turnCorrections = 0;
  readonly #ledger = new Map<string, LedgerEntry>();

  constructor(api: FinanceToolApi, consent: FinanceConsentAuthority) {
    this.#api = api;
    this.#consent = consent;
  }

  startSession(binding: FinanceToolSessionBinding): void {
    if (this.#session || this.#activeCall) throw new FinanceToolDispatchError("invalid_state");
    validateBinding(binding);
    this.#session = { ...binding };
    this.#sessionUsage = emptyUsage();
    this.#turnUsage = emptyUsage();
    this.#ledger.clear();
  }

  startTurn(binding: FinanceToolTurnBinding): void {
    if (!this.#session || this.#turn || this.#activeCall) {
      throw new FinanceToolDispatchError("invalid_state");
    }
    validateIdentifier(binding.providerTurnId);
    this.#turn = { ...binding, abortController: new AbortController() };
    this.#turnUsage = emptyUsage();
    this.#turnCorrections = 0;
  }

  interruptTurn(): void {
    this.#turn?.abortController.abort();
  }

  finishTurn(): void {
    if (!this.#turn || this.#activeCall) throw new FinanceToolDispatchError("invalid_state");
    this.#turn.abortController.abort();
    this.#turn = undefined;
    this.#turnUsage = emptyUsage();
    this.#turnCorrections = 0;
  }

  closeSession(): void {
    if (!this.#session || this.#turn || this.#activeCall) {
      throw new FinanceToolDispatchError("invalid_state");
    }
    this.#session = undefined;
    this.#sessionUsage = emptyUsage();
    this.#ledger.clear();
  }

  abandonSession(): void {
    this.#turn?.abortController.abort();
    this.#turn = undefined;
    this.#session = undefined;
    this.#turnUsage = emptyUsage();
    this.#turnCorrections = 0;
    this.#sessionUsage = emptyUsage();
    this.#ledger.clear();
  }

  async dispatch(params: DynamicToolCallParams): Promise<FinanceToolDispatchResult> {
    const session = this.#session;
    const turn = this.#turn;
    if (!session || !turn || params.threadId !== session.providerThreadId || params.turnId !== turn.providerTurnId) {
      return failed("Dieser Werkzeugaufruf gehört nicht zum aktiven Finanzgespräch.", true);
    }
    let callId: string;
    try {
      callId = validateIdentifier(params.callId);
    } catch {
      return failed("Der Werkzeugaufruf enthält eine ungültige Kennung.", true);
    }
    const digest = callDigest(params);
    const prior = this.#ledger.get(callId);
    if (prior) {
      return prior.digest === digest
        ? prior.result
        : failed("Eine widersprüchliche Wiederholung wurde abgelehnt.", true);
    }
    if (this.#ledger.size >= MAX_FINANCE_CALL_LEDGER_ENTRIES || this.#activeCall) {
      return failed("Der Finanzassistent hat zu viele gleichzeitige Aufrufe erhalten.", true);
    }

    let validated: ReturnType<typeof validateFinanceToolCall>;
    try {
      validated = validateFinanceToolCall(params.namespace, params.tool, params.arguments);
    } catch (error) {
      if (error instanceof FinanceToolContractError) {
        const result = error.code === "invalid_arguments"
          ? this.#correctableFailure("invalid_arguments")
          : diagnosticFailure(error.code, "Der Werkzeugaufruf wurde aus Sicherheitsgründen abgelehnt.", [], true);
        return this.#remember(callId, digest, result);
      }
      throw error;
    }

    const isProposal = proposalTools.has(validated.name);
    if (!this.#reserveCall(isProposal)) {
      return this.#remember(callId, digest, failed("Das sichere Nutzungslimit für diesen Turn wurde erreicht.", true));
    }

    this.#activeCall = true;
    let result: FinanceToolDispatchResult;
    try {
      await this.#consent.assertGranted(session.consentVersion);
      const data = await this.#api.call(validated.name, validated.arguments, {
        ...(isProposal
          ? { correlation: correlationFor(session, turn, callId) }
          : {}),
        signal: turn.abortController.signal,
      });
      await this.#consent.assertGranted(session.consentVersion);
      if (this.#session !== session || this.#turn !== turn || turn.abortController.signal.aborted) {
        result = failed("Der Werkzeugaufruf wurde unterbrochen.", true);
      } else {
        result = this.#boundedSuccess(validated.name, data, isProposal);
      }
    } catch (error) {
      if (error instanceof FinanceApiClientError && error.code === "invalid_request") {
        this.#releaseCall(isProposal);
        result = this.#correctableFailure(apiRejectionCode(error.httpStatus));
      } else {
        result = mapFailure(error);
      }
    } finally {
      this.#activeCall = false;
    }
    return this.#remember(callId, digest, result);
  }

  #reserveCall(isProposal: boolean): boolean {
    const key = isProposal ? "proposals" : "reads";
    const turnLimit = isProposal ? FINANCE_TURN_PROPOSAL_LIMIT : FINANCE_TURN_READ_LIMIT;
    const sessionLimit = isProposal ? FINANCE_SESSION_PROPOSAL_LIMIT : FINANCE_SESSION_READ_LIMIT;
    if (this.#turnUsage[key] >= turnLimit || this.#sessionUsage[key] >= sessionLimit) return false;
    this.#turnUsage[key] += 1;
    this.#sessionUsage[key] += 1;
    return true;
  }

  #releaseCall(isProposal: boolean): void {
    const key = isProposal ? "proposals" : "reads";
    this.#turnUsage[key] = Math.max(0, this.#turnUsage[key] - 1);
    this.#sessionUsage[key] = Math.max(0, this.#sessionUsage[key] - 1);
  }

  #correctableFailure(errorCode: string): FinanceToolDispatchResult {
    if (this.#turnCorrections >= FINANCE_TURN_CORRECTION_LIMIT) {
      return diagnosticFailure(
        `${errorCode}_retry_exhausted`,
        "Die einmalige sichere Korrektur ist fehlgeschlagen.",
        [],
        true,
      );
    }
    this.#turnCorrections += 1;
    return diagnosticFailure(
      errorCode,
      "Die Werkzeugargumente sind ungültig.",
      [
        "Korrigiere den Aufruf genau einmal: Geldbeträge als Dezimalstring mit zwei Nachkommastellen, Währung als ISO-4217-Code und alle Pflichtfelder angeben.",
      ],
      false,
    );
  }

  #boundedSuccess(name: FinanceToolName, data: JsonValue, isProposal: boolean): FinanceToolDispatchResult {
    const response = encodeEnvelope({
      status: "ok",
      summary: summaryFor(name),
      next_actions: isProposal ? ["Vorschlag in Chelaro prüfen und freigeben oder ablehnen."] : [],
      artifacts: [{ type: isProposal ? "finance_proposal" : "finance_projection", tool: name, data }],
    }, true);
    const outputBytes = responseBytes(response.response);
    if (
      this.#turnUsage.outputBytes + outputBytes > FINANCE_TURN_OUTPUT_LIMIT_BYTES ||
      this.#sessionUsage.outputBytes + outputBytes > FINANCE_SESSION_OUTPUT_LIMIT_BYTES
    ) {
      return failed("Das sichere Ausgabelimit für diesen Turn wurde erreicht.", true);
    }
    this.#turnUsage.outputBytes += outputBytes;
    this.#sessionUsage.outputBytes += outputBytes;
    return response;
  }

  #remember(callId: string, digest: string, result: FinanceToolDispatchResult): FinanceToolDispatchResult {
    if (this.#ledger.size < MAX_FINANCE_CALL_LEDGER_ENTRIES) {
      this.#ledger.set(callId, { digest, result });
    }
    return result;
  }
}

export class FinanceToolDispatchError extends Error {
  readonly code: "invalid_state" | "invalid_identifier";

  constructor(code: FinanceToolDispatchError["code"]) {
    super("Finance tool dispatcher rejected an invalid operation.");
    this.name = "FinanceToolDispatchError";
    this.code = code;
  }
}

function correlationFor(
  session: FinanceToolSessionBinding,
  turn: FinanceToolTurnBinding,
  callId: string,
): ProposalCorrelation {
  return {
    idempotencyKey: deterministicUuid(`${session.hostEpoch}\0${session.providerThreadId}\0${turn.providerTurnId}\0${callId}`),
    providerCallId: callId,
    providerThreadId: session.providerThreadId,
    providerTurnId: turn.providerTurnId,
  };
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] ?? 0) & 0x0f | 0x50;
  bytes[8] = (bytes[8] ?? 0) & 0x3f | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function callDigest(params: DynamicToolCallParams): string {
  return createHash("sha256").update(JSON.stringify({
    namespace: params.namespace,
    tool: params.tool,
    arguments: params.arguments,
    threadId: params.threadId,
    turnId: params.turnId,
  })).digest("hex");
}

function mapFailure(error: unknown): FinanceToolDispatchResult {
  if (error instanceof FinanceApiClientError) {
    switch (error.code) {
      case "stale":
        return encodeEnvelope({ status: "stale", summary: "Der Finanzstand hat sich geändert. Bitte neu laden.", next_actions: [], artifacts: [] }, false);
      case "rejected":
        return encodeEnvelope({ status: "rejected", summary: "Der Finanzvorschlag wurde sicher abgelehnt.", next_actions: [], artifacts: [] }, false);
      case "invalid_request":
        return diagnosticFailure(apiRejectionCode(error.httpStatus), "Die Werkzeugargumente sind ungültig.", [], true);
      case "unauthorized":
        return diagnosticFailure("api_unauthorized", "Der Finanzassistent ist nicht sicher autorisiert.", [], true);
      case "unavailable":
      case "invalid_response":
      case "response_too_large":
        return encodeEnvelope({ status: "unavailable", summary: "Die Finanzdaten sind momentan nicht sicher verfügbar.", next_actions: [], artifacts: [] }, false);
      case "invalid_configuration":
      case "invalid_state":
        return failed("Der Finanzassistent ist nicht sicher konfiguriert.", true);
    }
  }
  return failed("Der Zugriff wurde wegen fehlender oder widerrufener Einwilligung beendet.", true);
}

function failed(summary: string, abortTurn: boolean): FinanceToolDispatchResult {
  return encodeEnvelope({ status: "rejected", summary, next_actions: [], artifacts: [] }, false, abortTurn);
}

function diagnosticFailure(
  errorCode: string,
  summary: string,
  nextActions: string[],
  abortTurn: boolean,
): FinanceToolDispatchResult {
  return encodeEnvelope({
    status: "rejected",
    error_code: errorCode,
    summary,
    next_actions: nextActions,
    artifacts: [],
  }, false, abortTurn);
}

function apiRejectionCode(httpStatus: number | undefined): string {
  return httpStatus === 400 ? "api_rejected_400" : "api_rejected_422";
}

function encodeEnvelope(envelope: JsonValue, success: boolean, abortTurn = false): FinanceToolDispatchResult {
  return {
    abortTurn,
    response: {
      success,
      contentItems: [{ type: "inputText", text: JSON.stringify(envelope) }],
    },
  };
}

function responseBytes(response: DynamicToolCallResponse): number {
  return Buffer.byteLength(JSON.stringify(response), "utf8");
}

function summaryFor(name: FinanceToolName): string {
  switch (name) {
    case "finance_get_overview": return "Der begrenzte Finanzüberblick wurde geladen.";
    case "finance_list_transactions": return "Die letzten Transaktionen wurden geladen.";
    case "finance_list_receivables": return "Die Forderungsübersicht wurde geladen.";
    case "finance_get_receivable": return "Die Forderungsdetails wurden geladen.";
    case "finance_propose_receivable_create": return "Ein prüfpflichtiger Vorschlag für eine neue Forderung wurde erstellt.";
    case "finance_propose_receivable_update": return "Ein prüfpflichtiger Änderungsvorschlag wurde erstellt.";
    case "finance_propose_payment_record": return "Ein prüfpflichtiger Zahlungsvorschlag wurde erstellt.";
    case "finance_propose_payment_reversal": return "Ein prüfpflichtiger Stornierungsvorschlag wurde erstellt.";
  }
}

function validateBinding(binding: FinanceToolSessionBinding): void {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(binding.consentVersion)) {
    throw new FinanceToolDispatchError("invalid_identifier");
  }
  validateIdentifier(binding.hostEpoch);
  validateIdentifier(binding.providerThreadId);
  validateIdentifier(binding.sessionId);
}

function validateIdentifier(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new FinanceToolDispatchError("invalid_identifier");
  }
  return value;
}

function emptyUsage(): Usage {
  return { outputBytes: 0, proposals: 0, reads: 0 };
}
