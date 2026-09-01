import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
  type Stats,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";

import type { FinanceConsentAuthority } from "./finance-tool-dispatcher.js";

export const FINANCE_CONSENT_PROVIDER = "openai";
export const FINANCE_CONSENT_SCHEMA_VERSION = 1;
export const FINANCE_CONSENT_VERSION = "2026-08-31.v2";
export const FINANCE_CONSENT_NOTICE = [
  "Der Chelaro Finanzassistent sendet deine Chatnachrichten und nur die zur Beantwortung nötigen,",
  "strukturierten Finanzdaten an OpenAI. Dazu können Übersichten, Transaktionen, Forderungen,",
  "Zahlungsstatus und prüfpflichtige Änderungsvorschläge gehören. Originaldokumente, OCR-Inhalte,",
  "Bankzugänge und Ausführungsrechte werden nicht übertragen. Vorschläge ändern Finanzdaten erst",
  "nach deiner gesonderten Prüfung und Freigabe in Chelaro.",
  "Vollständige sichtbare Unterhaltungen werden lokal auf diesem Mac gespeichert, bis du sie",
  "löschst. Chelaro legt außerdem einen fortsetzbaren Verlauf in deiner vorhandenen lokalen",
  "Codex-Installation an. Ein Widerruf stoppt neue Übertragungen, löscht aber nicht automatisch",
  "deine bereits lokal gespeicherten Unterhaltungen.",
].join(" ");
export const FINANCE_CONSENT_NOTICE_HASH = sha256(FINANCE_CONSENT_NOTICE);
export const FINANCE_CONSENT_DATA_CATEGORIES = Object.freeze([
  "chat_messages",
  "financial_overview",
  "transactions",
  "receivables_and_payment_status",
  "reviewable_change_proposals",
] as const);

const LEGACY_FINANCE_CONSENT_DATA_CATEGORIES = Object.freeze([
  "chat_messages",
  "financial_overview",
  "transactions",
  "receivables_and_payment_status",
  "reviewable_change_proposals",
] as const);

const LEGACY_FINANCE_CONSENT_CONTRACTS = Object.freeze({
  "2026-08-28.v1": Object.freeze({
    categories: LEGACY_FINANCE_CONSENT_DATA_CATEGORIES,
    noticeHash: "0157249b491057ec118c84158b528996871d34f6616d78cc98e0bd58c4e1d48e",
  }),
});

export const MAX_CONSENT_JOURNAL_BYTES = 256 * 1024;
export const MAX_CONSENT_JOURNAL_RECORDS = 1024;
const MAX_CONSENT_RECORD_BYTES = 4096;

type ConsentAction = "grant" | "revoke_pending" | "revoke_complete";
type ConsentState = "unknown" | "granted" | "revoke_pending" | "revoked";

interface ConsentRecordCore {
  action: ConsentAction;
  categories: string[];
  consentVersion: string;
  noticeHash: string;
  occurredAt: string;
  previousHash: string | null;
  provider: typeof FINANCE_CONSENT_PROVIDER;
  schemaVersion: typeof FINANCE_CONSENT_SCHEMA_VERSION;
  sequence: number;
}

interface ConsentRecord extends ConsentRecordCore {
  recordHash: string;
}

export interface FinanceConsentSnapshot {
  denialReason:
    | "invalid_journal"
    | "invalid_permissions"
    | "missing"
    | "not_granted"
    | "unreadable"
    | "unsupported_version"
    | null;
  sequence: number;
  status: ConsentState;
  version: string | null;
}

export interface FinanceConsentJournalOptions {
  journalPath: string;
  now?: () => Date;
}

export class FinanceConsentJournal implements FinanceConsentAuthority {
  readonly #journalPath: string;
  readonly #now: () => Date;

  constructor(options: FinanceConsentJournalOptions) {
    if (!isAbsolute(options.journalPath)) {
      throw new FinanceConsentJournalError("invalid_configuration");
    }
    this.#journalPath = options.journalPath;
    this.#now = options.now ?? (() => new Date());
  }

