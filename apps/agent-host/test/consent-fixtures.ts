import { createHash } from "node:crypto";

import {
  FINANCE_CONSENT_PROVIDER,
  FINANCE_CONSENT_SCHEMA_VERSION,
} from "../src/consent-journal.js";

export const LEGACY_FINANCE_CONSENT_VERSION = "2026-08-28.v1";
export const LEGACY_FINANCE_CONSENT_NOTICE_HASH =
  "0157249b491057ec118c84158b528996871d34f6616d78cc98e0bd58c4e1d48e";
const LEGACY_FINANCE_CONSENT_DATA_CATEGORIES = [
  "chat_messages",
  "financial_overview",
  "transactions",
  "receivables_and_payment_status",
  "reviewable_change_proposals",
] as const;

export function legacyConsentGrantLine(): string {
  return legacyConsentJournal(["grant"]);
}

export function legacyConsentJournal(
  actions: ReadonlyArray<"grant" | "revoke_pending" | "revoke_complete">,
): string {
  let previousHash: string | null = null;
  return actions.map((action, index) => {
    const core = {
      action,
      categories: [...LEGACY_FINANCE_CONSENT_DATA_CATEGORIES],
      consentVersion: LEGACY_FINANCE_CONSENT_VERSION,
      noticeHash: LEGACY_FINANCE_CONSENT_NOTICE_HASH,
      occurredAt: new Date(Date.UTC(2026, 7, 28, 10, 0, index)).toISOString(),
      previousHash,
      provider: FINANCE_CONSENT_PROVIDER,
      schemaVersion: FINANCE_CONSENT_SCHEMA_VERSION,
      sequence: index + 1,
    };
    const recordHash = hashCore(core);
    previousHash = recordHash;
    return JSON.stringify({ ...core, recordHash });
  }).join("\n") + "\n";
}

export function hashCore(core: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(core)).digest("hex");
}
