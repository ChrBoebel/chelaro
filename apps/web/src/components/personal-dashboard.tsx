"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";

import { FinanceProposalsDrawer } from "@/components/finance-proposals-drawer";
import {
  ReceivableDrawer,
  type ReceivableDrawerAction,
} from "@/components/receivable-drawer";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import type { ApiErrorResponse } from "@/lib/documents";
import type {
  PersonalFinanceDashboard as DashboardData,
  PersonalFinanceDashboardResponse,
  Receivable,
  ReceivableStatus,
  TransactionDirection,
} from "@/lib/personal-finance";
import { useDialogFocus } from "@/lib/use-dialog-focus";

type EntryMode = TransactionDirection | "receivable";
type Notice = { tone: "error" | "success"; message: string };
type DrawerTarget = {
  receivable: Pick<Receivable, "id" | "debtor_name">;
  action: ReceivableDrawerAction;
};

const CATEGORIES = [
  "Gehalt",
  "Wohnen",
  "Lebensmittel",
  "Mobilität",
  "Freizeit",
  "Gesundheit",
  "Software & Abos",
  "Versicherungen",
  "Rückzahlung",
  "Sonstiges",
];

const RECEIVABLE_STATUS: Record<ReceivableStatus, string> = {
  open: "Offen",
  partial: "Teilweise erhalten",
  paid: "Erhalten",
  overdue: "Überfällig",
};