  load(): FinanceConsentSnapshot {
    try {
      const records = this.#readRecords();
      if (records === null || records.length === 0) {
        return {
          denialReason: "missing",
          sequence: 0,
          status: "unknown",
          version: null,
        };
      }
      return snapshotFor(records.at(-1)!);
    } catch (error) {
      if (error instanceof JournalValidationError) {
        return {
          denialReason: error.reason,
          sequence: 0,
          status: "revoked",
          version: null,
        };
      }
      return {
        denialReason: "unreadable",
        sequence: 0,
        status: "revoked",
        version: null,
      };
    }
  }

  assertGranted(consentVersion: string): void {
    const snapshot = this.load();
    if (
      consentVersion !== FINANCE_CONSENT_VERSION ||
      snapshot.status !== "granted" ||
      snapshot.version !== consentVersion
    ) {
      throw new FinanceConsentJournalError("consent_denied");
    }
  }

  grant(): FinanceConsentSnapshot {
    let records = this.#readRecords() ?? [];
    let latest = records.at(-1);
    if (latest?.action === "revoke_pending" && isLegacyConsent(latest)) {
      const completed = this.#append(records, "revoke_complete", latest.consentVersion);
      records = [...records, completed];
      latest = completed;
    }
    if (latest && latest.action !== "revoke_complete" && !canUpgradeConsent(latest)) {
      throw new FinanceConsentJournalError("invalid_state");
    }
    return snapshotFor(this.#append(records, "grant"));
  }

  beginRevocation(): FinanceConsentSnapshot {
    const records = this.#readRecords() ?? [];
    const latest = records.at(-1);
    if (latest?.action === "revoke_pending") return snapshotFor(latest);
    if (latest?.action !== "grant") {
      throw new FinanceConsentJournalError("invalid_state");
    }
    return snapshotFor(this.#append(records, "revoke_pending"));
  }

  completeRevocation(): FinanceConsentSnapshot {
    const records = this.#readRecords() ?? [];
    const latest = records.at(-1);
    if (latest?.action === "revoke_complete") return snapshotFor(latest);
    if (latest?.action !== "revoke_pending") {
      throw new FinanceConsentJournalError("invalid_state");
    }
    return snapshotFor(this.#append(records, "revoke_complete"));
  }

  #append(
    records: ConsentRecord[],
    action: ConsentAction,
    consentVersion = FINANCE_CONSENT_VERSION,
  ): ConsentRecord {
    ensureSecureDirectory(dirname(this.#journalPath));
    const flags = constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | noFollowFlag();
    let descriptor: number | undefined;
    try {
      descriptor = openSync(this.#journalPath, flags, 0o600);
      const stats = fstatSync(descriptor);
      assertSecureJournalFile(stats);
      const current = parseJournal(readBounded(descriptor, stats));
      if (!sameRecordChain(records, current)) {
        throw new JournalValidationError("invalid_journal");
      }
      const contract = consentContract(consentVersion);
      if (!contract) throw new JournalValidationError("unsupported_version");
      const previous = current.at(-1);
      const core: ConsentRecordCore = {
        action,
        categories: [...contract.categories],
        consentVersion,
        noticeHash: contract.noticeHash,
        occurredAt: this.#now().toISOString(),
        previousHash: previous?.recordHash ?? null,
        provider: FINANCE_CONSENT_PROVIDER,
        schemaVersion: FINANCE_CONSENT_SCHEMA_VERSION,
        sequence: (previous?.sequence ?? 0) + 1,
      };
      const record: ConsentRecord = { ...core, recordHash: hashRecordCore(core) };
      validateRecord(record, previous);
      const encoded = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
      if (encoded.byteLength > MAX_CONSENT_RECORD_BYTES) {
        throw new FinanceConsentJournalError("invalid_state");
      }
      if (stats.size + encoded.byteLength > MAX_CONSENT_JOURNAL_BYTES) {
        throw new FinanceConsentJournalError("invalid_state");
      }
      const written = writeSync(descriptor, encoded, 0, encoded.byteLength, null);
      if (written !== encoded.byteLength) throw new FinanceConsentJournalError("write_failed");
      fsyncSync(descriptor);
      fsyncDirectory(dirname(this.#journalPath));
      return record;
    } catch (error) {
      if (error instanceof FinanceConsentJournalError || error instanceof JournalValidationError) throw error;
      throw new FinanceConsentJournalError("write_failed", { cause: error });
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  #readRecords(): ConsentRecord[] | null {
    try {
      const entry = lstatSync(this.#journalPath);
      if (entry.isSymbolicLink()) throw new JournalValidationError("invalid_permissions");
    } catch (error) {
      if (isMissing(error)) return null;
      if (error instanceof JournalValidationError) throw error;
      throw new JournalValidationError("unreadable");
    }
    assertSecureDirectory(dirname(this.#journalPath));
    let descriptor: number | undefined;
    try {
      descriptor = openSync(this.#journalPath, constants.O_RDONLY | noFollowFlag());
      const stats = fstatSync(descriptor);
      assertSecureJournalFile(stats);
      return parseJournal(readBounded(descriptor, stats));
    } catch (error) {
      if (error instanceof JournalValidationError) throw error;
      throw new JournalValidationError(
        isPermissionFailure(error) ? "invalid_permissions" : "unreadable",
      );
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
}

export class FinanceConsentJournalError extends Error {
  readonly code: "consent_denied" | "invalid_configuration" | "invalid_state" | "write_failed";

  constructor(code: FinanceConsentJournalError["code"], options?: ErrorOptions) {
    super("Finance consent journal operation was denied.", options);
    this.name = "FinanceConsentJournalError";
    this.code = code;
  }
}

class JournalValidationError extends Error {
  readonly reason: Exclude<FinanceConsentSnapshot["denialReason"], "missing" | "not_granted" | null>;

  constructor(reason: JournalValidationError["reason"]) {
    super("Finance consent journal validation failed.");
    this.name = "JournalValidationError";
    this.reason = reason;
  }
}

function parseJournal(contents: string): ConsentRecord[] {
  if (Buffer.byteLength(contents, "utf8") > MAX_CONSENT_JOURNAL_BYTES) {
    throw new JournalValidationError("invalid_journal");
  }
  if (contents === "") return [];
  if (!contents.endsWith("\n")) throw new JournalValidationError("invalid_journal");
  const lines = contents.slice(0, -1).split("\n");
  if (lines.length > MAX_CONSENT_JOURNAL_RECORDS || lines.some((line) => line === "")) {
    throw new JournalValidationError("invalid_journal");
  }
  const records: ConsentRecord[] = [];
  for (const line of lines) {
    if (Buffer.byteLength(line, "utf8") + 1 > MAX_CONSENT_RECORD_BYTES) {
      throw new JournalValidationError("invalid_journal");
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new JournalValidationError("invalid_journal");
    }
    if (!isConsentRecord(value)) throw new JournalValidationError("invalid_journal");
    const previous = records.at(-1);
    validateRecord(value, previous);
    records.push(value);
  }
  return records;
}

function validateRecord(record: ConsentRecord, previous: ConsentRecord | undefined): void {
  if (record.schemaVersion !== FINANCE_CONSENT_SCHEMA_VERSION) {
    throw new JournalValidationError("unsupported_version");
  }
  const contract = consentContract(record.consentVersion);
  if (!contract) {
    throw new JournalValidationError("unsupported_version");
  }
  if (
    record.provider !== FINANCE_CONSENT_PROVIDER ||
    record.noticeHash !== contract.noticeHash ||
    !equalStrings(record.categories, contract.categories) ||
    record.sequence !== (previous?.sequence ?? 0) + 1 ||
    record.previousHash !== (previous?.recordHash ?? null) ||
    record.recordHash !== hashRecordCore(record) ||
    !isCanonicalTimestamp(record.occurredAt)
  ) {
    throw new JournalValidationError("invalid_journal");
  }
  const isUpgrade = previous !== undefined &&
    canUpgradeConsent(previous) &&
    record.consentVersion === FINANCE_CONSENT_VERSION &&
    record.action === "grant";
  if (previous && previous.consentVersion !== record.consentVersion && !isUpgrade) {
    throw new JournalValidationError("invalid_journal");
  }
  const expectedAction: ConsentAction[] = previous
    ? isUpgrade
      ? ["grant"]
      : previous.action === "grant"
      ? ["revoke_pending"]
      : previous.action === "revoke_pending"
        ? ["revoke_complete"]
        : ["grant"]
    : ["grant"];
  if (!expectedAction.includes(record.action)) throw new JournalValidationError("invalid_journal");
}

function isConsentRecord(value: unknown): value is ConsentRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!equalStrings(Object.keys(record).sort(), [
    "action",
    "categories",
    "consentVersion",
    "noticeHash",
    "occurredAt",
    "previousHash",
    "provider",
    "recordHash",
    "schemaVersion",
    "sequence",
  ])) return false;
  return (
    ["grant", "revoke_pending", "revoke_complete"].includes(String(record.action)) &&
    Array.isArray(record.categories) && record.categories.every((item) => typeof item === "string") &&
    typeof record.consentVersion === "string" &&
    typeof record.noticeHash === "string" &&
    typeof record.occurredAt === "string" &&
    (record.previousHash === null || typeof record.previousHash === "string") &&
    record.provider === FINANCE_CONSENT_PROVIDER &&
    typeof record.recordHash === "string" &&
    Number.isSafeInteger(record.schemaVersion) &&
    Number.isSafeInteger(record.sequence)
  );
}

function hashRecordCore(record: ConsentRecordCore): string {
  return sha256(JSON.stringify({
    action: record.action,
    categories: record.categories,
    consentVersion: record.consentVersion,
    noticeHash: record.noticeHash,
    occurredAt: record.occurredAt,
    previousHash: record.previousHash,
    provider: record.provider,
    schemaVersion: record.schemaVersion,
    sequence: record.sequence,
  }));
}

function snapshotFor(record: ConsentRecord): FinanceConsentSnapshot {
  if (record.consentVersion !== FINANCE_CONSENT_VERSION) {
    return {
      denialReason: "unsupported_version",
      sequence: record.sequence,
      status: "revoked",
      version: record.consentVersion,
    };
  }
  return {
    denialReason: record.action === "grant" ? null : "not_granted",
    sequence: record.sequence,
    status: record.action === "grant"
      ? "granted"
      : record.action === "revoke_pending"
        ? "revoke_pending"
        : "revoked",
    version: record.consentVersion,
  };
}

function canUpgradeConsent(record: ConsentRecord): boolean {
  return (
    isLegacyConsent(record) &&
    ["grant", "revoke_complete"].includes(record.action)
  );
}

function isLegacyConsent(record: ConsentRecord): boolean {
  return Object.hasOwn(LEGACY_FINANCE_CONSENT_CONTRACTS, record.consentVersion);
}

function consentContract(consentVersion: string): {
  categories: readonly string[];
  noticeHash: string;
} | undefined {
  if (consentVersion === FINANCE_CONSENT_VERSION) {
    return {
      categories: FINANCE_CONSENT_DATA_CATEGORIES,
      noticeHash: FINANCE_CONSENT_NOTICE_HASH,
    };
  }
  return LEGACY_FINANCE_CONSENT_CONTRACTS[
    consentVersion as keyof typeof LEGACY_FINANCE_CONSENT_CONTRACTS
  ];
}

function readBounded(descriptor: number, stats: Stats): string {
  if (!stats.isFile() || stats.size > MAX_CONSENT_JOURNAL_BYTES) {
    throw new JournalValidationError("invalid_journal");
  }
  return readFileSync(descriptor, "utf8");
}

function ensureSecureDirectory(path: string): void {
  let created = false;
  try {
    lstatSync(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
    mkdirSync(path, { mode: 0o700, recursive: true });
    created = true;
  }
  if (created) chmodSync(path, 0o700);
  assertSecureDirectory(path);
}

function assertSecureDirectory(path: string): void {
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink() || !isOwnerOnly(stats)) {
    throw new JournalValidationError("invalid_permissions");
  }
}

function assertSecureJournalFile(stats: Stats): void {
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || !isOwnerOnly(stats)) {
    throw new JournalValidationError("invalid_permissions");
  }
}

function isOwnerOnly(stats: Stats): boolean {
  const currentUid = typeof process.getuid === "function" ? process.getuid() : stats.uid;
  return stats.uid === currentUid && (stats.mode & 0o077) === 0;
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function sameRecordChain(left: ConsentRecord[], right: ConsentRecord[]): boolean {
  return left.length === right.length && left.every((record, index) => record.recordHash === right[index]?.recordHash);
}

function isCanonicalTimestamp(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function noFollowFlag(): number {
  return constants.O_NOFOLLOW ?? 0;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isPermissionFailure(error: unknown): boolean {
  return error instanceof JournalValidationError && error.reason === "invalid_permissions";
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
