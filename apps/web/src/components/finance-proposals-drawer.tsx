"use client";

import { useEffect, useState } from "react";

import type { ApiErrorResponse } from "@/lib/documents";
import type {
  FinanceChangeProposal,
  FinanceChangeProposalListResponse,
} from "@/lib/personal-finance";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

const ACTION_LABELS: Record<FinanceChangeProposal["action"], string> = {
  receivable_create: "Offenen Betrag anlegen",
  receivable_update: "Details ändern",
  payment_record: "Zahlung eintragen",
  payment_reverse: "Zahlung korrigieren",
};

export function FinanceProposalsDrawer({
  onClose,
  onChanged,
  onOpenReceivable,
}: {
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
  onOpenReceivable: (id: string) => void;
}) {
  const [proposals, setProposals] = useState<FinanceChangeProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogFocus<HTMLElement>(onClose);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/finance/change-proposals?pending_only=true", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseMessage(response));
        return ((await response.json()) as FinanceChangeProposalListResponse).data;
      })
      .then((data) => {
        setProposals(data);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(errorMessage(loadError, "Die KI-Vorschläge konnten nicht geladen werden."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function decide(proposal: FinanceChangeProposal, decision: "approve" | "reject") {
    setDecidingId(proposal.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/finance/change-proposals/${proposal.id}/${decision}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      setProposals((current) => current.filter((item) => item.id !== proposal.id));
      await onChanged(
        decision === "approve"
          ? "KI-Vorschlag wurde geprüft und übernommen."
          : "KI-Vorschlag wurde abgelehnt.",
      );
    } catch (decisionError) {
      setError(errorMessage(decisionError, "Der Vorschlag konnte nicht entschieden werden."));
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-ink/30 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="finance-proposals-title"
        tabIndex={-1}
        className="h-full w-full overflow-y-auto border-l border-line bg-paper shadow-overlay outline-none sm:max-w-xl"
      >
        <header className="sticky top-0 z-10 flex min-h-20 items-center justify-between gap-4 border-b border-line bg-paper/95 px-5 backdrop-blur sm:px-7">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-review">Kontrollschritt</p>
            <h2 id="finance-proposals-title" className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink">KI-Vorschläge</h2>
          </div>
          <Button variant="quiet" className="grid size-11 shrink-0 place-items-center px-0 text-xl" aria-label="KI-Vorschläge schließen" onClick={onClose}>×</Button>
        </header>

        <div className="p-5 sm:p-7">
          <div className="rounded-panel border border-review/20 bg-review/6 p-4">
            <p className="text-sm font-semibold text-ink">Du behältst die Kontrolle</p>
            <p className="mt-1 text-xs leading-5 text-muted">Die KI kann Finanzdaten lesen und konkrete Änderungen vorschlagen. Erst deine Freigabe erzeugt eine Buchung oder ändert einen offenen Betrag.</p>
          </div>

          <p className="mt-4 min-h-5 text-sm text-danger" role={error ? "alert" : undefined} aria-live="polite">{error}</p>

          {loading ? (
            <div className="mt-4 space-y-3" aria-busy="true" aria-label="Vorschläge werden geladen">
              <div className="h-40 animate-pulse rounded-2xl bg-surface" />
              <div className="h-40 animate-pulse rounded-2xl bg-surface" />
            </div>
          ) : proposals.length === 0 ? (
            <div className="py-14 text-center">
              <span aria-hidden="true" className="mx-auto grid size-11 place-items-center rounded-full bg-confirmed/8 text-confirmed">✓</span>
              <p className="mt-4 text-sm font-semibold text-ink">Alles geprüft</p>
              <p className="mt-1 text-xs text-muted">Aktuell wartet kein KI-Vorschlag auf dich.</p>
            </div>
          ) : (
            <ol className="mt-4 space-y-4">
              {proposals.map((proposal) => {
                const stale = proposal.action !== "receivable_create" && (
                  proposal.expected_version === null ||
                  proposal.current_version === null ||
                  proposal.expected_version !== proposal.current_version
                );
                return (
                  <li key={proposal.id} className="rounded-panel border border-line p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">{ACTION_LABELS[proposal.action]}</p>
                        <h3 className="mt-1 truncate text-base font-semibold text-ink">{proposal.debtor_name}</h3>
                      </div>
                      <StatusBadge tone="review" className="shrink-0 font-mono text-[10px]">Prüfen</StatusBadge>
                    </div>
                    <p className="mt-4 text-sm leading-6 text-ink">{proposalSummary(proposal)}</p>
                    <div className="mt-4 rounded-xl bg-surface p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Begründung</p>
                      <p className="mt-1 text-xs leading-5 text-muted">{proposal.rationale}</p>
                    </div>
                    {stale ? (
                      <p className="mt-3 rounded-xl bg-danger/6 p-3 text-xs leading-5 text-danger">Dieser Vorschlag basiert auf einer älteren Version. Öffne den Betrag und lass die KI anschließend einen neuen Vorschlag erstellen.</p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button variant="danger" className="flex-1" disabled={decidingId === proposal.id} onClick={() => void decide(proposal, "reject")}>Ablehnen</Button>
                      <Button className="flex-[1.4]" disabled={stale || decidingId === proposal.id} onClick={() => void decide(proposal, "approve")}>{decidingId === proposal.id ? "Prüft …" : "Übernehmen"}</Button>
                    </div>
                    {proposal.receivable_id ? (
                      <Button variant="quiet" className="mt-2 w-full" onClick={() => onOpenReceivable(proposal.receivable_id!)}>Offenen Betrag ansehen</Button>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}

function proposalSummary(proposal: FinanceChangeProposal): string {
  if (proposal.action === "receivable_create") {
    const amount = typeof proposal.payload.original_amount === "string"
      ? proposal.payload.original_amount
      : "0.00";
    const currency = typeof proposal.payload.currency === "string"
      ? proposal.payload.currency
      : "EUR";
    const description = typeof proposal.payload.description === "string"
      ? proposal.payload.description
      : "ohne Zweck";
    const dueDate = typeof proposal.payload.due_date === "string"
      ? `, fällig am ${formatDate(proposal.payload.due_date)}`
      : "";
    return `${formatMoney(amount, currency)} als neuen offenen Betrag für „${description}“ anlegen${dueDate}.`;
  }
  if (proposal.action === "payment_record") {
    const amount = typeof proposal.payload.amount === "string" || typeof proposal.payload.amount === "number"
      ? String(proposal.payload.amount)
      : "0";
    const purpose = typeof proposal.payload.purpose === "string" ? proposal.payload.purpose : "Zahlung";
    return `${formatMoney(amount)} als Zahlung für „${purpose}“ eintragen.`;
  }
  if (proposal.action === "payment_reverse") {
    const reason = typeof proposal.payload.reason === "string" ? proposal.payload.reason : "keine Begründung";
    return `Eine Zahlung sichtbar korrigieren: ${reason}`;
  }
  const fields: Record<string, string> = {
    debtor_name: "Name",
    original_amount: "Gesamtbetrag",
    due_date: "Fälligkeit",
    description: "Zweck",
  };
  const changed = Object.keys(proposal.payload).map((key) => fields[key] ?? key);
  return `${changed.join(", ")} ${changed.length === 1 ? "ändern" : "ändern"}.`;
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorResponse;
    const messages: Record<string, string> = {
      stale_receivable_version: "Der offene Betrag wurde inzwischen geändert. Der Vorschlag kann nicht mehr sicher übernommen werden.",
      finance_change_proposal_decided: "Dieser Vorschlag wurde bereits entschieden.",
    };
    return messages[payload.error.code] ?? payload.error.message;
  } catch {
    return "Die Anfrage konnte nicht abgeschlossen werden.";
  }
}

function formatMoney(value: string, currency = "EUR"): string {
  try {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(Number(value));
  } catch {
    return `${value} ${currency}`;
  }
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
