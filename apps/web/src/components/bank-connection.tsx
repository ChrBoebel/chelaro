"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ApiErrorResponse } from "@/lib/documents";
import type {
  BankConnection,
  BankingReadiness,
  BankingReadinessResponse,
  TanMethod,
} from "@/lib/banking";

type Notice = { tone: "error" | "success"; message: string };
type ConfirmationValue = "unknown" | "yes" | "no";

const DEFAULT_CONNECTION = {
  institution_name: "Kreissparkasse Göppingen",
  bank_code: "61050000",
  bic: "GOPSDE6GXXX",
} as const;

export function BankConnectionSetup() {
  const [readiness, setReadiness] = useState<BankingReadiness | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const loadReadiness = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/banking/readiness", {
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw new Error(await responseMessage(response));
    const payload = (await response.json()) as BankingReadinessResponse;
    setReadiness(payload.data);
    setLoadError(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void requestReadiness(controller.signal)
      .then((data) => {
        setReadiness(data);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(errorMessage(error, "Der Bankbereich konnte nicht geladen werden."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function saveConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setNotice(null);
    try {
      const values = connectionValues(new FormData(event.currentTarget));
      const connection = readiness?.connection ?? null;
      const body = connection ? updatePayload(connection, values) : values;
      const response = await fetch(
        connection
          ? `/api/banking/connections/${encodeURIComponent(connection.id)}`
          : "/api/banking/connections",
        {
          method: connection ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      await loadReadiness();
      setNotice({
        tone: "success",
        message: "Bankdaten wurden sicher ohne PIN oder TAN vorgemerkt.",
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: errorMessage(error, "Die Vorbereitung konnte nicht gespeichert werden."),
      });
    } finally {
      setIsSaving(false);
    }
  }

  const connection = readiness?.connection;

  return (
    <section className="pt-8 sm:pt-12" aria-labelledby="banking-title">
      <PageHeader
        titleId="banking-title"
        eyebrow="FinTS · nur lesend"
        title="Bankzugang vorbereiten."
        description="Hier sammeln wir ausschließlich technische Bankangaben. Zugangsdaten bleiben außerhalb der Datenbank und Umsätze werden später zunächst zur Prüfung vorgemerkt."
        actions={<StatusBadge tone="neutral">Noch kein Live-Zugriff</StatusBadge>}
      />

      <p className="mt-5 min-h-5 text-sm empty:min-h-0" data-tone={notice?.tone} aria-live="polite">
        {notice?.message}
      </p>

      {loadError ? (
        <div className="mt-4 rounded-panel border border-line bg-surface p-6">
          <p className="text-sm font-semibold text-ink">Bankbereich nicht erreichbar</p>
          <p className="mt-1 text-sm text-muted">{loadError}</p>
        </div>
      ) : isLoading || !readiness ? (
        <div className="mt-4 h-72 animate-pulse rounded-panel border border-line bg-paper" aria-busy="true" />
      ) : (
        <div className="mt-4 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <form
            key={connection?.version ?? "new"}
            className="rounded-panel border border-line bg-paper p-5 shadow-panel sm:p-7"
            onSubmit={saveConnection}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.025em] text-ink">
                  Institutsdaten
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted">
                  Diese Angaben kannst du bei der Sparkasse bestätigen lassen.
                </p>
              </div>
              {connection ? (
                <StatusBadge tone="confirmed" className="text-[10px]">Gespeichert</StatusBadge>
              ) : null}
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <FormField
                label="Bank"
                name="institution_name"
                defaultValue={connection?.institution_name ?? DEFAULT_CONNECTION.institution_name}
                className="sm:col-span-2"
                required
              />
              <FormField
                label="BLZ"
                name="bank_code"
                defaultValue={connection?.bank_code ?? DEFAULT_CONNECTION.bank_code}
                inputMode="numeric"
                pattern="[0-9]{8}"
                required
              />
              <FormField
                label="BIC"
                name="bic"
                defaultValue={connection?.bic ?? DEFAULT_CONNECTION.bic}
              />
              <FormField
                label="FinTS-Kommunikationsadresse"
                name="endpoint"
                type="url"
                placeholder="https://…/fints30"
                defaultValue={connection?.endpoint ?? ""}
                className="sm:col-span-2"
              />
              <SelectField
                label="TAN-Verfahren"
                name="tan_method"
                defaultValue={connection?.tan_method ?? "unknown"}
                options={[
                  ["unknown", "Noch nicht bestätigt"],
                  ["push_tan", "pushTAN"],
                  ["chip_tan", "chipTAN"],
                  ["other", "Anderes Verfahren"],
                ]}
              />
              <SelectField
                label="Umsatzabruf freigeschaltet"
                name="transaction_access_confirmed"
                defaultValue={confirmationValue(connection?.transaction_access_confirmed)}
                options={confirmationOptions}
              />
              <SelectField
                label="PDF-Kontoauszüge über FinTS"
                name="statement_access_confirmed"
                defaultValue={confirmationValue(connection?.statement_access_confirmed)}
                options={confirmationOptions}
                className="sm:col-span-2"
              />
            </div>

            <div className="mt-6 rounded-xl border border-accent/20 bg-accent/5 p-4">
              <p className="text-xs font-semibold text-accent">Sicherheitsgrenze</p>
              <p className="mt-1 text-sm leading-6 text-muted">{readiness.security_notice}</p>
            </div>

            <Button
              type="submit"
              size="regular"
              disabled={isSaving}
              className="mt-6"
            >
              {isSaving ? "Speichert …" : connection ? "Vorbereitung aktualisieren" : "Vorbereitung speichern"}
            </Button>
          </form>

          <section className="rounded-panel border border-line bg-surface/55 p-5 sm:p-7" aria-labelledby="readiness-title">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted">Vorbereitung</p>
            <h2 id="readiness-title" className="mt-2 text-lg font-semibold tracking-[-0.025em] text-ink">
              Weg zum ersten Abruf
            </h2>
            <ol className="mt-5 space-y-3">
              {readiness.checks.map((check) => (
                <li key={check.code} className="flex gap-3 rounded-xl border border-line bg-paper p-4">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                      check.complete ? "bg-confirmed/12 text-confirmed" : "bg-surface text-muted"
                    }`}
                  >
                    {check.complete ? "✓" : "·"}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-ink">{check.label}</p>
                    <p className="mt-1 text-xs leading-5 text-muted">{check.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </section>
  );
}

const fieldClassName =
  "h-11 w-full rounded-xl border border-line bg-paper px-3 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/15";

function FormField({
  label,
  name,
  defaultValue,
  className,
  type = "text",
  placeholder,
  inputMode,
  pattern,
  required = false,
}: {
  label: string;
  name: string;
  defaultValue: string;
  className?: string;
  type?: string;
  placeholder?: string;
  inputMode?: "numeric";
  pattern?: string;
  required?: boolean;
}) {
  return (
    <label className={className}>
      <span className="mb-1.5 block text-xs font-semibold text-ink">{label}</span>
      <input
        className={fieldClassName}
        name={name}
        defaultValue={defaultValue}
        type={type}
        placeholder={placeholder}
        inputMode={inputMode}
        pattern={pattern}
        required={required}
        maxLength={240}
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  options,
  className,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: ReadonlyArray<readonly [string, string]>;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className="mb-1.5 block text-xs font-semibold text-ink">{label}</span>
      <select className={fieldClassName} name={name} defaultValue={defaultValue}>
        {options.map(([value, text]) => (
          <option key={value} value={value}>{text}</option>
        ))}
      </select>
    </label>
  );
}

const confirmationOptions = [
  ["unknown", "Noch nicht geklärt"],
  ["yes", "Ja"],
  ["no", "Nein"],
] as const;

function connectionValues(form: FormData) {
  return {
    provider: "fints" as const,
    access_mode: "read_only" as const,
    institution_name: requiredValue(form, "institution_name"),
    bank_code: requiredValue(form, "bank_code"),
    bic: optionalValue(form, "bic")?.toUpperCase() ?? null,
    endpoint: optionalValue(form, "endpoint"),
    tan_method: requiredValue(form, "tan_method") as TanMethod,
    transaction_access_confirmed: parseConfirmation(form, "transaction_access_confirmed"),
    statement_access_confirmed: parseConfirmation(form, "statement_access_confirmed"),
  };
}

function updatePayload(connection: BankConnection, values: ReturnType<typeof connectionValues>) {
  const payload: Record<string, unknown> = { expected_version: connection.version };
  for (const key of [
    "institution_name",
    "bank_code",
    "bic",
    "endpoint",
    "tan_method",
    "transaction_access_confirmed",
    "statement_access_confirmed",
  ] as const) {
    if (connection[key] !== values[key]) payload[key] = values[key];
  }
  if (Object.keys(payload).length === 1) throw new Error("Es gibt keine Änderungen zu speichern.");
  return payload;
}

function parseConfirmation(form: FormData, name: string): boolean | null {
  const value = requiredValue(form, name) as ConfirmationValue;
  return value === "unknown" ? null : value === "yes";
}

function confirmationValue(value: boolean | null | undefined): ConfirmationValue {
  return value === undefined || value === null ? "unknown" : value ? "yes" : "no";
}

function requiredValue(form: FormData, name: string): string {
  const value = form.get(name);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Bitte fülle alle benötigten Felder aus.");
  }
  return value.trim();
}

function optionalValue(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorResponse;
    const messages: Record<string, string> = {
      stale_bank_connection_version: "Die Bankdaten wurden zwischenzeitlich geändert. Bitte lade neu.",
      bank_connection_exists: "Diese Bankverbindung ist bereits vorbereitet.",
      api_not_configured: "Die lokale Verbindung ist noch nicht eingerichtet.",
      api_unavailable: "Der lokale Finanzdienst ist gerade nicht erreichbar.",
    };
    return messages[payload.error.code] ?? payload.error.message;
  } catch {
    return "Die Anfrage konnte nicht abgeschlossen werden.";
  }
}

async function requestReadiness(signal?: AbortSignal): Promise<BankingReadiness> {
  const response = await fetch("/api/banking/readiness", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(await responseMessage(response));
  return ((await response.json()) as BankingReadinessResponse).data;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
