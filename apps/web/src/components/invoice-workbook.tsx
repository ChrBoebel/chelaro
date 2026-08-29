"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ApiErrorResponse } from "@/lib/documents";
import type {
  ChangeProposal,
  ChangeProposalListResponse,
  EditableInvoiceField,
  InvoiceStatus,
  InvoiceWorkbook as InvoiceWorkbookData,
  InvoiceWorkbookResponse,
  InvoiceWorkbookRow,
  WorkbookChangeSetResponse,
  WorkbookColumn,
} from "@/lib/workbooks";

type RowDraft = Partial<Record<EditableInvoiceField, string>>;
type Drafts = Record<string, RowDraft>;
type Notice = { tone: "error" | "success"; message: string };

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  unverified: "Ungeprüft",
  verified: "Geprüft",
  open: "Offen",
  paid: "Bezahlt",
  archived: "Archiviert",
};

const FIELD_LABELS: Record<EditableInvoiceField, string> = {
  vendor: "Aussteller",
  invoice_number: "Rechnungsnr.",
  invoice_date: "Datum",
  gross_amount: "Brutto",
  currency: "Währung",
  category: "Kategorie",
  status: "Status",
  notes: "Notiz",
};

export function InvoiceWorkbook() {
  const [workbook, setWorkbook] = useState<InvoiceWorkbookData | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showProposals, setShowProposals] = useState(false);
  const [proposals, setProposals] = useState<ChangeProposal[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [decidingProposal, setDecidingProposal] = useState<string | null>(null);

  const loadWorkbook = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setWorkbook(await requestWorkbook(signal));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLoadError(errorMessage(error, "Die Rechnungstabelle konnte nicht geladen werden."));
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void requestWorkbook(controller.signal)
      .then((data) => {
        setWorkbook(data);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(
          errorMessage(error, "Die Rechnungstabelle konnte nicht geladen werden."),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, []);

  const dirtyRows = Object.keys(drafts).length;
  const dirtyCells = useMemo(
    () => Object.values(drafts).reduce((count, row) => count + Object.keys(row).length, 0),
    [drafts],
  );

  function updateCell(
    row: InvoiceWorkbookRow,
    field: EditableInvoiceField,
    nextValue: string,
  ) {
    const original = displayCellValue(row, field);
    setDrafts((current) => {
      const next = { ...current };
      const rowDraft = { ...next[row.id] };
      if (nextValue === original) delete rowDraft[field];
      else rowDraft[field] = nextValue;
      if (Object.keys(rowDraft).length === 0) delete next[row.id];
      else next[row.id] = rowDraft;
      return next;
    });
    setNotice(null);
  }

  async function saveChanges() {
    if (!workbook || dirtyRows === 0 || isSaving) return;
    let changes;
    try {
      changes = Object.entries(drafts).map(([rowId, cells]) => {
        const row = workbook.rows.find((candidate) => candidate.id === rowId);
        if (!row) throw new Error("Eine bearbeitete Zeile wurde nicht gefunden.");
        return {
          row_id: rowId,
          expected_version: row.version,
          cells: normalizeDraft(cells),
        };
      });
    } catch (error) {
      setNotice({ tone: "error", message: errorMessage(error, "Bitte prüfe die Eingaben.") });
      return;
    }

    setIsSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/workbooks/invoices/change-sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const payload = (await response.json()) as WorkbookChangeSetResponse;
      const changed = new Map(payload.data.rows.map((row) => [row.id, row]));
      setWorkbook((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((row) => changed.get(row.id) ?? row),
            }
          : current,
      );
      setDrafts({});
      setNotice({
        tone: "success",
        message: `${dirtyCells} ${dirtyCells === 1 ? "Änderung" : "Änderungen"} sicher gespeichert.`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: errorMessage(error, "Die Änderungen konnten nicht gespeichert werden."),
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function openProposals() {
    const nextOpen = !showProposals;
    setShowProposals(nextOpen);
    if (!nextOpen) return;
    await loadProposals();
  }

  async function loadProposals() {
    setProposalsLoading(true);
    try {
      const response = await fetch("/api/change-proposals", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseMessage(response));
      const payload = (await response.json()) as ChangeProposalListResponse;
      setProposals(payload.data.filter((proposal) => proposal.status === "pending"));
    } catch (error) {
      setNotice({
        tone: "error",
        message: errorMessage(error, "KI-Vorschläge konnten nicht geladen werden."),
      });
    } finally {
      setProposalsLoading(false);
    }
  }

  async function decideProposal(id: string, action: "approve" | "reject") {
    setDecidingProposal(id);
    setNotice(null);
    try {
      const response = await fetch(`/api/change-proposals/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setProposals((current) => current.filter((proposal) => proposal.id !== id));
      setWorkbook((current) =>
        current
          ? { ...current, pending_proposals: Math.max(0, current.pending_proposals - 1) }
          : current,
      );
      if (action === "approve") await loadWorkbook();
      setNotice({
        tone: "success",
        message: action === "approve" ? "Vorschlag übernommen." : "Vorschlag abgelehnt.",
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: errorMessage(error, "Der Vorschlag konnte nicht bearbeitet werden."),
      });
    } finally {
      setDecidingProposal(null);
    }
  }

  return (
    <section className="pt-10 sm:pt-14" aria-labelledby="workbook-title">
      <PageHeader
        titleId="workbook-title"
        eyebrow="Rechnungsübersicht"
        title="Rechnungen im Blick."
        description="Direkt bearbeiten wie in einer Tabelle. Jede Änderung bleibt versioniert und nachvollziehbar."
        actions={(
          <>
          {(workbook?.pending_proposals ?? 0) > 0 ? (
            <Button
              variant="review"
              aria-expanded={showProposals}
              onClick={() => void openProposals()}
            >
              {workbook?.pending_proposals} KI-{workbook?.pending_proposals === 1 ? "Vorschlag" : "Vorschläge"}
            </Button>
          ) : null}
          <p className="font-mono text-xs tabular-nums text-muted" aria-live="polite">
            {isLoading
              ? "Wird geladen …"
              : `${workbook?.rows.length ?? 0} ${workbook?.rows.length === 1 ? "Zeile" : "Zeilen"}`}
          </p>
          </>
        )}
      />

      {showProposals ? (
        <ProposalReview
          proposals={proposals}
          loading={proposalsLoading}
          deciding={decidingProposal}
          onDecision={decideProposal}
        />
      ) : null}

      <p
        className="mt-6 min-h-5 text-sm empty:min-h-0"
        data-tone={notice?.tone}
        aria-live="polite"
      >
        {notice?.message}
      </p>

      {loadError ? (
        <ErrorState message={loadError} onRetry={() => void loadWorkbook()} />
      ) : isLoading ? (
        <WorkbookSkeleton />
      ) : workbook && workbook.rows.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-panel border border-line bg-paper shadow-panel">
          <table className="w-full min-w-[1500px] table-fixed border-collapse text-left">
            <caption className="sr-only">Bearbeitbare Rechnungstabelle</caption>
            <colgroup>
              {workbook.columns.map((column) => (
                <col key={column.key} style={{ width: column.width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {workbook.columns.map((column, index) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`h-11 border-b border-r border-line bg-surface px-3 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted last:border-r-0 ${
                      index === 0 ? "sticky left-0 z-20 shadow-[1px_0_0_var(--line)]" : ""
                    }`}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workbook.rows.map((row) => (
                <WorkbookRow
                  key={row.id}
                  row={row}
                  columns={workbook.columns}
                  draft={drafts[row.id] ?? {}}
                  onChange={updateCell}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-line bg-surface/45 px-6 py-16 text-center">
          <p className="text-sm font-semibold text-ink">Noch keine Rechnungszeilen</p>
          <p className="mt-2 text-sm text-muted">
            Lade zuerst einen Beleg unter „Dokumente“ hoch. Die passende Zeile entsteht automatisch.
          </p>
        </div>
      )}

      {dirtyRows > 0 ? (
        <div className="sticky bottom-4 z-30 mx-auto mt-5 flex max-w-xl flex-col gap-3 rounded-2xl border border-line bg-ink p-3 text-paper shadow-[0_18px_55px_rgba(10,15,10,0.25)] sm:flex-row sm:items-center sm:justify-between sm:pl-5">
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{dirtyCells}</span>{" "}
            {dirtyCells === 1 ? "Zelle geändert" : "Zellen geändert"}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="min-h-11 flex-1 rounded-xl px-4 text-sm font-semibold text-paper/70 transition-colors hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper sm:flex-none"
              onClick={() => setDrafts({})}
              disabled={isSaving}
            >
              Verwerfen
            </button>
            <button
              type="button"
              className="min-h-11 flex-1 rounded-xl bg-paper px-5 text-sm font-semibold text-ink transition-[transform,opacity] active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper sm:flex-none"
              onClick={() => void saveChanges()}
              disabled={isSaving}
            >
              {isSaving ? "Speichert …" : "Änderungen speichern"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function WorkbookRow({
  row,
  columns,
  draft,
  onChange,
}: {
  row: InvoiceWorkbookRow;
  columns: WorkbookColumn[];
  draft: RowDraft;
  onChange: (row: InvoiceWorkbookRow, field: EditableInvoiceField, value: string) => void;
}) {
  return (
    <tr className="group">
      {columns.map((column) => {
        if (column.key === "document") {
          return (
            <th
              key={column.key}
              scope="row"
              className="sticky left-0 z-10 h-[54px] border-b border-r border-line bg-paper px-3 font-normal shadow-[1px_0_0_var(--line)] group-last:border-b-0"
            >
              <a
                href={`/api/documents/${row.document_id}/content`}
                className="flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-semibold text-ink outline-none transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={`${row.document_filename} öffnen`}
              >
                <DocumentIcon />
                <span className="truncate">{row.document_filename}</span>
              </a>
            </th>
          );
        }
        if (!isEditableField(column.key)) return null;
        const value = draft[column.key] ?? displayCellValue(row, column.key);
        const dirty = draft[column.key] !== undefined;
        return (
          <td
            key={column.key}
            className={`h-[54px] border-b border-r border-line p-1.5 last:border-r-0 group-last:border-b-0 ${
              dirty ? "bg-accent/7" : "bg-paper"
            }`}
          >
            <CellEditor
              row={row}
              column={column}
              value={value}
              dirty={dirty}
              onChange={(next) => onChange(row, column.key as EditableInvoiceField, next)}
            />
          </td>
        );
      })}
    </tr>
  );
}

function CellEditor({
  row,
  column,
  value,
  dirty,
  onChange,
}: {
  row: InvoiceWorkbookRow;
  column: WorkbookColumn;
  value: string;
  dirty: boolean;
  onChange: (value: string) => void;
}) {
  const label = `${column.label} für ${row.document_filename}`;
  const className = `h-11 w-full rounded-lg border px-2.5 text-sm text-ink outline-none transition-[border-color,background-color,box-shadow] placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/15 ${
    dirty ? "border-accent/35 bg-paper" : "border-transparent bg-transparent hover:border-line"
  }`;

  if (column.data_type === "status") {
    return (
      <select aria-label={label} className={className} value={value} onChange={(event) => onChange(event.target.value)}>
        {Object.entries(STATUS_LABELS).map(([status, statusLabel]) => (
          <option key={status} value={status}>{statusLabel}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      aria-label={label}
      className={className}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      type={column.data_type === "date" ? "date" : "text"}
      inputMode={column.data_type === "money" ? "decimal" : undefined}
      maxLength={column.data_type === "currency" ? 3 : column.key === "notes" ? 2000 : 240}
      placeholder={cellPlaceholder(column.data_type)}
      spellCheck={column.data_type === "text" || column.data_type === "category"}
    />
  );
}

function ProposalReview({
  proposals,
  loading,
  deciding,
  onDecision,
}: {
  proposals: ChangeProposal[];
  loading: boolean;
  deciding: string | null;
  onDecision: (id: string, action: "approve" | "reject") => Promise<void>;
}) {
  return (
    <section className="mt-8 rounded-panel border border-review/25 bg-review/5 p-4 sm:p-6" aria-labelledby="proposal-title">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-review">Kontrollschritt</p>
          <h2 id="proposal-title" className="mt-1 text-sm font-semibold text-ink">KI-Vorschläge prüfen</h2>
        </div>
        <StatusBadge tone="review" className="font-mono text-[10px]">Nur nach Freigabe</StatusBadge>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-muted" aria-live="polite">Vorschläge werden geladen …</p>
      ) : proposals.length === 0 ? (
        <p className="mt-6 text-sm text-muted">Keine offenen Vorschläge.</p>
      ) : (
        <ol className="mt-5 space-y-3">
          {proposals.map((proposal) => (
            <li key={proposal.id} className="rounded-xl border border-line bg-paper p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{proposal.rationale}</p>
                  <p className="mt-1 text-xs text-muted">{proposal.agent_id} · {formatDateTime(proposal.created_at)}</p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {proposal.items.map((item, index) => (
                      <li key={`${item.row_id}-${item.field}-${index}`} className="rounded-lg bg-surface px-2.5 py-1.5 text-xs text-muted">
                        <span className="font-semibold text-ink">{FIELD_LABELS[item.field]}</span>{" "}
                        {formatProposalValue(item.before)} → {formatProposalValue(item.proposed)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="danger"
                    size="regular"
                    disabled={deciding === proposal.id}
                    onClick={() => void onDecision(proposal.id, "reject")}
                  >
                    Ablehnen
                  </Button>
                  <Button
                    size="regular"
                    disabled={deciding === proposal.id}
                    onClick={() => void onDecision(proposal.id, "approve")}
                  >
                    {deciding === proposal.id ? "Prüft …" : "Übernehmen"}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-ink">Tabelle nicht erreichbar</p>
        <p className="mt-1 text-sm text-muted">{message}</p>
      </div>
      <Button variant="secondary" size="regular" className="self-start sm:self-auto" onClick={onRetry}>
        Erneut versuchen
      </Button>
    </div>
  );
}

function WorkbookSkeleton() {
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-paper" aria-busy="true" aria-label="Rechnungstabelle wird geladen">
      <div className="h-11 animate-pulse border-b border-line bg-surface" />
      {[0, 1, 2].map((row) => (
        <div key={row} aria-hidden="true" className="flex h-[54px] items-center gap-8 border-b border-line px-4 last:border-b-0">
          <span className="h-3 w-40 animate-pulse rounded bg-line" />
          <span className="h-3 w-28 animate-pulse rounded bg-line" />
          <span className="h-3 w-24 animate-pulse rounded bg-line" />
        </div>
      ))}
    </div>
  );
}

function displayCellValue(row: InvoiceWorkbookRow, field: EditableInvoiceField): string {
  const value = row[field];
  return value === null ? "" : String(value);
}

function normalizeDraft(draft: RowDraft): Record<string, string | null> {
  const cells: Record<string, string | null> = {};
  for (const [field, rawValue] of Object.entries(draft) as [EditableInvoiceField, string][]) {
    const trimmed = rawValue.trim();
    if (field === "currency") {
      const currency = trimmed.toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Währungen benötigen einen dreistelligen ISO-Code, z. B. EUR.");
      cells[field] = currency;
    } else if (field === "gross_amount") {
      const amount = trimmed.replace(",", ".");
      if (amount === "") cells[field] = null;
      else if (!/^\d+(\.\d{1,2})?$/.test(amount)) throw new Error("Bruttobeträge dürfen höchstens zwei Nachkommastellen haben.");
      else cells[field] = amount;
    } else if (field === "status") {
      cells[field] = trimmed;
    } else {
      cells[field] = trimmed === "" ? null : trimmed;
    }
  }
  return cells;
}

function isEditableField(value: string): value is EditableInvoiceField {
  return value in FIELD_LABELS;
}

function cellPlaceholder(type: WorkbookColumn["data_type"]): string {
  if (type === "money") return "0,00";
  if (type === "currency") return "EUR";
  return "—";
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorResponse;
    const messages: Record<string, string> = {
      stale_workbook_version: "Die Zeile wurde inzwischen geändert. Lade die Tabelle neu und prüfe deine Eingabe.",
      api_not_configured: "Die lokale Verbindung ist noch nicht eingerichtet.",
      api_unavailable: "Der lokale Finanzdienst ist gerade nicht erreichbar.",
    };
    return messages[payload.error.code] ?? payload.error.message;
  } catch {
    return "Die Anfrage konnte nicht abgeschlossen werden.";
  }
}

async function requestWorkbook(signal?: AbortSignal): Promise<InvoiceWorkbookData> {
  const response = await fetch("/api/workbooks/invoices", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(await responseMessage(response));
  const payload = (await response.json()) as InvoiceWorkbookResponse;
  return payload.data;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatProposalValue(value: unknown): string {
  if (value === null || value === "") return "leer";
  return String(value);
}

function DocumentIcon() {
  return (
    <svg aria-hidden="true" className="shrink-0 text-muted" width="16" height="16" viewBox="0 0 18 18" fill="none">
      <path d="M5 2.75h5l3 3v9.5H5v-12.5Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M10 2.75v3h3" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  );
}
