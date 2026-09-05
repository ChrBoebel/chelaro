import type { Dispatch, SetStateAction } from "react";

export const MAX_PROMPT_CHARACTERS = 16_000;
export const MAX_ASSISTANT_MESSAGE_BYTES = 512 * 1024;

type HostStatus = "starting" | "ready" | "degraded" | "stopping" | "stopped";
type AppServerStatus =
  "stopped" | "starting" | "ready" | "stopping" | "crashed";
type ConsentStatus = "unknown" | "granted" | "revoke_pending" | "revoked";
type AuthStatus = "unknown" | "logged_out" | "authenticated";
type ProviderStatus =
  "checking" | "ready" | "not_found" | "unsupported" | "error";
type SessionStatus = "starting" | "ready" | "context_lost" | "closed";
type TurnStatus =
  | "starting"
  | "running"
  | "interrupting"
  | "interrupted"
  | "completed"
  | "failed";

export type ModelEffort = "low" | "medium" | "high";

export interface ModelSelection {
  effort: ModelEffort;
  fastMode: boolean;
  model: string;
}

export interface CatalogModel {
  efforts: ModelEffort[];
  model: string;
  supportsFastMode: boolean;
}

export interface ThreadUsage {
  compactions: number;
  contextWindow: number | null;
  totalTokens: number;
  usedTokens: number;
}

export interface FinanceAssistantSnapshot {
  appServer: AppServerStatus;
  auth: AuthStatus;
  consent: { status: ConsentStatus; version: string | null };
  host: HostStatus;
  models: { available: CatalogModel[]; selected: ModelSelection };
  provider: {
    status: ProviderStatus;
    supportedVersions: string[];
    version: string | null;
  };
  session: null | {
    conversationId: string | null;
    id: string;
    status: SessionStatus;
  };
  turn: null | { id: string; status: TurnStatus };
  usage: ThreadUsage | null;
}

export interface ConversationSummary {
  id: string;
  version: number;
  title: string;
  status: "active" | "archived";
  message_count: number;
  updated_at: string;
}

export interface DisplayMessage {
  turnId?: string;
  id: string;
  role: "assistant" | "user";
  status: "streaming" | "complete" | "failed";
  text: string;
}

export interface ActiveStream {
  bytes: number[];
  messageId: string;
  nextSequence: number;
  sessionId: string;
  turnId: string;
}

class AssistantRequestError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("assistant_request_failed");
    this.name = "AssistantRequestError";
    this.code = code;
  }
}

export async function assistantRequest(
  path: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok || !isRecord(body))
    throw new AssistantRequestError(errorCode(body));
  return body;
}

function errorCode(body: unknown): string {
  if (
    isRecord(body) &&
    isRecord(body.error) &&
    typeof body.error.code === "string" &&
    /^[a-z_]{1,64}$/.test(body.error.code)
  )
    return body.error.code;
  return "operation_rejected";
}

/**
 * The host already distinguishes its refusals; the owner deserves the same
 * distinction. Only a genuinely retryable failure may suggest another attempt.
 */
export function describeAssistantError(error: unknown): string {
  const code =
    error instanceof AssistantRequestError ? error.code : "operation_rejected";
  return (
    ASSISTANT_ERROR_MESSAGES[code] ??
    `Die Aktion wurde vom Assistenten abgelehnt (${code}).`
  );
}

const ASSISTANT_ERROR_MESSAGES: Record<string, string> = {
  agent_unavailable:
    "Der lokale Assistentendienst antwortet nicht. Starte Chelaro neu.",
  assistant_unavailable:
    "Der lokale Assistentendienst antwortet nicht. Starte Chelaro neu.",
  authentication_required:
    "Die Codex-Anmeldung fehlt. Führe im Terminal codex login aus und prüfe den Status erneut.",
  consent_required: "Die Datenfreigabe fehlt. Stimme ihr zu, um fortzufahren.",
  consent_version_mismatch:
    "Die Datenfreigabe ist veraltet. Stimme der aktuellen Fassung zu.",
  finance_api_unavailable:
    "Die Finanzdaten stehen dem Assistenten gerade nicht zur Verfügung.",
  identifier_reused:
    "Diese Kennung wurde in dieser Sitzung bereits verwendet. Starte Chelaro neu.",
  invalid_request: "Die Anfrage war ungültig und wurde nicht gesendet.",
  invalid_state:
    "Der Assistent ist in einem Zustand, der diese Aktion nicht erlaubt.",
  model_not_available:
    "Das gewählte Modell bietet Codex gerade nicht an. Wähle ein anderes oder prüfe den Status erneut.",
  protocol_incompatible:
    "Codex hat unerwartete Daten gesendet. Chelaro hat abgebrochen.",
  resource_not_found:
    "Diese Unterhaltung ist nicht mehr aktiv. Beginne sie neu.",
  session_busy: "Es läuft noch eine andere Unterhaltung. Beende sie zuerst.",
  turn_busy:
    "Es läuft noch eine Antwort. Warte, bis sie fertig ist, oder stoppe sie.",
  turn_failed: "Die Antwort konnte nicht gestartet werden. Versuche es erneut.",
  unsafe_codex_configuration:
    "Codex meldet eine Konfiguration, die Chelaro nicht zulässt. Es wurde nichts gesendet.",
};

