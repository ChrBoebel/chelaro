import { AssistantMessage } from "@/components/assistant-message";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import {
  describeSupportedVersions,
  type FinanceAssistantSnapshot,
  type DisplayMessage,
} from "@/lib/finance-assistant-client";

const CONSENT_NOTICE =
  "Der Chelaro Finanzassistent sendet deine Chatnachrichten und nur die zur Beantwortung nötigen, strukturierten Finanzdaten an OpenAI. Dazu können Übersichten, Transaktionen, Forderungen, Zahlungsstatus und prüfpflichtige Änderungsvorschläge gehören. Originaldokumente, OCR-Inhalte, Bankzugänge und Ausführungsrechte werden nicht übertragen. Vorschläge ändern Finanzdaten erst nach deiner gesonderten Prüfung und Freigabe in Chelaro. Vollständige sichtbare Unterhaltungen bleiben lokal auf diesem Mac gespeichert und werden über deine vorhandene Codex-Installation fortgesetzt, bis du sie löschst. Ein Widerruf stoppt neue Übertragungen, löscht vorhandene lokale Unterhaltungen aber nicht automatisch.";
export function ConsentPanel({
  pending,
  onGrant,
}: {
  pending: boolean;
  onGrant: () => void;
}) {
  return (
    <div className="mt-5 grid overflow-hidden rounded-panel border border-line bg-paper shadow-panel lg:grid-cols-[1.25fr_0.75fr]">
      <div className="p-6 sm:p-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
          Datenfreigabe
        </p>
        <h2 className="mt-3 text-2xl font-medium tracking-[-0.035em] text-ink">
          Du entscheidest, was geteilt wird.
        </h2>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-muted">
          {CONSENT_NOTICE}
        </p>
        <Button
          size="regular"
          className="mt-7"
          disabled={pending}
          onClick={onGrant}
        >
          {pending ? "Freigabe wird verarbeitet …" : "Zustimmen und fortfahren"}
        </Button>
      </div>
      <aside
        className="border-t border-line bg-surface/55 p-6 sm:p-8 lg:border-t-0 lg:border-l"
        aria-label="Grenzen des Finanzassistenten"
      >
        <p className="text-xs font-semibold text-ink">Nie automatisch</p>
        <ul className="mt-4 space-y-3 text-sm leading-6 text-muted">
          <li>Keine Originaldokumente oder Bankzugänge</li>
          <li>Keine Zahlungen oder Ausführungsrechte</li>
          <li>Keine Änderung ohne deine Prüfung</li>
        </ul>
      </aside>
    </div>
  );
}

export function ProviderPanel({
  authenticated,
  disabled,
  onRefresh,
  provider,
}: {
  authenticated: boolean;
  disabled: boolean;
  onRefresh: () => void;
  provider: FinanceAssistantSnapshot["provider"];
}) {
  const title =
    provider.status === "not_found"
      ? "Codex wurde nicht gefunden"
      : provider.status === "unsupported"
        ? "Codex-Version wird nicht unterstützt"
        : provider.status === "error"
          ? "Codex konnte nicht gestartet werden"
          : provider.status === "checking"
            ? "Codex wird geprüft"
            : authenticated
              ? "Codex ist bereit"
              : "Codex-Anmeldung erforderlich";
  // The version the message names comes from the running host, not from a
  // literal in this file, so it stays true across a Codex upgrade.
  const newestSupported = provider.supportedVersions[0];
  const supportedList = describeSupportedVersions(provider.supportedVersions);
  const command =
    provider.status === "not_found" || provider.status === "unsupported"
      ? newestSupported === undefined
        ? null
        : `npm install -g @openai/codex@${newestSupported}`
      : provider.status === "ready" && !authenticated
        ? "codex login"
        : null;
  return (
    <div className="mt-5 rounded-panel border border-line bg-paper p-6 shadow-panel sm:p-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
        Lokale Codex CLI
      </p>
      <h2 className="mt-3 text-2xl font-medium tracking-[-0.035em] text-ink">
        {title}
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
        {provider.status === "not_found"
          ? `Installiere ${supportedList}. Deine übrigen Finanzfunktionen bleiben nutzbar.`
          : provider.status === "unsupported"
            ? `Installiert ist ${provider.version ?? "eine unbekannte Version"}; Chelaro benötigt ${supportedList}. Deine Zustimmung und deine gespeicherten Unterhaltungen bleiben erhalten.`
            : provider.status === "error"
              ? "Die installierte Codex CLI hat nicht geantwortet. Prüfe im Terminal, ob codex --version läuft."
              : "Chelaro verwendet dieselbe lokale Anmeldung wie deine Codex CLI. Führe bei Bedarf im Terminal codex login aus; Chelaro liest oder kopiert keine Anmeldedatei."}
      </p>
      {command === null ? null : (
        <code className="mt-5 block w-fit rounded-lg bg-surface px-4 py-3 font-mono text-sm text-ink">
          {command}
        </code>
      )}
      <Button
        size="regular"
        className="mt-6"
        disabled={disabled}
        onClick={onRefresh}
      >
        {disabled ? "Status wird geprüft …" : "Status erneut prüfen"}
      </Button>
    </div>
  );
}