export function PersonalDashboard() {
  const [period, setPeriod] = useState(currentPeriod());
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [entryMode, setEntryMode] = useState<EntryMode | null>(null);
  const [drawerTarget, setDrawerTarget] = useState<DrawerTarget | null>(null);
  const [showProposals, setShowProposals] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setDashboard(await requestDashboard(period));
    } catch (error) {
      setLoadError(errorMessage(error, "Der Finanzüberblick konnte nicht geladen werden."));
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  const closeEntry = useCallback(() => setEntryMode(null), []);
  const closeDrawer = useCallback(() => setDrawerTarget(null), []);
  const closeProposals = useCallback(() => setShowProposals(false), []);

  const handleRelatedChange = useCallback(async (message: string) => {
    setNotice({ tone: "success", message });
    await reload();
  }, [reload]);

  useEffect(() => {
    const controller = new AbortController();
    void requestDashboard(period, controller.signal)
      .then((data) => {
        setDashboard(data);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(errorMessage(error, "Der Finanzüberblick konnte nicht geladen werden."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [period]);

  async function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entryMode || isSubmitting) return;
    const isReceivable = entryMode === "receivable";
    setIsSubmitting(true);
    setFormError(null);
    try {
      const form = new FormData(event.currentTarget);
      const payload = isReceivable
        ? {
            debtor_name: formValue(form, "counterparty"),
            original_amount: normalizeMoney(formValue(form, "amount")),
            currency: "EUR",
            due_date: optionalFormValue(form, "date"),
            description: formValue(form, "description"),
          }
        : {
            direction: entryMode,
            amount: normalizeMoney(formValue(form, "amount")),
            currency: "EUR",
            booked_on: formValue(form, "date"),
            counterparty: formValue(form, "counterparty"),
            category: formValue(form, "category"),
            description: optionalFormValue(form, "description"),
          };
      const response = await fetch(
        isReceivable ? "/api/finance/receivables" : "/api/finance/transactions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      setEntryMode(null);
      setNotice({
        tone: "success",
        message: isReceivable
          ? "Offener Betrag wurde vorgemerkt."
          : `${entryMode === "income" ? "Einnahme" : "Ausgabe"} wurde gebucht.`,
      });
      await reload();
    } catch (error) {
      setFormError(errorMessage(error, "Der Eintrag konnte nicht gespeichert werden."));
    } finally {
      setIsSubmitting(false);
    }
  }

  const summary = dashboard?.summary;
  const currency = summary?.currency ?? "EUR";

  return (
    <section className="pt-8 sm:pt-12" aria-labelledby="overview-title">
      <PageHeader
        titleId="overview-title"
        eyebrow="Persönliche Finanzen"
        title="Dein Überblick."
        description="Was wirklich passiert ist – und welches Geld dir noch fehlt."
        actions={(
          <>
          <PeriodControl
            label={dashboard?.period.label ?? periodLabel(period)}
            onPrevious={() => setPeriod((value) => movePeriod(value, -1))}
            onNext={() => setPeriod((value) => movePeriod(value, 1))}
          />
          {summary && summary.pending_finance_proposals > 0 ? (
            <Button
              variant="review"
              size="regular"
              onClick={() => setShowProposals(true)}
            >
              {summary.pending_finance_proposals} {summary.pending_finance_proposals === 1 ? "KI-Vorschlag" : "KI-Vorschläge"}
            </Button>
          ) : null}
          <Button
            size="regular"
            onClick={() => {
              setFormError(null);
              setEntryMode("expense");
            }}
          >
            <span aria-hidden="true" className="mr-2 text-base">＋</span>
            Neu erfassen
          </Button>
          </>
        )}
      />

      <p
        className="mt-5 min-h-5 text-sm empty:min-h-0"
        data-tone={notice?.tone}
        aria-live="polite"
      >
        {notice?.message}
      </p>

      {loadError ? (
        <DashboardError message={loadError} onRetry={() => void reload()} />
      ) : isLoading && !dashboard ? (
        <DashboardSkeleton />
      ) : dashboard && summary ? (
        <>
          <div className="mt-4 grid overflow-hidden rounded-panel border border-line bg-paper shadow-panel lg:grid-cols-[1.35fr_0.65fr]">
            <section className="border-b border-line p-5 sm:p-7 lg:border-r lg:border-b-0" aria-labelledby="cashflow-summary">
              <p id="cashflow-summary" className="text-xs font-semibold text-muted">Monatssaldo</p>
              <p
                className={`mt-3 text-[clamp(2.5rem,7vw,5.25rem)] font-medium leading-none tracking-[-0.06em] tabular-nums ${
                  Number(summary.net) < 0 ? "text-danger" : "text-ink"
                }`}
              >
                {formatMoney(summary.net, currency, true)}
              </p>
              <div className="mt-8 grid grid-cols-2 gap-4 border-t border-line pt-5">
                <Metric label="Reingekommen" value={formatMoney(summary.income, currency)} tone="positive" />
                <Metric label="Ausgegeben" value={formatMoney(summary.expenses, currency)} tone="negative" />
              </div>
            </section>

            <section className="flex flex-col justify-between bg-surface/45 p-5 sm:p-7" aria-labelledby="outstanding-summary">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <p id="outstanding-summary" className="text-xs font-semibold text-muted">Noch offen für dich</p>
                  {summary.overdue_receivables > 0 ? (
                    <span className="rounded-full bg-danger/8 px-2.5 py-1 text-[10px] font-semibold text-danger">
                      {summary.overdue_receivables} überfällig
                    </span>
                  ) : null}
                </div>
                <p className="mt-3 text-3xl font-medium tracking-[-0.045em] text-ink tabular-nums sm:text-4xl">
                  {formatMoney(summary.outstanding_receivables, currency)}
                </p>
                <p className="mt-3 text-sm leading-6 text-muted">
                  Erwartetes Geld zählt erst nach Eingang zu deinen Einnahmen.
                </p>
              </div>
              <button
                type="button"
                className="mt-7 min-h-11 self-start rounded-xl border border-line bg-paper px-4 text-sm font-semibold text-ink transition-colors hover:border-accent/40 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onClick={() => {
                  setFormError(null);
                  setEntryMode("receivable");
                }}
              >
                Offenen Betrag notieren
              </button>
            </section>
          </div>

          <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <CashflowChart points={dashboard.cashflow} currency={currency} />
            <ReceivablesPanel
              items={dashboard.open_receivables}
              currency={currency}
              onOpen={(item, action) => setDrawerTarget({ receivable: item, action })}
              onCreate={() => {
                setFormError(null);
                setEntryMode("receivable");
              }}
            />
          </div>

          <RecentTransactions
            items={dashboard.recent_transactions}
            currency={currency}
            onCreate={(mode) => {
              setFormError(null);
              setEntryMode(mode);
            }}
          />
        </>
      ) : null}

      {entryMode ? (
        <EntryDialog
          mode={entryMode}
          submitting={isSubmitting}
          error={formError}
          onClose={closeEntry}
          onSubmit={submitEntry}
          onModeChange={(mode) => {
            setFormError(null);
            setEntryMode(mode);
          }}
        />
      ) : null}

      {drawerTarget ? (
        <ReceivableDrawer
          key={`${drawerTarget.receivable.id}:${drawerTarget.action}`}
          receivable={drawerTarget.receivable}
          initialAction={drawerTarget.action}
          onClose={closeDrawer}
          onChanged={handleRelatedChange}
        />
      ) : null}

      {showProposals ? (
        <FinanceProposalsDrawer
          onClose={closeProposals}
          onChanged={handleRelatedChange}
          onOpenReceivable={(id) => {
            const item = dashboard?.open_receivables.find((receivable) => receivable.id === id);
            setShowProposals(false);
            setDrawerTarget({
              receivable: item ?? { id, debtor_name: "Offener Betrag" },
              action: "view",
            });
          }}
        />
      ) : null}
    </section>
  );
}

function PeriodControl({
  label,
  onPrevious,
  onNext,
}: {
  label: string;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex h-11 items-center rounded-xl border border-line bg-paper" aria-label="Zeitraum auswählen">
      <button type="button" className="grid size-11 place-items-center rounded-xl text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" aria-label="Vorheriger Monat" onClick={onPrevious}>‹</button>
      <span className="min-w-28 px-1 text-center text-xs font-semibold text-ink sm:min-w-32">{label}</span>
      <button type="button" className="grid size-11 place-items-center rounded-xl text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" aria-label="Nächster Monat" onClick={onNext}>›</button>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "positive" | "negative" }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-lg font-semibold tracking-[-0.025em] tabular-nums ${tone === "positive" ? "text-confirmed" : "text-ink"}`}>{tone === "positive" ? "+" : "−"}{value}</p>
    </div>
  );
}

function CashflowChart({ points, currency }: { points: DashboardData["cashflow"]; currency: string }) {
  const maximum = Math.max(1, ...points.flatMap((point) => [Number(point.income), Number(point.expenses)]));
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-line bg-paper p-5 sm:p-6" aria-labelledby="cashflow-title">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 id="cashflow-title" className="text-sm font-semibold text-ink">Geldfluss</h2>
          <p className="mt-1 text-xs text-muted">Tatsächlich gebuchte Einnahmen und Ausgaben</p>
        </div>
        <div className="flex gap-3 text-[10px] text-muted" aria-hidden="true">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-accent" />Rein</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-line" />Raus</span>
        </div>
      </div>
      <div className="mt-8 grid h-44 min-w-0 grid-cols-6 gap-2 border-b border-line px-1 sm:gap-3" role="img" aria-label="Geldfluss der letzten sechs Monate">
        {points.map((point) => (
          <div key={point.month} className="flex min-w-0 flex-col items-center justify-end gap-2" aria-label={`${point.label}: ${formatMoney(point.income, currency)} Einnahmen, ${formatMoney(point.expenses, currency)} Ausgaben`}>
            <div className="flex h-32 w-full items-end justify-center gap-1">
              <span className="w-[28%] min-w-2 rounded-t-md bg-accent/85" style={{ height: `${Math.max(2, (Number(point.income) / maximum) * 100)}%` }} />
              <span className="w-[28%] min-w-2 rounded-t-md bg-line" style={{ height: `${Math.max(2, (Number(point.expenses) / maximum) * 100)}%` }} />
            </div>
            <span className="pb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">{point.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReceivablesPanel({
  items,
  currency,
  onOpen,
  onCreate,
}: {
  items: Receivable[];
  currency: string;
  onOpen: (item: Receivable, action: ReceivableDrawerAction) => void;
  onCreate: () => void;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-line bg-paper p-5 sm:p-6" aria-labelledby="receivables-title">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 id="receivables-title" className="text-sm font-semibold text-ink">Offen für dich</h2>
          <p className="mt-1 text-xs text-muted">Geld, das du noch erwartest</p>
        </div>
        <button type="button" className="grid size-11 place-items-center rounded-xl text-xl text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" aria-label="Offenen Betrag hinzufügen" onClick={onCreate}>＋</button>
      </div>

      {items.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm font-semibold text-ink">Alles ausgeglichen</p>
          <p className="mt-1 text-xs text-muted">Aktuell fehlt dir kein vorgemerkter Betrag.</p>
        </div>
      ) : (
        <ol className="mt-4">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 border-t border-line py-3 first:border-t-0">
              <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" aria-label={`Details zu ${item.debtor_name} öffnen`} onClick={() => onOpen(item, "view")}>
                <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${item.status === "overdue" ? "bg-danger/8 text-danger" : "bg-surface text-accent"}`}>{initials(item.debtor_name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{item.debtor_name}</span>
                  <span className={`mt-0.5 block truncate text-[11px] ${item.status === "overdue" ? "text-danger" : "text-muted"}`}>{RECEIVABLE_STATUS[item.status]}{item.due_date ? ` · ${dueLabel(item.due_date)}` : ""}</span>
                </span>
                <span className="text-right">
                  <span className="block text-sm font-semibold tabular-nums text-ink">{formatMoney(item.outstanding_amount, currency)}</span>
                  {Number(item.received_amount) > 0 ? <span className="mt-0.5 block text-[10px] text-confirmed">{formatMoney(item.received_amount, currency)} erhalten</span> : null}
                </span>
              </button>
              <button type="button" className="grid size-11 shrink-0 place-items-center rounded-xl text-confirmed transition-colors hover:bg-confirmed/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-confirmed" aria-label={`Zahlung von ${item.debtor_name} eintragen`} onClick={() => onOpen(item, "payment")}><CheckIcon /></button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RecentTransactions({
  items,
  currency,
  onCreate,
}: {
  items: DashboardData["recent_transactions"];
  currency: string;
  onCreate: (mode: TransactionDirection) => void;
}) {
  return (
    <section className="mt-6 rounded-2xl border border-line bg-paper p-5 sm:p-6" aria-labelledby="transactions-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="transactions-title" className="text-sm font-semibold text-ink">Letzte Bewegungen</h2>
          <p className="mt-1 text-xs text-muted">Nur bereits eingegangene oder bezahlte Beträge</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="min-h-11 rounded-xl border border-line px-4 text-xs font-semibold text-ink transition-colors hover:border-confirmed/40 hover:text-confirmed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-confirmed" onClick={() => onCreate("income")}>＋ Einnahme</button>
          <button type="button" className="min-h-11 rounded-xl border border-line px-4 text-xs font-semibold text-ink transition-colors hover:border-accent/40 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => onCreate("expense")}>＋ Ausgabe</button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="border-t border-line py-10 text-center text-sm text-muted mt-5">Noch keine Bewegungen in diesem Finanzbuch.</p>
      ) : (
        <ol className="mt-5">
          {items.map((item) => (
            <li key={item.id} className="grid min-h-[66px] grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-line sm:grid-cols-[2.5rem_minmax(0,1.2fr)_minmax(7rem,0.55fr)_auto] sm:gap-5">
              <span aria-hidden="true" className={`grid size-9 place-items-center rounded-xl ${item.direction === "income" ? "bg-confirmed/8 text-confirmed" : "bg-surface text-muted"}`}>{item.direction === "income" ? "↓" : "↑"}</span>
              <div className="min-w-0 py-3">
                <p className="truncate text-sm font-semibold text-ink">{item.counterparty}</p>
                <p className="mt-0.5 truncate text-[11px] text-muted sm:hidden">{item.category} · {formatShortDate(item.booked_on)}</p>
              </div>
              <div className="hidden min-w-0 sm:block">
                <p className="truncate text-xs text-muted">{item.category}</p>
                <p className="mt-0.5 text-[10px] text-muted">{formatShortDate(item.booked_on)}</p>
              </div>
              <p className={`text-sm font-semibold tabular-nums ${item.direction === "income" ? "text-confirmed" : "text-ink"}`}>{item.direction === "income" ? "+" : "−"}{formatMoney(item.amount, currency)}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function EntryDialog({
  mode,
  submitting,
  error,
  onClose,
  onSubmit,
  onModeChange,
}: {
  mode: EntryMode;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onModeChange: (mode: EntryMode) => void;
}) {
  const isReceivable = mode === "receivable";
  const title = isReceivable ? "Offenen Betrag notieren" : mode === "income" ? "Einnahme erfassen" : "Ausgabe erfassen";
  return (
    <Modal title={title} onClose={onClose}>
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface p-1" aria-label="Art des Eintrags">
        {(["expense", "income", "receivable"] as const).map((value) => (
          <button key={value} type="button" aria-current={mode === value ? "true" : undefined} className="min-h-11 rounded-lg px-2 text-xs font-semibold text-muted transition-colors aria-[current=true]:bg-paper aria-[current=true]:text-ink aria-[current=true]:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => onModeChange(value)}>{value === "expense" ? "Ausgabe" : value === "income" ? "Einnahme" : "Noch offen"}</button>
        ))}
      </div>
      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <FormField label="Betrag" name="amount" required inputMode="decimal" placeholder="0,00" autoFocus />
        <FormField label={isReceivable ? "Wer schuldet dir Geld?" : mode === "income" ? "Von wem?" : "An wen?"} name="counterparty" required placeholder={isReceivable ? "Name der Person" : "Person oder Unternehmen"} />
        <FormField label={isReceivable ? "Erwartet bis" : "Datum"} name="date" type="date" required={!isReceivable} defaultValue={isReceivable ? "" : todayValue()} />
        {!isReceivable ? (
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink">Kategorie</span>
            <select name="category" required defaultValue={mode === "income" ? "Gehalt" : "Wohnen"} className={fieldClassName}>
              {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
            </select>
          </label>
        ) : null}
        <FormField label={isReceivable ? "Wofür?" : "Notiz (optional)"} name="description" required={isReceivable} placeholder={isReceivable ? "z. B. gemeinsames Abendessen" : "Kurze Beschreibung"} />
        <p className="min-h-5 text-sm text-danger" aria-live="polite">{error}</p>
        <div className="flex gap-2 pt-1">
          <button type="button" className="min-h-11 flex-1 rounded-xl px-4 text-sm font-semibold text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={onClose}>Abbrechen</button>
          <button type="submit" disabled={submitting} className="min-h-11 flex-[1.4] rounded-xl bg-ink px-5 text-sm font-semibold text-paper transition-[transform,opacity] active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{submitting ? "Speichert …" : isReceivable ? "Betrag vormerken" : "Buchung speichern"}</button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const dialogRef = useDialogFocus<HTMLElement>(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="entry-dialog-title" tabIndex={-1} className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-paper p-5 shadow-[0_28px_90px_rgba(10,15,10,0.3)] outline-none sm:rounded-3xl sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 id="entry-dialog-title" className="text-xl font-semibold tracking-[-0.03em] text-ink">{title}</h2>
          <button type="button" className="grid size-11 place-items-center rounded-xl text-xl text-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" aria-label="Dialog schließen" onClick={onClose}>×</button>
        </div>
        {children}
      </section>
    </div>
  );
}

const fieldClassName = "h-11 w-full rounded-xl border border-line bg-paper px-3 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/15";

function FormField({ label, name, type = "text", required = false, placeholder, defaultValue, inputMode, autoFocus = false }: { label: string; name: string; type?: string; required?: boolean; placeholder?: string; defaultValue?: string; inputMode?: "decimal"; autoFocus?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-ink">{label}</span>
      <input className={fieldClassName} name={name} type={type} required={required} placeholder={placeholder} defaultValue={defaultValue} inputMode={inputMode} autoFocus={autoFocus} maxLength={240} />
    </label>
  );
}

function DashboardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-4 flex flex-col gap-4 rounded-panel border border-line bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-sm font-semibold text-ink">Überblick nicht erreichbar</p><p className="mt-1 text-sm text-muted">{message}</p></div>
      <Button variant="secondary" size="regular" className="self-start sm:self-auto" onClick={onRetry}>Erneut versuchen</Button>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mt-4 grid gap-6" aria-busy="true" aria-label="Finanzüberblick wird geladen">
      <div className="h-64 animate-pulse rounded-panel border border-line bg-paper" />
      <div className="grid gap-6 lg:grid-cols-2"><div className="h-64 animate-pulse rounded-panel border border-line bg-paper" /><div className="h-64 animate-pulse rounded-panel border border-line bg-paper" /></div>
    </div>
  );
}

function CheckIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="m4 9.25 3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

async function requestDashboard(period: string, signal?: AbortSignal): Promise<DashboardData> {
  const response = await fetch(`/api/finance/dashboard?period=${encodeURIComponent(period)}&currency=EUR`, { cache: "no-store", signal });
  if (!response.ok) throw new Error(await responseMessage(response));
  return ((await response.json()) as PersonalFinanceDashboardResponse).data;
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorResponse;
    const messages: Record<string, string> = {
      payment_exceeds_outstanding: "Der Betrag ist größer als der noch offene Rest.",
      api_not_configured: "Die lokale Verbindung ist noch nicht eingerichtet.",
      api_unavailable: "Der lokale Finanzdienst ist gerade nicht erreichbar.",
    };
    return messages[payload.error.code] ?? payload.error.message;
  } catch {
    return "Die Anfrage konnte nicht abgeschlossen werden.";
  }
}

function normalizeMoney(value: string): string {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized) || Number(normalized) <= 0) {
    throw new Error("Bitte gib einen positiven Betrag mit höchstens zwei Nachkommastellen ein.");
  }
  return normalized;
}

function formValue(form: FormData, name: string): string {
  const value = form.get(name);
  if (typeof value !== "string" || value.trim() === "") throw new Error("Bitte fülle alle benötigten Felder aus.");
  return value.trim();
}

function optionalFormValue(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function formatMoney(value: string, currency: string, sign = false): string {
  const amount = Number(value);
  const formatted = new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(Math.abs(amount));
  if (!sign || amount === 0) return formatted;
  return `${amount > 0 ? "+" : "−"}${formatted}`;
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short" }).format(new Date(`${value}T12:00:00`));
}

function dueLabel(value: string): string {
  const due = new Date(`${value}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return `seit ${Math.abs(days)} ${Math.abs(days) === 1 ? "Tag" : "Tagen"}`;
  if (days === 0) return "heute fällig";
  if (days === 1) return "morgen fällig";
  return `fällig in ${days} Tagen`;
}

function initials(value: string): string {
  return value.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function movePeriod(value: string, offset: number): string {
  const [year, month] = value.split("-").map(Number);
  const next = new Date(year, month - 1 + offset, 1, 12);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

function periodLabel(value: string): string {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1, 12));
}

function todayValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