export async function historyMutation(
  path: string,
  method: "PATCH" | "POST",
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return assistantRequest(path, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
}

export async function loadConversationList(
  status: "active" | "archived" = "active",
): Promise<ConversationSummary[]> {
  const suffix = status === "archived" ? "?status=archived" : "";
  const response = await assistantRequest(
    `/api/assistant/conversations${suffix}`,
    { method: "GET" },
  );
  if (!Array.isArray(response.data)) return [];
  return response.data
    .map(parseConversation)
    .filter((item): item is ConversationSummary => item !== null);
}

export async function loadMessages(
  conversationId: string,
  beforeSequence?: number,
): Promise<{ messages: DisplayMessage[]; nextBeforeSequence: number | null }> {
  const suffix =
    beforeSequence === undefined ? "" : `?before_sequence=${beforeSequence}`;
  const response = await assistantRequest(
    `/api/assistant/conversations/${encodeURIComponent(conversationId)}/messages${suffix}`,
    { method: "GET" },
  );
  if (!Array.isArray(response.data)) throw new Error("invalid_history");
  const messages = response.data
    .map((value): DisplayMessage | null => {
      if (
        !isRecord(value) ||
        typeof value.id !== "string" ||
        !isOneOf(value.role, ["assistant", "user"]) ||
        !isOneOf(value.status, ["complete", "interrupted", "failed"]) ||
        typeof value.text !== "string"
      )
        return null;
      return {
        id: `stored:${value.id}`,
        turnId: typeof value.turn_id === "string" ? value.turn_id : undefined,
        role: value.role,
        status: value.status === "complete" ? "complete" : "failed",
        text: value.text,
      };
    })
    .filter((message): message is DisplayMessage => message !== null);
  const next = response.next_before_sequence;
  if (!(next === null || (Number.isSafeInteger(next) && Number(next) >= 2))) {
    throw new Error("invalid_history_cursor");
  }
  return { messages, nextBeforeSequence: next as number | null };
}

export function parseConversation(value: unknown): ConversationSummary | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !Number.isSafeInteger(value.version) ||
    Number(value.version) < 1 ||
    typeof value.title !== "string" ||
    value.title.length === 0 ||
    !isOneOf(value.status, ["active", "archived"]) ||
    !Number.isSafeInteger(value.message_count) ||
    Number(value.message_count) < 0 ||
    typeof value.updated_at !== "string" ||
    !Number.isFinite(Date.parse(value.updated_at))
  )
    return null;
  return value as unknown as ConversationSummary;
}

export function parseSnapshot(value: unknown): FinanceAssistantSnapshot | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "appServer",
      "auth",
      "consent",
      "host",
      "models",
      "provider",
      "session",
      "turn",
      "usage",
    ])
  )
    return null;
  if (
    !isOneOf(value.host, [
      "starting",
      "ready",
      "degraded",
      "stopping",
      "stopped",
    ]) ||
    !isOneOf(value.appServer, [
      "stopped",
      "starting",
      "ready",
      "stopping",
      "crashed",
    ]) ||
    !isOneOf(value.auth, ["unknown", "logged_out", "authenticated"]) ||
    !isRecord(value.consent) ||
    !exactKeys(value.consent, ["status", "version"]) ||
    !isOneOf(value.consent.status, [
      "unknown",
      "granted",
      "revoke_pending",
      "revoked",
    ]) ||
    !(
      value.consent.version === null ||
      typeof value.consent.version === "string"
    ) ||
    !isRecord(value.provider) ||
    !exactKeys(value.provider, ["status", "supportedVersions", "version"]) ||
    !isOneOf(value.provider.status, [
      "checking",
      "ready",
      "not_found",
      "unsupported",
      "error",
    ]) ||
    !validSupportedVersions(value.provider.supportedVersions) ||
    !(
      value.provider.version === null ||
      typeof value.provider.version === "string"
    ) ||
    !validModels(value.models) ||
    !validSession(value.session) ||
    !validTurn(value.turn) ||
    !validUsage(value.usage)
  )
    return null;
  return value as unknown as FinanceAssistantSnapshot;
}

function validModels(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, ["available", "selected"]))
    return false;
  if (!Array.isArray(value.available) || value.available.length > 32)
    return false;
  return (
    value.available.every(
      (entry) =>
        isRecord(entry) &&
        exactKeys(entry, ["efforts", "model", "supportsFastMode"]) &&
        typeof entry.model === "string" &&
        typeof entry.supportsFastMode === "boolean" &&
        Array.isArray(entry.efforts) &&
        entry.efforts.every((effort) =>
          isOneOf(effort, ["low", "medium", "high"]),
        ),
    ) && validModelSelection(value.selected)
  );
}

