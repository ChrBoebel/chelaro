"use client";

import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

const CONSENT_NOTICE =
  "Der Chelaro Finanzassistent sendet deine Chatnachrichten und nur die zur Beantwortung nötigen, strukturierten Finanzdaten an OpenAI. Dazu können Übersichten, Transaktionen, Forderungen, Zahlungsstatus und prüfpflichtige Änderungsvorschläge gehören. Originaldokumente, OCR-Inhalte, Bankzugänge und Ausführungsrechte werden nicht übertragen. Vorschläge ändern Finanzdaten erst nach deiner gesonderten Prüfung und Freigabe in Chelaro.";
const MAX_PROMPT_CHARACTERS = 16_000;
const MAX_ASSISTANT_MESSAGE_BYTES = 512 * 1024;

type HostStatus = "starting" | "ready" | "degraded" | "stopping" | "stopped";
type AppServerStatus = "stopped" | "starting" | "ready" | "stopping" | "crashed";
type ConsentStatus = "unknown" | "granted" | "revoke_pending" | "revoked";
type AuthStatus = "unknown" | "logged_out" | "authenticated";
type ProviderStatus = "checking" | "ready" | "not_found" | "unsupported" | "error";
type SessionStatus = "starting" | "ready" | "context_lost" | "closed";
type TurnStatus = "starting" | "running" | "interrupting" | "interrupted" | "completed" | "failed";

interface FinanceAssistantSnapshot {
  appServer: AppServerStatus;
  auth: AuthStatus;
  consent: { status: ConsentStatus; version: string | null };
  host: HostStatus;
  provider: { status: ProviderStatus; version: string | null };
  session: null | { id: string; status: SessionStatus };
  turn: null | { id: string; status: TurnStatus };
}

interface DisplayMessage {
  id: string;
  role: "assistant" | "user";
  status: "streaming" | "complete" | "failed";
  text: string;
}

interface ActiveStream {
  bytes: number[];
  messageId: string;
  nextSequence: number;
  sessionId: string;
  turnId: string;
}

