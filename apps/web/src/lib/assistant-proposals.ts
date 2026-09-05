import type { FinanceChangeProposal } from "@/lib/personal-finance";
import { isRecord } from "@/lib/finance-assistant-client";

export interface AssistantProposal {
  proposal: FinanceChangeProposal;
  turn_id: string | null;
  currency: string;
  payment: { amount: string; booked_on: string; purpose: string } | null;
}

export function parseAssistantProposal(value: unknown): AssistantProposal {
  if (!isRecord(value) || !isRecord(value.proposal)) throw new Error("invalid_proposal");
  const p = value.proposal;
  if (
    typeof p.id !== "string" || !/^[0-9a-f-]{36}$/i.test(p.id) ||
    !["receivable_create", "receivable_update", "payment_record", "payment_reverse"].includes(String(p.action)) ||
    !["pending", "approved", "rejected"].includes(String(p.status)) ||
    typeof p.debtor_name !== "string" || typeof p.rationale !== "string" ||
    !isRecord(p.payload) ||
    !(p.expected_version === null || (Number.isSafeInteger(p.expected_version) && Number(p.expected_version) > 0)) ||
    !(p.current_version === null || (Number.isSafeInteger(p.current_version) && Number(p.current_version) > 0)) ||
    !(value.turn_id === null || typeof value.turn_id === "string") ||
    typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency) ||
    !(value.payment === null || (isRecord(value.payment) &&
      typeof value.payment.amount === "string" && /^\d+\.\d{2}$/.test(value.payment.amount) &&
      typeof value.payment.booked_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.payment.booked_on) &&
      typeof value.payment.purpose === "string"))
  ) throw new Error("invalid_proposal");
  return value as unknown as AssistantProposal;
}

export const PROPOSAL_ACTION_LABELS: Record<FinanceChangeProposal["action"], string> = {
  receivable_create: "Offenen Betrag anlegen",
  receivable_update: "Offenen Betrag ändern",
  payment_record: "Zahlung eintragen",
  payment_reverse: "Zahlung korrigieren",
};

const FIELD_LABELS: Record<string, string> = {
  debtor_name: "Name", original_amount: "Gesamtbetrag", amount: "Zahlung",
  description: "Zweck", due_date: "Fällig am", paid_on: "Bezahlt am",
  booked_on: "Gebucht am", payment_method: "Zahlungsart", note: "Notiz",
  purpose: "Verwendungszweck", reason: "Begründung", payment_id: "Zahlung",
};

export function proposalFields({ proposal, currency, payment }: AssistantProposal): [string, string][] {
  const fields = payment ? { ...proposal.payload, ...payment } : proposal.payload;
  return Object.entries(fields).filter(([key]) => key !== "currency" && key !== "payment_id").map(([key, value]) => [
    FIELD_LABELS[key] ?? key,
    value === null ? "Nicht festgelegt" : key === "amount" || key === "original_amount"
      ? formatProposalMoney(String(value), currency)
      : String(value),
  ]);
}

// Keep decimal strings exact, including amounts beyond Number's safe precision.
export function formatProposalMoney(amount: string, currency: string): string {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!match) return `${amount} ${currency}`;
  return `${match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${(match[2] ?? "").padEnd(2, "0")} ${currency}`;
}

export function isStaleProposal(p: FinanceChangeProposal): boolean {
  return p.action !== "receivable_create" && (
    p.expected_version === null || p.current_version === null || p.expected_version !== p.current_version
  );
}
