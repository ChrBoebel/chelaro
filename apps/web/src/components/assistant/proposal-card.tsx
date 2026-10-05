import { useRef, useState } from "react";
import { assistantRequest } from "@/lib/finance-assistant-client";
import {
  type AssistantProposal, formatProposalMoney, isStaleProposal, parseAssistantProposal,
  PROPOSAL_ACTION_LABELS, proposalFields,
} from "@/lib/assistant-proposals";

export function ProposalCard({ item, onChanged, onRefresh }: {
  item: AssistantProposal;
  onChanged: (item: AssistantProposal) => void;
  onRefresh: () => Promise<void>;
}) {
  const { proposal: p, currency } = item;
  const [working, setWorking] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const pending = p.status === "pending";
  const stale = isStaleProposal(p);
  const missingPayment = p.action === "payment_reverse" && item.payment === null;
  const amount = item.payment?.amount ?? p.payload.original_amount ?? p.payload.amount;
  const purpose = item.payment?.purpose ?? p.payload.description ?? p.payload.purpose ?? p.payload.reason;

  async function decide(decision: "approve" | "reject") {
    if (inFlight.current || !pending || (decision === "approve" && (stale || missingPayment))) return;
    inFlight.current = true;
    setWorking(decision);
    setError(null);
    try {
      const response = await assistantRequest(`/api/finance/change-proposals/${encodeURIComponent(p.id)}/${decision}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const result = parseAssistantProposal({ ...item, proposal: response.data });
      if (result.proposal.id !== p.id || result.proposal.status !== (decision === "approve" ? "approved" : "rejected")) throw new Error("invalid_decision");
      onChanged(result);
    } catch {
      setError("Die Entscheidung wurde nicht bestätigt. Status erneut prüfen, bevor du es noch einmal versuchst.");
      await onRefresh();
    } finally {
      inFlight.current = false;
      setWorking(null);
    }
  }

  return (
    <section className={`assistant-proposal ${pending ? "" : "assistant-proposal-decided"}`} aria-label={`${PROPOSAL_ACTION_LABELS[p.action]}: ${p.debtor_name}`} aria-busy={working !== null}>
      <div className="assistant-proposal-heading">
        <span aria-hidden="true" className="assistant-proposal-icon">{pending ? "◇" : p.status === "approved" ? "✓" : "×"}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-medium text-ink">{PROPOSAL_ACTION_LABELS[p.action]}</h3>
          <p className="mt-1 break-words text-sm text-ink">{p.debtor_name}{typeof amount === "string" ? <strong className="ml-2 font-medium">{formatProposalMoney(amount, currency)}</strong> : null}</p>
          {typeof purpose === "string" ? <p className="mt-1 break-words text-xs text-muted">{purpose}</p> : null}
        </div>
        <span className="assistant-proposal-status" role="status">{pending ? "Freigabe nötig" : p.status === "approved" ? "Akzeptiert" : "Abgelehnt"}</span>
      </div>
      <details className="assistant-proposal-details" open={pending && p.action !== "receivable_create" ? true : undefined}>
        <summary>Details prüfen</summary>
        <dl>{proposalFields(item).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p className="mt-3 text-xs leading-5 text-muted">{p.rationale}</p>
      </details>
      {pending && stale ? <p className="mt-3 text-xs text-danger" role="status">Der Betrag wurde inzwischen geändert. Bitte einen neuen Vorschlag erstellen lassen.</p> : null}
      {pending && missingPayment ? <p className="mt-3 text-xs text-danger">Die zugehörige Zahlung konnte nicht geladen werden. Bitte den Status erneut prüfen.</p> : null}
      {error && pending ? <p className="mt-3 text-xs text-danger" role="alert">{error}</p> : null}
      {pending ? <div className="assistant-proposal-actions">
        <span className="mr-auto text-[11px] text-muted">Änderung erst nach deiner Freigabe</span>
        <button type="button" disabled={working !== null} onClick={() => void decide("reject")}>{working === "reject" ? "Wird abgelehnt …" : "Ablehnen"}</button>
        <button type="button" className="assistant-proposal-accept" disabled={working !== null || stale || missingPayment} onClick={() => void decide("approve")}>{working === "approve" ? "Wird übernommen …" : "Akzeptieren"}</button>
      </div> : null}
    </section>
  );
}