function validModelSelection(value: unknown): boolean {
  return (
    isRecord(value) &&
    exactKeys(value, ["effort", "fastMode", "model"]) &&
    typeof value.model === "string" &&
    typeof value.fastMode === "boolean" &&
    isOneOf(value.effort, ["low", "medium", "high"])
  );
}

function validUsage(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      exactKeys(value, [
        "compactions",
        "contextWindow",
        "totalTokens",
        "usedTokens",
      ]) &&
      isTokenCount(value.compactions) &&
      (value.contextWindow === null || isTokenCount(value.contextWindow)) &&
      isTokenCount(value.totalTokens) &&
      isTokenCount(value.usedTokens))
  );
}

function isTokenCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validSession(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      exactKeys(value, ["conversationId", "id", "status"]) &&
      (value.conversationId === null ||
        typeof value.conversationId === "string") &&
      validResourceId(value.id) &&
      isOneOf(value.status, ["starting", "ready", "context_lost", "closed"]))
  );
}

function validTurn(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      exactKeys(value, ["id", "status"]) &&
      validResourceId(value.id) &&
      isOneOf(value.status, [
        "starting",
        "running",
        "interrupting",
        "interrupted",
        "completed",
        "failed",
      ]))
  );
}

export function isStartedEvent(value: Record<string, unknown>): value is Record<
  string,
  unknown
> & {
  messageId: string;
  sessionId: string;
  turnId: string;
  type: "assistant.message.started";
} {
  return (
    exactKeys(value, ["messageId", "sessionId", "turnId", "type"]) &&
    validResourceId(value.messageId) &&
    validResourceId(value.sessionId) &&
    validResourceId(value.turnId)
  );
}

export function isChunkEvent(value: Record<string, unknown>): value is Record<
  string,
  unknown
> & {
  dataBase64: string;
  messageId: string;
  rawBytes: number;
  sequence: number;
  sessionId: string;
  turnId: string;
  type: "assistant.message.chunk";
} {
  return (
    exactKeys(value, [
      "dataBase64",
      "messageId",
      "rawBytes",
      "sequence",
      "sessionId",
      "turnId",
      "type",
    ]) &&
    typeof value.dataBase64 === "string" &&
    value.dataBase64.length <= 48 * 1024 &&
    validResourceId(value.messageId) &&
    validResourceId(value.sessionId) &&
    validResourceId(value.turnId) &&
    Number.isSafeInteger(value.rawBytes) &&
    Number(value.rawBytes) >= 1 &&
    Number(value.rawBytes) <= 32 * 1024 &&
    Number.isSafeInteger(value.sequence) &&
    Number(value.sequence) >= 0
  );
}

export function isCompletedEvent(
  value: Record<string, unknown>,
): value is Record<string, unknown> & {
  messageId: string;
  sessionId: string;
  sha256: string;
  totalBytes: number;
  turnId: string;
  type: "assistant.message.completed";
} {
  return (
    exactKeys(value, [
      "messageId",
      "sessionId",
      "sha256",
      "totalBytes",
      "turnId",
      "type",
    ]) &&
    validResourceId(value.messageId) &&
    validResourceId(value.sessionId) &&
    validResourceId(value.turnId) &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    Number.isSafeInteger(value.totalBytes) &&
    Number(value.totalBytes) >= 0 &&
    Number(value.totalBytes) <= MAX_ASSISTANT_MESSAGE_BYTES
  );
}

export function isTurnActive(turn: FinanceAssistantSnapshot["turn"]): boolean {
  return Boolean(
    turn && ["starting", "running", "interrupting"].includes(turn.status),
  );
}

export function resourceId(prefix: "session" | "turn"): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function validResourceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function streamKey(turnId: string, messageId: string): string {
  return `${turnId}:${messageId}`;
}

export function decodeBase64(value: string): Uint8Array | null {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    return null;
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function verifyDigest(
  bytes: Uint8Array,
  expected: string,
): Promise<boolean> {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", copy.buffer),
    );
    return (
      [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("") ===
      expected
    );
  } catch {
    return false;
  }
}

export function failMessage(
  key: string,
  setMessages: Dispatch<SetStateAction<DisplayMessage[]>>,
) {
  setMessages((current) =>
    current.map((message) =>
      message.id === key ? { ...message, status: "failed", text: "" } : message,
    ),
  );
}

function validSupportedVersions(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 8 &&
    value.every(
      (entry) => typeof entry === "string" && /^\d+\.\d+\.\d+$/.test(entry),
    )
  );
}

export function describeSupportedVersions(versions: readonly string[]): string {
  if (versions.length === 0) return "eine geprüfte Codex-Version";
  if (versions.length === 1) return `die geprüfte Codex CLI ${versions[0]}`;
  return `eine geprüfte Codex CLI (${versions.join(", ")})`;
}

export function exactKeys(
  value: Record<string, unknown>,
  keys: string[],
): boolean {
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort())
  );
}

function isOneOf<T extends string>(
  value: unknown,
  values: readonly T[],
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