export function FinanceAssistant() {
  const [snapshot, setSnapshotState] = useState<FinanceAssistantSnapshot | null>(null);
  const [availability, setAvailability] = useState<"loading" | "ready" | "unavailable">("loading");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [connectionInterrupted, setConnectionInterrupted] = useState(false);
  const snapshotRef = useRef<FinanceAssistantSnapshot | null>(null);
  const streamsRef = useRef(new Map<string, ActiveStream>());

  const setSnapshot = useCallback((next: FinanceAssistantSnapshot) => {
    if (next.turn && !isTurnActive(next.turn)) {
      for (const [key, stream] of streamsRef.current) {
        if (stream.turnId !== next.turn.id) continue;
        streamsRef.current.delete(key);
        failMessage(key, setMessages);
      }
    }
    snapshotRef.current = next;
    setSnapshotState(next);
  }, []);

  const applyEvent = useCallback((raw: string) => {
    let event: unknown;
    try {
      event = JSON.parse(raw);
    } catch {
      setNotice("Eine ungültige Assistenten-Nachricht wurde verworfen.");
      return;
    }
    if (!isRecord(event) || typeof event.type !== "string") return;
    if (event.type === "state.changed") {
      const next = parseSnapshot(event.snapshot);
      if (next && exactKeys(event, ["snapshot", "type"])) setSnapshot(next);
      return;
    }
    const activeSnapshot = snapshotRef.current;
    if (!activeSnapshot?.session || !activeSnapshot.turn) return;
    if (
      event.sessionId !== activeSnapshot.session.id ||
      event.turnId !== activeSnapshot.turn.id
    ) return;

    if (event.type === "assistant.message.started" && isStartedEvent(event)) {
      const key = streamKey(event.turnId, event.messageId);
      if (streamsRef.current.has(key)) return;
      streamsRef.current.set(key, {
        bytes: [],
        messageId: event.messageId,
        nextSequence: 0,
        sessionId: event.sessionId,
        turnId: event.turnId,
      });
      setMessages((current) => [
        ...current,
        { id: key, role: "assistant", status: "streaming", text: "" },
      ]);
      return;
    }
    if (event.type === "assistant.message.chunk" && isChunkEvent(event)) {
      const key = streamKey(event.turnId, event.messageId);
      const stream = streamsRef.current.get(key);
      if (!stream || stream.nextSequence !== event.sequence) return;
      const chunk = decodeBase64(event.dataBase64);
      if (
        !chunk ||
        chunk.byteLength !== event.rawBytes ||
        stream.bytes.length + chunk.byteLength > MAX_ASSISTANT_MESSAGE_BYTES
      ) {
        failMessage(key, setMessages);
        streamsRef.current.delete(key);
        return;
      }
      stream.nextSequence += 1;
      stream.bytes.push(...chunk);
      const text = new TextDecoder().decode(Uint8Array.from(stream.bytes));
      setMessages((current) => current.map((message) =>
        message.id === key ? { ...message, text } : message,
      ));
      return;
    }
    if (event.type === "assistant.message.completed" && isCompletedEvent(event)) {
      const key = streamKey(event.turnId, event.messageId);
      const stream = streamsRef.current.get(key);
      if (!stream || stream.bytes.length !== event.totalBytes) {
        failMessage(key, setMessages);
        return;
      }
      streamsRef.current.delete(key);
      void verifyDigest(Uint8Array.from(stream.bytes), event.sha256).then((valid) => {
        setMessages((current) => current.map((message) =>
          message.id === key
            ? { ...message, status: valid ? "complete" : "failed" }
            : message,
        ));
      });
    }
  }, [setSnapshot]);

  useEffect(() => {
    let disposed = false;
    let events: EventSource | undefined;
    void assistantRequest("/api/assistant/status", { method: "GET" })
      .then((body) => {
        const next = parseSnapshot(body.snapshot);
        if (!next) throw new Error("invalid_response");
        if (disposed) return;
        setSnapshot(next);
        setAvailability("ready");
        if (typeof EventSource === "undefined") return;
        events = new EventSource("/api/assistant/events");
        const receive = (event: MessageEvent<string>) => {
          setConnectionInterrupted(false);
          applyEvent(event.data);
        };
        events.addEventListener("finance", receive);
        events.addEventListener("reset", receive);
        events.onerror = () => setConnectionInterrupted(true);
      })
      .catch(() => {
        if (!disposed) setAvailability("unavailable");
      });
    return () => {
      disposed = true;
      events?.close();
    };
  }, [applyEvent, setSnapshot]);

  async function runAction(path: string, body: Record<string, unknown> = {}) {
    setIsWorking(true);
    setNotice(null);
    try {
      const response = await assistantRequest(path, {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const next = parseSnapshot(response.snapshot);
      if (next) setSnapshot(next);
      return response;
    } catch {
      setNotice("Die Aktion konnte nicht ausgeführt werden. Bitte versuche es erneut.");
      return null;
    } finally {
      setIsWorking(false);
    }
  }

  async function grantConsent() {
    await runAction("/api/assistant/consent/grant");
  }

  async function revokeConsent() {
    const response = await runAction("/api/assistant/consent/revoke");
    if (response) {
      streamsRef.current.clear();
      setMessages([]);
    }
  }

  async function createSession() {
    streamsRef.current.clear();
    setMessages([]);
    await runAction("/api/assistant/sessions", { session_id: resourceId("session") });
  }

  async function closeSession() {
    const sessionId = snapshotRef.current?.session?.id;
    if (!sessionId) return;
    setIsWorking(true);
    setNotice(null);
    try {
      const response = await assistantRequest(
        `/api/assistant/sessions/${encodeURIComponent(sessionId)}`,
        { method: "DELETE" },
      );
      const next = parseSnapshot(response.snapshot);
      if (!next) throw new Error("invalid_response");
      setSnapshot(next);
    } catch {
      setNotice("Die Unterhaltung konnte nicht beendet werden.");
    } finally {
      setIsWorking(false);
    }
  }

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const promptField = form.elements.namedItem("prompt");
    if (!(promptField instanceof HTMLTextAreaElement)) return;
    const prompt = promptField.value.trim();
    const active = snapshotRef.current;
    if (
      !prompt ||
      isWorking ||
      !active?.session ||
      active.session.status !== "ready" ||
      isTurnActive(active.turn)
    ) return;
    const turnId = resourceId("turn");
    setMessages((current) => [
      ...current,
      { id: `user:${turnId}`, role: "user", status: "complete", text: prompt },
    ]);
    promptField.value = "";
    await runAction("/api/assistant/turns", {
      prompt,
      session_id: active.session.id,
      turn_id: turnId,
    });
  }

  if (availability === "loading") return <AssistantLoading />;
  if (availability === "unavailable" || !snapshot) return <AssistantUnavailable />;

  const activeTurn = isTurnActive(snapshot.turn);
  const sessionReady = snapshot.session?.status === "ready";

  return (
    <section className="pt-8 sm:pt-12" aria-labelledby="assistant-title">
      <PageHeader
        titleId="assistant-title"
        eyebrow="Chelaro KI"
        title="Frag deine Finanzen."
        description="Verstehe Einnahmen, Ausgaben und offene Beträge. Änderungen werden immer erst als prüfbarer Vorschlag angelegt."
        actions={snapshot.consent.status === "granted" ? (
          <AssistantControls
            activeTurn={activeTurn}
            hasLiveSession={Boolean(snapshot.session && snapshot.session.status !== "closed")}
            consentGranted={snapshot.consent.status === "granted"}
            onCloseSession={() => void closeSession()}
            onRevoke={() => void revokeConsent()}
            working={isWorking}
          />
        ) : undefined}
      />

      <div className="mt-6 min-h-5" aria-live="polite">
        {connectionInterrupted ? (
          <p className="text-sm text-danger">Verbindung unterbrochen – die Wiederverbindung läuft.</p>
        ) : notice ? (
          <p className="text-sm text-danger">{notice}</p>
        ) : null}
      </div>

      {snapshot.consent.status !== "granted" ? (
        <ConsentPanel
          pending={snapshot.consent.status === "revoke_pending" || isWorking}
          onGrant={() => void grantConsent()}
        />
      ) : snapshot.provider.status !== "ready" || snapshot.auth !== "authenticated" ? (
        <ProviderPanel
          disabled={isWorking}
          provider={snapshot.provider}
          authenticated={snapshot.auth === "authenticated"}
          onRefresh={() => void runAction("/api/assistant/provider/refresh")}
        />
      ) : !sessionReady ? (
        <SessionPanel
          disabled={isWorking || snapshot.session?.status === "starting"}
          contextLost={snapshot.session?.status === "context_lost"}
          onStart={() => void createSession()}
        />
      ) : (
        <ChatPanel
          activeTurn={activeTurn}
          working={isWorking}
          messages={messages}
          onInterrupt={() => void runAction("/api/assistant/turns/interrupt")}
          onSubmit={submitPrompt}
        />
      )}
    </section>
  );
}

function ConsentPanel({ pending, onGrant }: { pending: boolean; onGrant: () => void }) {
  return (
    <div className="mt-5 grid overflow-hidden rounded-panel border border-line bg-paper shadow-panel lg:grid-cols-[1.25fr_0.75fr]">
      <div className="p-6 sm:p-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">Datenfreigabe</p>
        <h2 className="mt-3 text-2xl font-medium tracking-[-0.035em] text-ink">Du entscheidest, was geteilt wird.</h2>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-muted">{CONSENT_NOTICE}</p>
        <Button
          size="regular"
          className="mt-7"
          disabled={pending}
          onClick={onGrant}
        >
          {pending ? "Freigabe wird verarbeitet …" : "Zustimmen und fortfahren"}
        </Button>
      </div>
      <aside className="border-t border-line bg-surface/55 p-6 sm:p-8 lg:border-t-0 lg:border-l" aria-label="Grenzen des Finanzassistenten">
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

function ProviderPanel({
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
  const title = provider.status === "not_found"
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
  return (
    <div className="mt-5 rounded-panel border border-line bg-paper p-6 shadow-panel sm:p-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">Lokale Codex CLI</p>
      <h2 className="mt-3 text-2xl font-medium tracking-[-0.035em] text-ink">{title}</h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
        {provider.status === "not_found"
          ? "Installiere die Codex CLI. Deine übrigen Finanzfunktionen bleiben nutzbar."
          : provider.status === "unsupported"
            ? `Installiert ist ${provider.version ?? "eine unbekannte Version"}; Chelaro benötigt die geprüfte Version 0.151.0.`
            : "Chelaro verwendet dieselbe lokale Anmeldung wie deine Codex CLI. Führe bei Bedarf im Terminal codex login aus; Chelaro liest oder kopiert keine Anmeldedatei."}
      </p>
      {provider.status === "ready" && !authenticated ? (
        <code className="mt-5 block w-fit rounded-lg bg-surface px-4 py-3 font-mono text-sm text-ink">codex login</code>
      ) : null}
      <Button size="regular" className="mt-6" disabled={disabled} onClick={onRefresh}>
        {disabled ? "Status wird geprüft …" : "Status erneut prüfen"}
      </Button>
    </div>
  );
}

function SessionPanel({
  contextLost,
  disabled,
  onStart,
}: {
  contextLost: boolean;
  disabled: boolean;
  onStart: () => void;
}) {
  return (
    <div className="mt-5 rounded-panel border border-line bg-paper p-6 shadow-panel sm:p-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">Bereit</p>
      <h2 className="mt-3 text-2xl font-medium tracking-[-0.035em] text-ink">
        {contextLost ? "Der alte Kontext ist nicht mehr verfügbar." : "Beginne eine private Unterhaltung."}
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
        Frage zum Beispiel nach deinem Monatssaldo, ungewöhnlichen Ausgaben oder überfälligen Forderungen.
      </p>
      <Button
        size="regular"
        className="mt-6"
        disabled={disabled}
        onClick={onStart}
      >
        {disabled ? "Unterhaltung wird vorbereitet …" : "Neue Unterhaltung"}
      </Button>
    </div>
  );
}

function ChatPanel({
  activeTurn,
  messages,
  onInterrupt,
  onSubmit,
  working,
}: {
  activeTurn: boolean;
  messages: DisplayMessage[];
  onInterrupt: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  working: boolean;
}) {
  return (
    <div className="mt-5 overflow-hidden rounded-panel border border-line bg-paper shadow-panel">
      <div className="min-h-[360px] max-h-[58vh] overflow-y-auto p-5 sm:p-7" aria-live="polite" aria-label="Unterhaltung mit dem Finanzassistenten">
        {messages.length === 0 ? (
          <div className="mx-auto flex min-h-[310px] max-w-2xl flex-col items-center justify-center text-center">
            <span className="grid size-11 place-items-center rounded-full bg-accent/10 text-xl text-accent" aria-hidden="true">◇</span>
            <h2 className="mt-4 text-xl font-medium tracking-[-0.03em] text-ink">Wobei darf ich dir helfen?</h2>
            <p className="mt-2 text-sm leading-6 text-muted">Ich kann deine strukturierten Finanzdaten lesen und Änderungen nur zur Prüfung vorschlagen.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 text-xs text-muted">
              <span className="rounded-full border border-line px-3 py-2">Wie war mein Monat?</span>
              <span className="rounded-full border border-line px-3 py-2">Was ist noch offen?</span>
              <span className="rounded-full border border-line px-3 py-2">Wo gebe ich mehr aus?</span>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.map((message) => (
              <article
                key={message.id}
                className={message.role === "user"
                  ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-3 text-sm leading-6 text-paper"
                  : "mr-auto max-w-[92%] rounded-2xl rounded-bl-md bg-surface px-4 py-3 text-sm leading-6 text-foreground"}
              >
                <p className="whitespace-pre-wrap break-words">{message.text || "…"}</p>
                {message.status === "failed" ? (
                  <p className="mt-2 text-xs text-danger">Diese Antwort war unvollständig und wurde verworfen.</p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
      <form className="border-t border-line bg-surface/45 p-4 sm:p-5" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="finance-assistant-prompt">Frage an den Finanzassistenten</label>
        <div className="flex items-end gap-3 rounded-xl border border-line bg-paper p-2 focus-within:border-accent/60">
          <textarea
            id="finance-assistant-prompt"
            name="prompt"
            rows={2}
            maxLength={MAX_PROMPT_CHARACTERS}
            disabled={activeTurn || working}
            className="min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed"
            placeholder={activeTurn || working ? "Antwort wird vorbereitet …" : "Frage zu deinen Finanzen …"}
          />
          {activeTurn ? (
            <Button
              variant="danger"
              size="regular"
              onClick={onInterrupt}
            >
              Stoppen
            </Button>
          ) : (
            <Button
              type="submit"
              size="regular"
              disabled={working}
            >
              {working ? "Wird gesendet …" : "Senden"}
            </Button>
          )}
        </div>
        <p className="mt-2 text-center text-[11px] text-muted">Finanzänderungen bleiben Vorschläge, bis du sie in Chelaro prüfst und freigibst.</p>
      </form>
    </div>
  );
}

function AssistantControls({
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
    <div className="flex flex-wrap gap-2">
      {hasLiveSession ? (
        <Button variant="secondary" disabled={working || activeTurn} onClick={onCloseSession}>
          Unterhaltung beenden
        </Button>
      ) : null}
      <Button variant="danger" disabled={working} onClick={onRevoke}>
        Datenfreigabe widerrufen
      </Button>
    </div>
  );
}

function AssistantLoading() {
  return <section className="pt-12" aria-label="Finanzassistent wird geladen"><div className="h-72 animate-pulse rounded-panel border border-line bg-surface" /></section>;
}

function AssistantUnavailable() {
  return (
    <section className="pt-12" aria-labelledby="assistant-unavailable-title">
      <PageHeader
        titleId="assistant-unavailable-title"
        eyebrow="Chelaro KI"
        title="Finanzassistent nicht verfügbar."
        description="Deine übrigen Finanzfunktionen bleiben vollständig nutzbar. Starte Chelaro neu, um den lokalen Assistentendienst erneut zu laden."
      />
    </section>
  );
}

async function assistantRequest(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok || !isRecord(body)) throw new Error("assistant_request_failed");
  return body;
}

function parseSnapshot(value: unknown): FinanceAssistantSnapshot | null {
  if (!isRecord(value) || !exactKeys(value, ["appServer", "auth", "consent", "host", "provider", "session", "turn"])) return null;
  if (
    !isOneOf(value.host, ["starting", "ready", "degraded", "stopping", "stopped"]) ||
    !isOneOf(value.appServer, ["stopped", "starting", "ready", "stopping", "crashed"]) ||
    !isOneOf(value.auth, ["unknown", "logged_out", "authenticated"]) ||
    !isRecord(value.consent) ||
    !exactKeys(value.consent, ["status", "version"]) ||
    !isOneOf(value.consent.status, ["unknown", "granted", "revoke_pending", "revoked"]) ||
    !(value.consent.version === null || typeof value.consent.version === "string") ||
    !isRecord(value.provider) ||
    !exactKeys(value.provider, ["status", "version"]) ||
    !isOneOf(value.provider.status, ["checking", "ready", "not_found", "unsupported", "error"]) ||
    !(value.provider.version === null || typeof value.provider.version === "string") ||
    !validSession(value.session) ||
    !validTurn(value.turn)
  ) return null;
  return value as unknown as FinanceAssistantSnapshot;
}

function validSession(value: unknown): boolean {
  return value === null || (
    isRecord(value) &&
    exactKeys(value, ["id", "status"]) &&
    validResourceId(value.id) &&
    isOneOf(value.status, ["starting", "ready", "context_lost", "closed"])
  );
}

function validTurn(value: unknown): boolean {
  return value === null || (
    isRecord(value) &&
    exactKeys(value, ["id", "status"]) &&
    validResourceId(value.id) &&
    isOneOf(value.status, ["starting", "running", "interrupting", "interrupted", "completed", "failed"])
  );
}

function isStartedEvent(value: Record<string, unknown>): value is Record<string, unknown> & {
  messageId: string; sessionId: string; turnId: string; type: "assistant.message.started";
} {
  return exactKeys(value, ["messageId", "sessionId", "turnId", "type"]) &&
    validResourceId(value.messageId) && validResourceId(value.sessionId) && validResourceId(value.turnId);
}

function isChunkEvent(value: Record<string, unknown>): value is Record<string, unknown> & {
  dataBase64: string; messageId: string; rawBytes: number; sequence: number; sessionId: string; turnId: string; type: "assistant.message.chunk";
} {
  return exactKeys(value, ["dataBase64", "messageId", "rawBytes", "sequence", "sessionId", "turnId", "type"]) &&
    typeof value.dataBase64 === "string" && value.dataBase64.length <= 48 * 1024 &&
    validResourceId(value.messageId) && validResourceId(value.sessionId) && validResourceId(value.turnId) &&
    Number.isSafeInteger(value.rawBytes) && Number(value.rawBytes) >= 1 && Number(value.rawBytes) <= 32 * 1024 &&
    Number.isSafeInteger(value.sequence) && Number(value.sequence) >= 0;
}

function isCompletedEvent(value: Record<string, unknown>): value is Record<string, unknown> & {
  messageId: string; sessionId: string; sha256: string; totalBytes: number; turnId: string; type: "assistant.message.completed";
} {
  return exactKeys(value, ["messageId", "sessionId", "sha256", "totalBytes", "turnId", "type"]) &&
    validResourceId(value.messageId) && validResourceId(value.sessionId) && validResourceId(value.turnId) &&
    typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256) &&
    Number.isSafeInteger(value.totalBytes) && Number(value.totalBytes) >= 0 && Number(value.totalBytes) <= MAX_ASSISTANT_MESSAGE_BYTES;
}

function isTurnActive(turn: FinanceAssistantSnapshot["turn"]): boolean {
  return Boolean(turn && ["starting", "running", "interrupting"].includes(turn.status));
}

function resourceId(prefix: "session" | "turn"): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function validResourceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function streamKey(turnId: string, messageId: string): string {
  return `${turnId}:${messageId}`;
}

function decodeBase64(value: string): Uint8Array | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function verifyDigest(bytes: Uint8Array, expected: string): Promise<boolean> {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
    return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("") === expected;
  } catch {
    return false;
  }
}

function failMessage(
  key: string,
  setMessages: Dispatch<SetStateAction<DisplayMessage[]>>,
) {
  setMessages((current) => current.map((message) =>
    message.id === key ? { ...message, status: "failed", text: "" } : message,
  ));
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
