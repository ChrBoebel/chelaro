"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

import type { ApiErrorResponse } from "@/lib/documents";
import type {
  PaymentMethod,
  Receivable,
  ReceivableDetail,
  ReceivableDetailResponse,
  ReceivablePayment,
  ReceivableStatus,
} from "@/lib/personal-finance";
import { StatusBadge } from "@/components/ui/status-badge";
import { useDialogFocus } from "@/lib/use-dialog-focus";

export type ReceivableDrawerAction = "view" | "payment" | "edit";

const STATUS_LABELS: Record<ReceivableStatus, string> = {
  open: "Offen",
  partial: "Teilweise erhalten",
  paid: "Vollständig erhalten",
  overdue: "Überfällig",
};

const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  bank_transfer: "Überweisung",
  cash: "Bar",
  paypal: "PayPal",
  card: "Karte",
  other: "Andere",
};

export function ReceivableDrawer({
  receivable,
  initialAction,
  onClose,
  onChanged,
}: {
  receivable: Pick<Receivable, "id" | "debtor_name">;
  initialAction: ReceivableDrawerAction;
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<ReceivableDetail | null>(null);
  const [action, setAction] = useState<ReceivableDrawerAction>(initialAction);
  const [reversalTarget, setReversalTarget] = useState<ReceivablePayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogFocus<HTMLElement>(onClose);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/finance/receivables/${receivable.id}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setDetail(((await response.json()) as ReceivableDetailResponse).data);
    } catch (loadError) {
      setError(errorMessage(loadError, "Die Details konnten nicht geladen werden."));
    } finally {
      setLoading(false);
    }
  }, [receivable.id]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/finance/receivables/${receivable.id}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseMessage(response));
        return ((await response.json()) as ReceivableDetailResponse).data;
      })
      .then((data) => {
        setDetail(data);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(errorMessage(loadError, "Die Details konnten nicht geladen werden."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [receivable.id]);

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || submitting) return;
    const form = new FormData(event.currentTarget);
    await mutate(
      `/api/finance/receivables/${detail.id}/payments`,
      "POST",
      {
        expected_version: detail.version,
        amount: normalizeMoney(formValue(form, "amount")),
        booked_on: formValue(form, "date"),
        purpose: formValue(form, "purpose"),
        payment_method: formValue(form, "payment_method"),
        note: optionalFormValue(form, "note"),
      },
      "Zahlung wurde verbucht und ist im Verlauf sichtbar.",
    );
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || submitting) return;
    const form = new FormData(event.currentTarget);
    await mutate(
      `/api/finance/receivables/${detail.id}`,
      "PATCH",
      {
        expected_version: detail.version,
        debtor_name: formValue(form, "debtor_name"),
        original_amount: normalizeMoney(formValue(form, "original_amount")),
        due_date: optionalFormValue(form, "due_date"),
        description: formValue(form, "description"),
      },
      "Offener Betrag wurde aktualisiert.",
    );
  }

  async function submitReversal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !reversalTarget || submitting) return;
    const form = new FormData(event.currentTarget);
    await mutate(
      `/api/finance/receivables/${detail.id}/payments/${reversalTarget.id}/reverse`,
      "POST",
      {
        expected_version: detail.version,
        reason: formValue(form, "reason"),
      },
      "Zahlung wurde transparent korrigiert; die ursprüngliche Buchung bleibt sichtbar.",
    );
  }

  async function mutate(
    url: string,
    method: "POST" | "PATCH",
    body: Record<string, unknown>,
    successMessage: string,
  ) {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setDetail(((await response.json()) as ReceivableDetailResponse).data);
      setAction("view");
      setReversalTarget(null);
      await onChanged(successMessage);
    } catch (mutationError) {
      setError(errorMessage(mutationError, "Die Änderung konnte nicht gespeichert werden."));
    } finally {
      setSubmitting(false);
    }
  }

  const current = detail ?? receivable;

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
        aria-labelledby="receivable-drawer-title"
        tabIndex={-1}
        className="h-full w-full overflow-y-auto border-l border-line bg-paper shadow-[-24px_0_80px_rgba(10,15,10,0.16)] outline-none sm:max-w-xl"
      >
        <header className="sticky top-0 z-10 flex min-h-20 items-center justify-between gap-4 border-b border-line bg-paper/95 px-5 backdrop-blur sm:px-7">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
              Offener Betrag
            </p>
            <h2 id="receivable-drawer-title" className="mt-1 truncate text-xl font-semibold tracking-[-0.03em] text-ink">
              {current.debtor_name}
            </h2>
          </div>
          <button
            type="button"
            className="grid size-11 shrink-0 place-items-center rounded-xl text-xl text-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label="Details schließen"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="p-5 sm:p-7">
          {loading && !detail ? (
            <DrawerSkeleton />
          ) : !detail ? (
            <div className="rounded-2xl border border-line bg-surface p-5">
              <p className="text-sm text-danger" role="alert">{error}</p>
              <button type="button" className={secondaryButton} onClick={() => void loadDetail()}>
                Erneut versuchen
              </button>
            </div>
          ) : action === "payment" ? (
            <PaymentForm
              detail={detail}
              error={error}
              submitting={submitting}
              onCancel={() => {
                setError(null);
                setAction("view");
              }}
              onSubmit={submitPayment}
            />
          ) : action === "edit" ? (
            <EditForm
              detail={detail}
              error={error}
              submitting={submitting}
              onCancel={() => {
                setError(null);
                setAction("view");
              }}
              onSubmit={submitEdit}
            />
          ) : reversalTarget ? (
            <ReversalForm
              payment={reversalTarget}
              error={error}
              submitting={submitting}
              onCancel={() => {
                setError(null);
                setReversalTarget(null);
              }}
              onSubmit={submitReversal}
            />
          ) : (
            <ReceivableOverview
              detail={detail}
              onPayment={() => setAction("payment")}
              onEdit={() => setAction("edit")}
              onReverse={setReversalTarget}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function ReceivableOverview({
  detail,
  onPayment,
  onEdit,
  onReverse,
}: {
  detail: ReceivableDetail;
  onPayment: () => void;
  onEdit: () => void;
  onReverse: (payment: ReceivablePayment) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={detail.status === "overdue" ? "risk" : "confirmed"}>
          {STATUS_LABELS[detail.status]}
        </StatusBadge>
        {detail.pending_proposals > 0 ? (
          <StatusBadge tone="review">{detail.pending_proposals} KI-Vorschlag</StatusBadge>
        ) : null}
      </div>

      <p className="mt-4 text-sm leading-6 text-muted">{detail.description}</p>

      <dl className="mt-6 grid grid-cols-3 overflow-hidden rounded-2xl border border-line bg-surface/45">
        <AmountMetric label="Ursprünglich" value={detail.original_amount} currency={detail.currency} />
        <AmountMetric label="Erhalten" value={detail.received_amount} currency={detail.currency} positive />
        <AmountMetric label="Noch offen" value={detail.outstanding_amount} currency={detail.currency} strong />
      </dl>

      <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-line px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold text-muted">Fällig</p>
          <p className="mt-0.5 text-sm font-semibold text-ink">
            {detail.due_date ? formatDate(detail.due_date) : "Kein Datum festgelegt"}
          </p>
        </div>
        <button type="button" className="min-h-11 rounded-xl px-3 text-xs font-semibold text-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={onEdit}>
          Bearbeiten
        </button>
      </div>

      {detail.status !== "paid" ? (
        <button type="button" className={`${primaryButton} mt-5 w-full`} onClick={onPayment}>
          Zahlung eintragen
        </button>
      ) : null}

      <section className="mt-9" aria-labelledby="payment-history-title">
        <div className="flex items-end justify-between gap-4 border-b border-line pb-3">
          <div>
            <h3 id="payment-history-title" className="text-sm font-semibold text-ink">Zahlungsverlauf</h3>
            <p className="mt-1 text-xs text-muted">Eingänge und sichtbare Korrekturen</p>
          </div>
          <span className="text-xs tabular-nums text-muted">{detail.payments.length}</span>
        </div>

        {detail.payments.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm font-semibold text-ink">Noch keine Zahlung</p>
            <p className="mt-1 text-xs text-muted">Teilzahlungen erscheinen hier mit Zweck und Zahlungsart.</p>
          </div>
        ) : (
          <ol>
            {detail.payments.map((payment) => (
              <li key={payment.id} className="border-b border-line py-5 last:border-b-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-base font-semibold tabular-nums ${payment.reversal ? "text-muted line-through" : "text-confirmed"}`}>
                        +{formatMoney(payment.amount, detail.currency)}
                      </p>
                      {payment.reversal ? <StatusBadge tone="risk" className="min-h-5 py-0.5 text-[10px]">Korrigiert</StatusBadge> : null}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-ink">{payment.purpose}</p>
                    <p className="mt-1 text-xs text-muted">
                      {formatDate(payment.booked_on)} · {PAYMENT_METHODS[payment.payment_method]}
                    </p>
                    {payment.note ? <p className="mt-2 text-xs leading-5 text-muted">{payment.note}</p> : null}
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
                      {payment.actor_type === "agent" ? "Von der KI vorgeschlagen · von dir freigegeben" : payment.actor_type === "system" ? "Aus bestehender Buchung übernommen" : "Von dir eingetragen"}
                    </p>
                    {payment.reversal ? (
                      <div className="mt-3 rounded-xl bg-danger/5 p-3">
                        <p className="text-xs font-semibold text-danger">Korrektur: {payment.reversal.reason}</p>
                        <p className="mt-1 text-[11px] text-muted">{formatDateTime(payment.reversal.created_at)}</p>
                      </div>
                    ) : null}
                  </div>
                  {!payment.reversal ? (
                    <button type="button" className="min-h-11 shrink-0 rounded-xl px-3 text-xs font-semibold text-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => onReverse(payment)}>
                      Korrigieren
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-8" aria-labelledby="activity-title">
        <h3 id="activity-title" className="border-b border-line pb-3 text-sm font-semibold text-ink">Aktivitäten</h3>
        <ol className="mt-4 space-y-4">
          {detail.history.map((event) => (
            <li key={event.id} className="grid grid-cols-[0.625rem_minmax(0,1fr)] gap-3">
              <span aria-hidden="true" className="mt-1.5 size-2.5 rounded-full border-2 border-paper bg-line shadow-[0_0_0_1px_var(--color-line)]" />
              <div>
                <p className="text-xs font-semibold text-ink">{eventLabel(event.event_type)}</p>
                <p className="mt-0.5 text-[11px] text-muted">{formatDateTime(event.created_at)} · {actorLabel(event.actor_type)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function PaymentForm({ detail, error, submitting, onCancel, onSubmit }: FormProps & { detail: ReceivableDetail }) {
  return (
    <FormSection title="Zahlung eintragen" subtitle="Der Eingang wird als echte Einnahme gebucht und reduziert den offenen Rest." onCancel={onCancel}>
      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <FormField label="Erhaltener Betrag" name="amount" required inputMode="decimal" defaultValue={detail.outstanding_amount.replace(".", ",")} autoFocus />
        <FormField label="Eingegangen am" name="date" type="date" required defaultValue={todayValue()} />
        <FormField label="Wofür war die Zahlung?" name="purpose" required defaultValue={detail.description} />
        <label className="block">
          <span className={labelClassName}>Zahlungsart</span>
          <select name="payment_method" defaultValue="bank_transfer" className={fieldClassName}>
            {Object.entries(PAYMENT_METHODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <TextArea label="Notiz (optional)" name="note" placeholder="z. B. Verwendungszweck oder Absprache" />
        <FormError error={error} />
        <FormActions submitting={submitting} onCancel={onCancel} submitLabel="Zahlung verbuchen" busyLabel="Verbucht …" />
      </form>
    </FormSection>
  );
}

function EditForm({ detail, error, submitting, onCancel, onSubmit }: FormProps & { detail: ReceivableDetail }) {
  return (
    <FormSection title="Offenen Betrag bearbeiten" subtitle="Änderungen werden mit vorherigem und neuem Wert im Verlauf protokolliert." onCancel={onCancel}>
      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <FormField label="Wer schuldet dir Geld?" name="debtor_name" required defaultValue={detail.debtor_name} autoFocus />
        <FormField label="Ursprünglicher Betrag" name="original_amount" required inputMode="decimal" defaultValue={detail.original_amount.replace(".", ",")} />
        <FormField label="Fällig am (optional)" name="due_date" type="date" defaultValue={detail.due_date ?? ""} />
        <TextArea label="Wofür?" name="description" required defaultValue={detail.description} />
        <FormError error={error} />
        <FormActions submitting={submitting} onCancel={onCancel} submitLabel="Änderungen speichern" busyLabel="Speichert …" />
      </form>
    </FormSection>
  );
}

function ReversalForm({ payment, error, submitting, onCancel, onSubmit }: FormProps & { payment: ReceivablePayment }) {
  return (
    <FormSection title="Zahlung korrigieren" subtitle="Die ursprüngliche Zahlung bleibt sichtbar. Eine Gegenbuchung setzt den offenen Betrag nachvollziehbar zurück." onCancel={onCancel}>
      <div className="mt-6 rounded-2xl bg-surface p-4">
        <p className="text-lg font-semibold text-ink">{formatMoney(payment.amount, "EUR")}</p>
        <p className="mt-1 text-sm text-muted">{payment.purpose} · {formatDate(payment.booked_on)}</p>
      </div>
      <form className="mt-5 space-y-4" onSubmit={onSubmit}>
        <TextArea label="Warum wird korrigiert?" name="reason" required placeholder="z. B. falscher Forderung zugeordnet" autoFocus />
        <FormError error={error} />
        <FormActions submitting={submitting} onCancel={onCancel} submitLabel="Korrektur buchen" busyLabel="Korrigiert …" danger />
      </form>
    </FormSection>
  );
}

type FormProps = {
  error: string | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function FormSection({ title, subtitle, onCancel, children }: { title: string; subtitle: string; onCancel: () => void; children: React.ReactNode }) {
  return (
    <section>
      <button type="button" className="min-h-11 rounded-xl pr-3 text-sm font-semibold text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={onCancel}>← Zurück</button>
      <h3 className="mt-4 text-2xl font-semibold tracking-[-0.035em] text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted">{subtitle}</p>
      {children}
    </section>
  );
}

function FormActions({ submitting, onCancel, submitLabel, busyLabel, danger = false }: { submitting: boolean; onCancel: () => void; submitLabel: string; busyLabel: string; danger?: boolean }) {
  return (
    <div className="flex gap-2 pt-1">
      <button type="button" className="min-h-11 flex-1 rounded-xl px-4 text-sm font-semibold text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={onCancel}>Abbrechen</button>
      <button type="submit" disabled={submitting} className={`min-h-11 flex-[1.5] rounded-xl px-5 text-sm font-semibold text-paper disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 ${danger ? "bg-danger focus-visible:outline-danger" : "bg-ink focus-visible:outline-accent"}`}>{submitting ? busyLabel : submitLabel}</button>
    </div>
  );
}

function FormField({ label, name, type = "text", required = false, defaultValue, inputMode, autoFocus = false }: { label: string; name: string; type?: string; required?: boolean; defaultValue?: string; inputMode?: "decimal"; autoFocus?: boolean }) {
  return (
    <label className="block">
      <span className={labelClassName}>{label}</span>
      <input className={fieldClassName} name={name} type={type} required={required} defaultValue={defaultValue} inputMode={inputMode} autoFocus={autoFocus} maxLength={240} />
    </label>
  );
}

function TextArea({ label, name, required = false, placeholder, defaultValue, autoFocus = false }: { label: string; name: string; required?: boolean; placeholder?: string; defaultValue?: string; autoFocus?: boolean }) {
  return (
    <label className="block">
      <span className={labelClassName}>{label}</span>
      <textarea className={`${fieldClassName} min-h-24 resize-y py-3`} name={name} required={required} placeholder={placeholder} defaultValue={defaultValue} autoFocus={autoFocus} maxLength={2000} />
    </label>
  );
}

function FormError({ error }: { error: string | null }) {
  return <p className="min-h-5 text-sm text-danger" role={error ? "alert" : undefined} aria-live="polite">{error}</p>;
}

function AmountMetric({ label, value, currency, positive = false, strong = false }: { label: string; value: string; currency: string; positive?: boolean; strong?: boolean }) {
  return (
    <div className="min-w-0 border-r border-line px-3 py-4 last:border-r-0 sm:px-4">
      <dt className="truncate text-[10px] font-semibold text-muted">{label}</dt>
      <dd className={`mt-1 truncate text-sm font-semibold tabular-nums sm:text-base ${positive ? "text-confirmed" : strong ? "text-ink" : "text-muted"}`}>{formatMoney(value, currency)}</dd>
    </div>
  );
}

function DrawerSkeleton() {
  return <div className="space-y-4" aria-busy="true" aria-label="Details werden geladen"><div className="h-6 w-24 animate-pulse rounded bg-surface" /><div className="h-20 animate-pulse rounded-2xl bg-surface" /><div className="h-40 animate-pulse rounded-2xl bg-surface" /></div>;
}

const primaryButton = "min-h-11 rounded-xl bg-ink px-5 text-sm font-semibold text-paper transition-[transform,background-color] hover:bg-accent active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const secondaryButton = "mt-4 min-h-11 rounded-xl border border-line bg-paper px-4 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const fieldClassName = "h-11 w-full rounded-xl border border-line bg-paper px-3 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/15";
const labelClassName = "mb-1.5 block text-xs font-semibold text-ink";

async function responseMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorResponse;
    const messages: Record<string, string> = {
      payment_exceeds_outstanding: "Der Betrag ist größer als der noch offene Rest.",
      amount_below_received: "Der Gesamtbetrag darf nicht kleiner als bereits erhaltene Zahlungen sein.",
      stale_receivable_version: "Dieser Betrag wurde inzwischen geändert. Bitte lade die Details neu.",
      payment_already_reversed: "Diese Zahlung wurde bereits korrigiert.",
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
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Bitte fülle alle benötigten Felder aus.");
  }
  return value.trim();
}

function optionalFormValue(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function eventLabel(event: ReceivableDetail["history"][number]["event_type"]): string {
  return {
    created: "Offener Betrag angelegt",
    details_updated: "Details geändert",
    payment_recorded: "Zahlung eingetragen",
    payment_reversed: "Zahlung korrigiert",
  }[event];
}

function actorLabel(actor: ReceivableDetail["history"][number]["actor_type"]): string {
  if (actor === "agent") return "KI-Vorschlag freigegeben";
  if (actor === "system") return "Bestehende Daten übernommen";
  return "Von dir";
}

function formatMoney(value: string, currency: string): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(Number(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function todayValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