export function ArchivedConversationNotice() {
  return (
    <div className="rounded-panel border border-line bg-paper p-5 shadow-panel">
      <p className="text-sm font-medium text-ink">
        Diese Unterhaltung ist archiviert.
      </p>
      <p className="mt-2 text-sm leading-6 text-muted">
        Du kannst sie weiterhin lokal lesen. Stelle sie links wieder her, um sie
        fortzusetzen.
      </p>
    </div>
  );
}

export function StoredMessagesPanel({
  hasOlderMessages,
  loading,
  messages,
  onLoadOlder,
}: {
  hasOlderMessages: boolean;
  loading: boolean;
  messages: DisplayMessage[];
  onLoadOlder: () => void;
}) {
  return (
    <div
      className="max-h-[58vh] overflow-y-auto rounded-panel border border-line bg-paper p-5 shadow-panel"
      aria-label="Lokal gespeicherte Unterhaltung"
    >
      <p className="mb-4 text-xs text-muted">
        Dieser Verlauf ist lokal lesbar. Zum Fortsetzen muss Codex verfügbar
        sein.
      </p>
      {hasOlderMessages ? (
        <button
          className="mb-4 text-xs font-medium text-accent"
          disabled={loading}
          onClick={onLoadOlder}
          type="button"
        >
          {loading ? "Wird geladen …" : "Ältere Nachrichten laden"}
        </button>
      ) : null}
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {messages.map((message) => (
          <article
            key={message.id}
            className={`assistant-message assistant-message-${message.role}`}
          >
            {message.status === "failed" ? (
              <p className="text-danger">
                Diese Antwort war unvollständig und wurde verworfen.
              </p>
            ) : message.role === "assistant" ? (
              <AssistantMessage text={message.text} />
            ) : (
              <p className="whitespace-pre-wrap break-words">{message.text}</p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

export function AssistantControls({
  activeTurn,
  consentGranted,
  hasLiveSession,
  onCloseSession,
  onRevoke,
  working,
}: {
  activeTurn: boolean;
  consentGranted: boolean;
  hasLiveSession: boolean;
  onCloseSession: () => void;
  onRevoke: () => void;
  working: boolean;
}) {
  if (!consentGranted) return null;
  return (
    <div className="assistant-options-menu">
      {hasLiveSession ? (
        <Button
          variant="secondary"
          disabled={working || activeTurn}
          onClick={onCloseSession}
        >
          Unterhaltung beenden
        </Button>
      ) : null}
      <Button variant="danger" disabled={working} onClick={onRevoke}>
        Datenfreigabe widerrufen
      </Button>
    </div>
  );
}

export function AssistantLoading() {
  return (
    <section className="pt-12" aria-label="Finanzassistent wird geladen">
      <div className="h-72 animate-pulse rounded-panel border border-line bg-surface" />
    </section>
  );
}

export function AssistantUnavailable({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <section
      className={
        compact
          ? "rounded-panel border border-line bg-paper p-6 shadow-panel"
          : "pt-12"
      }
      aria-labelledby="assistant-unavailable-title"
    >
      <PageHeader
        titleId="assistant-unavailable-title"
        eyebrow="Chelaro KI"
        title="Finanzassistent nicht verfügbar."
        description="Deine übrigen Finanzfunktionen bleiben vollständig nutzbar. Starte Chelaro neu, um den lokalen Assistentendienst erneut zu laden."
      />
    </section>
  );
}
