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
  "Der Chelaro Finanzassistent sendet deine Chatnachrichten und nur die zur Beantwortung nötigen, strukturierten Finanzdaten an OpenAI. Dazu können Übersichten, Transaktionen, Forderungen, Zahlungsstatus und prüfpflichtige Änderungsvorschläge gehören. Originaldokumente, OCR-Inhalte, Bankzugänge und Ausführungsrechte werden nicht übertragen. Vorschläge ändern Finanzdaten erst nach deiner gesonderten Prüfung und Freigabe in Chelaro. Vollständige sichtbare Unterhaltungen bleiben lokal auf diesem Mac gespeichert und werden über deine vorhandene Codex-Installation fortgesetzt, bis du sie löschst. Ein Widerruf stoppt neue Übertragungen, löscht vorhandene lokale Unterhaltungen aber nicht automatisch.";
const MAX_PROMPT_CHARACTERS = 16_000;
const MAX_ASSISTANT_MESSAGE_BYTES = 512 * 1024;

type HostStatus = "starting" | "ready" | "degraded" | "stopping" | "stopped";
type AppServerStatus = "stopped" | "starting" | "ready" | "stopping" | "crashed";
type ConsentStatus = "unknown" | "granted" | "revoke_pending" | "revoked";
type AuthStatus = "unknown" | "logged_out" | "authenticated";
type ProviderStatus = "checking" | "ready" | "not_found" | "unsupported" | "error";
type SessionStatus = "starting" | "ready" | "context_lost" | "closed";
type TurnStatus = "starting" | "running" | "interrupting" | "interrupted" | "completed" | "failed";

type ModelEffort = "low" | "medium" | "high";

interface ModelSelection {
  effort: ModelEffort;
  fastMode: boolean;
  model: string;
}

interface CatalogModel {
  efforts: ModelEffort[];
  model: string;
  supportsFastMode: boolean;
}

interface ThreadUsage {
  compactions: number;
  contextWindow: number | null;
  totalTokens: number;
  usedTokens: number;
}

interface FinanceAssistantSnapshot {
  appServer: AppServerStatus;
  auth: AuthStatus;
  consent: { status: ConsentStatus; version: string | null };
  host: HostStatus;
  models: { available: CatalogModel[]; selected: ModelSelection };
  provider: { status: ProviderStatus; version: string | null };
  session: null | { conversationId: string | null; id: string; status: SessionStatus };
  turn: null | { id: string; status: TurnStatus };
  usage: ThreadUsage | null;
}

interface ConversationSummary {
  id: string;
  version: number;
  title: string;
  status: "active" | "archived";
  message_count: number;
  updated_at: string;
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
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyStatus, setHistoryStatus] = useState<"active" | "archived">("active");
  const [nextBeforeSequence, setNextBeforeSequence] = useState<number | null>(null);
  // Replaced by the host's verified default as soon as the first snapshot
  // arrives; this only avoids an empty picker on the very first render.
  const [draftSelection, setDraftSelection] = useState<ModelSelection>({
    effort: "medium",
    fastMode: false,
    model: "gpt-5.6-luna",
  });
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
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
    // Adopt the host's verified configuration while no session holds one, so
    // the picker shows what a new conversation would actually run on.
    if (!next.session || next.session.status === "closed") {
      setDraftSelection(next.models.selected);
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
      if (next && exactKeys(event, ["snapshot", "type"])) {
        setSnapshot(next);
        if (next.turn && !isTurnActive(next.turn)) {
          void loadConversationList().then(setConversations).catch(() => undefined);
        }
      }
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
    void loadConversationList()
      .then((items) => {
        if (disposed) return;
        setConversations(items);
        const first = items[0];
        if (first) {
          setActiveConversationId(first.id);
          void loadMessages(first.id).then((stored) => {
            if (!disposed) {
              setMessages(stored.messages);
              setNextBeforeSequence(stored.nextBeforeSequence);
            }
          });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) setHistoryLoading(false);
      });
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
    } catch (error) {
      setNotice(describeAssistantError(error));
      return null;
    } finally {
      setIsWorking(false);
    }
  }

  async function grantConsent() {
    await runAction("/api/assistant/consent/grant");
  }

  async function revokeConsent() {
    await runAction("/api/assistant/consent/revoke");
  }

  async function createSession(conversationId?: string) {
    const currentSession = snapshotRef.current?.session;
    if (currentSession && currentSession.status !== "closed") {
      if (conversationId && currentSession.conversationId === conversationId &&
        currentSession.status === "ready") return;
      await closeSession();
      if (snapshotRef.current?.session?.status !== "closed") return;
    }
    streamsRef.current.clear();
    let selectedId = conversationId;
    if (!selectedId) {
      let created: Record<string, unknown>;
      try {
        created = await historyMutation("/api/assistant/conversations", "POST", {});
      } catch (error) {
        setNotice(describeAssistantError(error));
        return;
      }
      const summary = parseConversation(created.data);
      if (!summary) {
        setNotice("Die neue Unterhaltung konnte nicht lokal angelegt werden.");
        return;
      }
      selectedId = summary.id;
      setHistoryStatus("active");
      setConversations([summary]);
      void loadConversationList().then(setConversations).catch(() => undefined);
      setActiveConversationId(summary.id);
      setMessages([]);
      setNextBeforeSequence(null);
    }
    await runAction("/api/assistant/sessions", {
      conversation_id: selectedId,
      model_selection: {
        effort: draftSelection.effort,
        fast_mode: draftSelection.fastMode,
        model: draftSelection.model,
      },
      session_id: resourceId("session"),
    });
  }

  async function selectConversation(conversationId: string) {
    setActiveConversationId(conversationId);
    setHistoryLoading(true);
    setNotice(null);
    try {
      const stored = await loadMessages(conversationId);
      setMessages(stored.messages);
      setNextBeforeSequence(stored.nextBeforeSequence);
    } catch {
      setNotice("Die gespeicherte Unterhaltung konnte nicht geladen werden.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadOlderMessages() {
    if (!activeConversationId || nextBeforeSequence === null || historyLoading) return;
    setHistoryLoading(true);
    try {
      const stored = await loadMessages(activeConversationId, nextBeforeSequence);
      setMessages((current) => [...stored.messages, ...current]);
      setNextBeforeSequence(stored.nextBeforeSequence);
    } catch {
      setNotice("Ältere Nachrichten konnten nicht geladen werden.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function setConversationStatus(
    conversation: ConversationSummary,
    status: "active" | "archived",
  ) {
    if (hasLiveSessionFor(conversation.id)) {
      await closeSession();
      if (hasLiveSessionFor(conversation.id)) return;
    }
    let response: Record<string, unknown>;
    try {
      response = await historyMutation(
        `/api/assistant/conversations/${encodeURIComponent(conversation.id)}`,
        "PATCH",
        { expected_version: conversation.version, status },
      );
    } catch (error) {
      setNotice(describeAssistantError(error));
      return;
    }
    const updated = parseConversation(response.data);
    if (!updated) return;
    setConversations((current) => current.filter(({ id }) => id !== updated.id));
    if (activeConversationId === updated.id) {
      setActiveConversationId(null);
      setMessages([]);
      setNextBeforeSequence(null);
    }
  }

  async function showHistoryStatus(status: "active" | "archived") {
    setHistoryStatus(status);
    setHistoryLoading(true);
    setActiveConversationId(null);
    setMessages([]);
    setNextBeforeSequence(null);
    try {
      setConversations(await loadConversationList(status));
    } catch {
      setNotice("Die Unterhaltungsliste konnte nicht geladen werden.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function deleteConversation(conversationId: string) {
    if (hasLiveSessionFor(conversationId)) {
      await closeSession();
      if (hasLiveSessionFor(conversationId)) return;
    }
    const provider = await fetch(
      `/api/assistant/provider-conversations/${encodeURIComponent(conversationId)}`,
      { method: "DELETE" },
    );
    if (!provider.ok) {
      setNotice("Der zugehörige Codex-Verlauf konnte nicht gelöscht werden. Es wurde nichts entfernt.");
      return;
    }
    const response = await fetch(
      `/api/assistant/conversations/${encodeURIComponent(conversationId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      setNotice("Die lokale Unterhaltung konnte nicht gelöscht werden.");
      return;
    }
    setConversations((current) => current.filter(({ id }) => id !== conversationId));
    if (activeConversationId === conversationId) {
      setActiveConversationId(null);
      setMessages([]);
      setNextBeforeSequence(null);
    }
  }

  function hasLiveSessionFor(conversationId: string): boolean {
    const session = snapshotRef.current?.session;
    return Boolean(
      session && session.conversationId === conversationId && session.status !== "closed",
    );
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
    } catch (error) {
      setNotice(describeAssistantError(error));
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
    if (!prompt) return;
    promptField.value = "";
    await sendPrompt(prompt);
  }

  async function sendPrompt(prompt: string) {
    const active = snapshotRef.current;
    if (
      isWorking ||
      !active?.session ||
      active.session.status !== "ready" ||
      isTurnActive(active.turn)
    ) return;
    const turnId = resourceId("turn");
    setLastPrompt(prompt);
    setMessages((current) => [
      ...current,
      { id: `user:${turnId}`, role: "user", status: "complete", text: prompt },
    ]);
    const response = await runAction("/api/assistant/turns", {
      prompt,
      session_id: active.session.id,
      turn_id: turnId,
    });
    if (response) void loadConversationList().then(setConversations).catch(() => undefined);
  }

  if (availability === "loading" && historyLoading) return <AssistantLoading />;

  const activeTurn = isTurnActive(snapshot?.turn ?? null);
  // Offering a retry only makes sense while the last attempt visibly failed and
  // nothing else is running; anything else would resend a question twice.
  const retryPrompt = !activeTurn && !isWorking && lastPrompt !== null && (
    snapshot?.turn?.status === "failed" ||
    snapshot?.turn?.status === "interrupted" ||
    messages.at(-1)?.status === "failed"
  ) ? lastPrompt : null;
  const selectedConversation = conversations.find(({ id }) => id === activeConversationId);
  const selectedConversationArchived = selectedConversation?.status === "archived";
  const sessionReady = snapshot?.session?.status === "ready" &&
    (snapshot.session.conversationId === null || snapshot.session.conversationId === activeConversationId);
  const storedHistory = activeConversationId ? (
    <StoredMessagesPanel
      hasOlderMessages={nextBeforeSequence !== null}
      loading={historyLoading}
      messages={messages}
      onLoadOlder={() => void loadOlderMessages()}
    />
  ) : null;

  return (
    <section className="pt-8 sm:pt-12" aria-labelledby="assistant-title">
      <PageHeader
        titleId="assistant-title"
        eyebrow="Chelaro KI"
        title="Frag deine Finanzen."
        description="Verstehe Einnahmen, Ausgaben und offene Beträge. Änderungen werden immer erst als prüfbarer Vorschlag angelegt."
        actions={snapshot?.consent.status === "granted" ? (
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

      <div className="mt-5 grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        <HistorySidebar
          activeId={activeConversationId}
          conversations={conversations}
          historyStatus={historyStatus}
          interactionDisabled={isWorking || activeTurn}
          loading={historyLoading}
          onSetStatus={(conversation, status) => void setConversationStatus(conversation, status)}
          onDelete={(conversationId) => void deleteConversation(conversationId)}
          onNew={() => void createSession()}
          onSelect={(conversationId) => void selectConversation(conversationId)}
          onShowStatus={(status) => void showHistoryStatus(status)}
          newDisabled={isWorking || activeTurn || snapshot?.auth !== "authenticated" || snapshot?.consent.status !== "granted"}
        />
        <div className="min-w-0">
      {availability === "unavailable" || !snapshot ? (
        <div className="space-y-4">
          <AssistantUnavailable compact />
          {storedHistory}
        </div>
      ) : snapshot.consent.status !== "granted" ? (
        <div className="space-y-4">
          <ConsentPanel
            pending={snapshot.consent.status === "revoke_pending" || isWorking}
            onGrant={() => void grantConsent()}
          />
          {storedHistory}
        </div>
      ) : snapshot.provider.status !== "ready" || snapshot.auth !== "authenticated" ? (
        <div className="space-y-4">
          <ProviderPanel
            disabled={isWorking}
            provider={snapshot.provider}
            authenticated={snapshot.auth === "authenticated"}
            onRefresh={() => void runAction("/api/assistant/provider/refresh")}
          />
          {storedHistory}
        </div>
      ) : selectedConversationArchived ? (
        <div className="space-y-4">
          <ArchivedConversationNotice />
          {storedHistory}
        </div>
      ) : !sessionReady ? (
        <div className="space-y-4">
          <SessionPanel
            available={snapshot.models.available}
            disabled={isWorking || snapshot.session?.status === "starting"}
            contextLost={snapshot.session?.status === "context_lost"}
            hasHistory={activeConversationId !== null}
            onSelectionChange={setDraftSelection}
            onStart={() => void createSession(activeConversationId ?? undefined)}
            selection={draftSelection}
          />
          {storedHistory}
        </div>
      ) : (
        <ChatPanel
          activeTurn={activeTurn}
          working={isWorking}
          messages={messages}
          hasOlderMessages={nextBeforeSequence !== null}
          historyLoading={historyLoading}
          onLoadOlder={() => void loadOlderMessages()}
          onInterrupt={() => void runAction("/api/assistant/turns/interrupt")}
          onReconfigure={() => void closeSession()}
          onRetry={retryPrompt === null ? undefined : () => void sendPrompt(retryPrompt)}
          onSubmit={submitPrompt}
          selection={snapshot.models.selected}
          usage={snapshot.usage}
        />
      )}
        </div>
      </div>
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
  available,
  contextLost,
  disabled,
  hasHistory,
  onSelectionChange,
  onStart,
  selection,
}: {
  available: CatalogModel[];
  contextLost: boolean;
  disabled: boolean;
  hasHistory: boolean;
  onSelectionChange: (selection: ModelSelection) => void;
  onStart: () => void;
  selection: ModelSelection;
}) {
  const active = available.find((entry) => entry.model === selection.model);
  const efforts = active?.efforts ?? ["low", "medium", "high"];
  return (
    <div className="mt-5 rounded-panel border border-line bg-paper p-6 shadow-panel sm:p-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">Bereit</p>
      <h2 className="mt-3 text-2xl font-medium tracking-[-0.035em] text-ink">
        {contextLost
          ? "Der Codex-Kontext konnte nicht wiederaufgenommen werden."
          : hasHistory
            ? "Setze diese Unterhaltung fort."
            : "Beginne eine private Unterhaltung."}
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
        Frage zum Beispiel nach deinem Monatssaldo, ungewöhnlichen Ausgaben oder überfälligen Forderungen.
      </p>
      {available.length > 0 ? (
        <div className="mt-6 flex flex-wrap items-end gap-5 border-t border-line pt-5">
          <label className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Modell</span>
            <select
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
              disabled={disabled}
              onChange={(event) => {
                const next = available.find((entry) => entry.model === event.target.value);
                if (!next) return;
                onSelectionChange({
                  effort: next.efforts.includes(selection.effort) ? selection.effort : "medium",
                  fastMode: selection.fastMode && next.supportsFastMode,
                  model: next.model,
                });
              }}
              value={selection.model}
            >
              {available.map((entry) => (
                <option key={entry.model} value={entry.model}>{entry.model}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Denktiefe</span>
            <select
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
              disabled={disabled}
              onChange={(event) =>
                onSelectionChange({ ...selection, effort: event.target.value as ModelEffort })
              }
              value={selection.effort}
            >
              {efforts.map((effort) => (
                <option key={effort} value={effort}>{EFFORT_LABELS[effort]}</option>
              ))}
            </select>
          </label>
          {active?.supportsFastMode ? (
            <label className="flex items-center gap-3 pb-2">
              <input
                checked={selection.fastMode}
                className="size-4 accent-accent"
                disabled={disabled}
                onChange={(event) =>
                  onSelectionChange({ ...selection, fastMode: event.target.checked })
                }
                type="checkbox"
              />
              <span className="text-sm text-ink">
                Fast Mode
                <span className="ml-2 text-xs text-muted">1,5x Geschwindigkeit, erhöhter Verbrauch</span>
              </span>
            </label>
          ) : null}
        </div>
      ) : null}
      <Button
        size="regular"
        className="mt-6"
        disabled={disabled}
        onClick={onStart}
      >
        {disabled
          ? "Unterhaltung wird vorbereitet …"
          : hasHistory
            ? "Unterhaltung fortsetzen"
            : "Neue Unterhaltung"}
      </Button>
      <p className="mt-4 text-xs text-muted">
        {available.length === 0
          ? "Die Unterhaltung wird an die geprüfte Standardkonfiguration gebunden."
          : active?.supportsFastMode
            ? "Modell, Denktiefe und Fast Mode werden beim Start an diese Unterhaltung gebunden."
            : "Modell und Denktiefe werden beim Start an diese Unterhaltung gebunden. Dieses Modell bietet keinen Fast Mode."}
      </p>
    </div>
  );
}

const EFFORT_LABELS: Record<ModelEffort, string> = {
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
};

function HistorySidebar({
  activeId,
  conversations,
  historyStatus,
  interactionDisabled,
  loading,
  newDisabled,
  onDelete,
  onNew,
  onSelect,
  onSetStatus,
  onShowStatus,
}: {
  activeId: string | null;
  conversations: ConversationSummary[];
  historyStatus: "active" | "archived";
  interactionDisabled: boolean;
  loading: boolean;
  newDisabled: boolean;
  onDelete: (conversationId: string) => void;
  onNew: () => void;
  onSelect: (conversationId: string) => void;
  onSetStatus: (conversation: ConversationSummary, status: "active" | "archived") => void;
  onShowStatus: (status: "active" | "archived") => void;
}) {
  return (
    <aside className="rounded-panel border border-line bg-paper p-3 shadow-panel" aria-label="Gespeicherte Unterhaltungen">
      <Button className="w-full" size="regular" disabled={newDisabled} onClick={onNew}>
        Neue Unterhaltung
      </Button>
      <div className="mt-5 flex rounded-lg bg-surface p-1 text-[11px]">
        {(["active", "archived"] as const).map((status) => (
          <button
            className={`flex-1 rounded-md px-2 py-1.5 ${historyStatus === status ? "bg-paper font-semibold text-ink shadow-sm" : "text-muted"}`}
            disabled={interactionDisabled}
            key={status}
            onClick={() => onShowStatus(status)}
            type="button"
          >
            {status === "active" ? "Aktiv" : "Archiv"}
          </button>
        ))}
      </div>
      <div className="mt-2 flex max-h-64 gap-2 overflow-x-auto pb-1 lg:max-h-[52vh] lg:flex-col lg:overflow-x-visible lg:overflow-y-auto">
        {loading && conversations.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted">Unterhaltungen werden geladen …</p>
        ) : conversations.length === 0 ? (
          <p className="px-2 py-3 text-xs leading-5 text-muted">Noch keine gespeicherte Unterhaltung.</p>
        ) : conversations.map((conversation) => (
          <div
            key={conversation.id}
            className={`min-w-48 rounded-xl border p-2 ${activeId === conversation.id ? "border-accent/60 bg-accent/5" : "border-line bg-surface/40"}`}
          >
            <button
              className="block w-full text-left disabled:cursor-not-allowed disabled:opacity-60"
              disabled={interactionDisabled}
              onClick={() => onSelect(conversation.id)}
              type="button"
            >
              <span className="block truncate text-sm font-medium text-ink">{conversation.title}</span>
              <span className="mt-1 block text-[11px] text-muted">
                {conversation.message_count} Nachrichten
              </span>
            </button>
            <div className="mt-2 flex gap-3 text-[11px] text-muted">
              <button
                disabled={interactionDisabled}
                type="button"
                onClick={() => onSetStatus(
                  conversation,
                  conversation.status === "active" ? "archived" : "active",
                )}
              >
                {conversation.status === "active" ? "Archivieren" : "Wiederherstellen"}
              </button>
              <button
                className="text-danger disabled:cursor-not-allowed disabled:opacity-60"
                disabled={interactionDisabled}
                type="button"
                onClick={() => onDelete(conversation.id)}
              >
                Löschen
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function ArchivedConversationNotice() {
  return (
    <div className="rounded-panel border border-line bg-paper p-5 shadow-panel">
      <p className="text-sm font-medium text-ink">Diese Unterhaltung ist archiviert.</p>
      <p className="mt-2 text-sm leading-6 text-muted">
        Du kannst sie weiterhin lokal lesen. Stelle sie links wieder her, um sie fortzusetzen.
      </p>
    </div>
  );
}

function ChatPanel({
  activeTurn,
  hasOlderMessages,
  historyLoading,
  messages,
  onLoadOlder,
  onInterrupt,
  onReconfigure,
  onRetry,
  onSubmit,
  selection,
  usage,
  working,
}: {
  activeTurn: boolean;
  hasOlderMessages: boolean;
  historyLoading: boolean;
  messages: DisplayMessage[];
  onLoadOlder: () => void;
  onInterrupt: () => void;
  onReconfigure: () => void;
  onRetry?: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  selection: ModelSelection;
  usage: ThreadUsage | null;
  working: boolean;
}) {
  const promptRef = useRef<HTMLTextAreaElement>(null);

  function applySuggestion(text: string) {
    const field = promptRef.current;
    if (!field) return;
    field.value = text;
    field.focus();
  }

  return (
    <div className="mt-5 overflow-hidden rounded-panel border border-line bg-paper shadow-panel">
      <ChatHeader
        activeTurn={activeTurn}
        onReconfigure={onReconfigure}
        selection={selection}
        usage={usage}
        working={working}
      />
      <div className="min-h-[360px] max-h-[58vh] overflow-y-auto p-5 sm:p-7" aria-live="polite" aria-label="Unterhaltung mit dem Finanzassistenten">
        {hasOlderMessages ? (
          <div className="mb-4 text-center">
            <button className="text-xs font-medium text-accent" disabled={historyLoading} onClick={onLoadOlder} type="button">
              {historyLoading ? "Wird geladen …" : "Ältere Nachrichten laden"}
            </button>
          </div>
        ) : null}
        {messages.length === 0 ? (
          <div className="mx-auto flex min-h-[310px] max-w-2xl flex-col items-center justify-center text-center">
            <span className="grid size-11 place-items-center rounded-full bg-accent/10 text-xl text-accent" aria-hidden="true">◇</span>
            <h2 className="mt-4 text-xl font-medium tracking-[-0.03em] text-ink">Wobei darf ich dir helfen?</h2>
            <p className="mt-2 text-sm leading-6 text-muted">Ich kann deine strukturierten Finanzdaten lesen und Änderungen nur zur Prüfung vorschlagen.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 text-xs text-muted">
              {SUGGESTED_PROMPTS.map((suggestion) => (
                <button
                  className="rounded-full border border-line px-3 py-2 hover:border-accent/60 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={activeTurn || working}
                  key={suggestion}
                  onClick={() => applySuggestion(suggestion)}
                  type="button"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.map((message, index) => (
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
                <MessageActions
                  onRetry={onRetry !== undefined && index === messages.length - 1 ? onRetry : undefined}
                  text={message.status === "complete" ? message.text : ""}
                />
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
            ref={promptRef}
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

const SUGGESTED_PROMPTS = [
  "Wie war mein Monat?",
  "Was ist noch offen?",
  "Wo gebe ich mehr aus?",
] as const;

/**
 * The configuration is bound to the conversation for its whole life, so it has
 * to stay visible while the conversation runs — not only while it is chosen.
 */
function ChatHeader({
  activeTurn,
  onReconfigure,
  selection,
  usage,
  working,
}: {
  activeTurn: boolean;
  onReconfigure: () => void;
  selection: ModelSelection;
  usage: ThreadUsage | null;
  working: boolean;
}) {
  const contextShare = usage && usage.contextWindow
    ? Math.min(100, Math.round((usage.usedTokens / usage.contextWindow) * 100))
    : null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface/45 px-5 py-3 sm:px-7">
      <p className="text-xs text-muted">
        <span className="font-medium text-ink">{selection.model}</span>
        <span aria-hidden="true"> · </span>
        {EFFORT_LABELS[selection.effort]}
        {selection.fastMode ? (
          <>
            <span aria-hidden="true"> · </span>
            <span className="text-accent">Fast Mode</span>
          </>
        ) : null}
      </p>
      {usage ? (
        <p className="text-xs text-muted" aria-live="polite">
          {contextShare === null
            ? `${formatTokens(usage.usedTokens)} Token im Kontext`
            : `Kontext ${contextShare} % · ${formatTokens(usage.usedTokens)} von ${formatTokens(usage.contextWindow!)} Token`}
          <span aria-hidden="true"> · </span>
          {`${formatTokens(usage.totalTokens)} Token insgesamt`}
          {usage.compactions > 0
            ? ` · Verlauf ${usage.compactions}× verdichtet`
            : ""}
        </p>
      ) : null}
      <button
        className="ml-auto text-xs font-medium text-accent disabled:cursor-not-allowed disabled:opacity-60"
        disabled={activeTurn || working}
        onClick={onReconfigure}
        type="button"
      >
        Konfiguration ändern
      </button>
    </div>
  );
}

function MessageActions({ onRetry, text }: { onRetry?: () => void; text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);
  if (text.length === 0 && onRetry === undefined) return null;
  return (
    <div className="mt-2 flex gap-4 text-[11px]">
      {text.length > 0 ? (
        <button
          className="text-muted hover:text-ink"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(
              () => setCopied(true),
              () => undefined,
            );
          }}
          type="button"
        >
          {copied ? "Kopiert" : "Kopieren"}
        </button>
      ) : null}
      {onRetry ? (
        <button className="text-accent hover:underline" onClick={onRetry} type="button">
          Erneut senden
        </button>
      ) : null}
    </div>
  );
}

function formatTokens(value: number): string {
  return value.toLocaleString("de-DE");
}

function StoredMessagesPanel({
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
    <div className="max-h-[58vh] overflow-y-auto rounded-panel border border-line bg-paper p-5 shadow-panel" aria-label="Lokal gespeicherte Unterhaltung">
      <p className="mb-4 text-xs text-muted">Dieser Verlauf ist lokal lesbar. Zum Fortsetzen muss Codex verfügbar sein.</p>
      {hasOlderMessages ? (
        <button className="mb-4 text-xs font-medium text-accent" disabled={loading} onClick={onLoadOlder} type="button">
          {loading ? "Wird geladen …" : "Ältere Nachrichten laden"}
        </button>
      ) : null}
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {messages.map((message) => (
          <article
            key={message.id}
            className={message.role === "user"
              ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-3 text-sm leading-6 text-paper"
              : "mr-auto max-w-[92%] rounded-2xl rounded-bl-md bg-surface px-4 py-3 text-sm leading-6 text-foreground"}
          >
            <p className="whitespace-pre-wrap break-words">{message.text}</p>
          </article>
        ))}
      </div>
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

function AssistantUnavailable({ compact = false }: { compact?: boolean }) {
  return (
    <section className={compact ? "rounded-panel border border-line bg-paper p-6 shadow-panel" : "pt-12"} aria-labelledby="assistant-unavailable-title">
      <PageHeader
        titleId="assistant-unavailable-title"
        eyebrow="Chelaro KI"
        title="Finanzassistent nicht verfügbar."
        description="Deine übrigen Finanzfunktionen bleiben vollständig nutzbar. Starte Chelaro neu, um den lokalen Assistentendienst erneut zu laden."
      />
    </section>
  );
}

class AssistantRequestError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("assistant_request_failed");
    this.name = "AssistantRequestError";
    this.code = code;
  }
}

async function assistantRequest(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok || !isRecord(body)) throw new AssistantRequestError(errorCode(body));
  return body;
}

function errorCode(body: unknown): string {
  if (
    isRecord(body) &&
    isRecord(body.error) &&
    typeof body.error.code === "string" &&
    /^[a-z_]{1,64}$/.test(body.error.code)
  ) return body.error.code;
  return "operation_rejected";
}

/**
 * The host already distinguishes its refusals; the owner deserves the same
 * distinction. Only a genuinely retryable failure may suggest another attempt.
 */
function describeAssistantError(error: unknown): string {
  const code = error instanceof AssistantRequestError ? error.code : "operation_rejected";
  return ASSISTANT_ERROR_MESSAGES[code] ??
    `Die Aktion wurde vom Assistenten abgelehnt (${code}).`;
}

const ASSISTANT_ERROR_MESSAGES: Record<string, string> = {
  agent_unavailable: "Der lokale Assistentendienst antwortet nicht. Starte Chelaro neu.",
  assistant_unavailable: "Der lokale Assistentendienst antwortet nicht. Starte Chelaro neu.",
  authentication_required: "Die Codex-Anmeldung fehlt. Führe im Terminal codex login aus und prüfe den Status erneut.",
  consent_required: "Die Datenfreigabe fehlt. Stimme ihr zu, um fortzufahren.",
  consent_version_mismatch: "Die Datenfreigabe ist veraltet. Stimme der aktuellen Fassung zu.",
  finance_api_unavailable: "Die Finanzdaten stehen dem Assistenten gerade nicht zur Verfügung.",
  identifier_reused: "Diese Kennung wurde in dieser Sitzung bereits verwendet. Starte Chelaro neu.",
  invalid_request: "Die Anfrage war ungültig und wurde nicht gesendet.",
  invalid_state: "Der Assistent ist in einem Zustand, der diese Aktion nicht erlaubt.",
  model_not_available: "Das gewählte Modell bietet Codex gerade nicht an. Wähle ein anderes oder prüfe den Status erneut.",
  protocol_incompatible: "Codex hat unerwartete Daten gesendet. Chelaro hat abgebrochen.",
  resource_not_found: "Diese Unterhaltung ist nicht mehr aktiv. Beginne sie neu.",
  session_busy: "Es läuft noch eine andere Unterhaltung. Beende sie zuerst.",
  turn_busy: "Es läuft noch eine Antwort. Warte, bis sie fertig ist, oder stoppe sie.",
  turn_failed: "Die Antwort konnte nicht gestartet werden. Versuche es erneut.",
  unsafe_codex_configuration: "Codex meldet eine Konfiguration, die Chelaro nicht zulässt. Es wurde nichts gesendet.",
};

async function historyMutation(
  path: string,
  method: "PATCH" | "POST",
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return assistantRequest(path, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
}

async function loadConversationList(
  status: "active" | "archived" = "active",
): Promise<ConversationSummary[]> {
  const suffix = status === "archived" ? "?status=archived" : "";
  const response = await assistantRequest(`/api/assistant/conversations${suffix}`, { method: "GET" });
  if (!Array.isArray(response.data)) return [];
  return response.data.map(parseConversation).filter((item): item is ConversationSummary => item !== null);
}

async function loadMessages(
  conversationId: string,
  beforeSequence?: number,
): Promise<{ messages: DisplayMessage[]; nextBeforeSequence: number | null }> {
  const suffix = beforeSequence === undefined ? "" : `?before_sequence=${beforeSequence}`;
  const response = await assistantRequest(
    `/api/assistant/conversations/${encodeURIComponent(conversationId)}/messages${suffix}`,
    { method: "GET" },
  );
  if (!Array.isArray(response.data)) throw new Error("invalid_history");
  const messages = response.data.map((value): DisplayMessage | null => {
    if (!isRecord(value) ||
      typeof value.id !== "string" ||
      !isOneOf(value.role, ["assistant", "user"]) ||
      !isOneOf(value.status, ["complete", "interrupted", "failed"]) ||
      typeof value.text !== "string") return null;
    return {
      id: `stored:${value.id}`,
      role: value.role,
      status: value.status === "complete" ? "complete" : "failed",
      text: value.text,
    };
  }).filter((message): message is DisplayMessage => message !== null);
  const next = response.next_before_sequence;
  if (!(next === null || (Number.isSafeInteger(next) && Number(next) >= 2))) {
    throw new Error("invalid_history_cursor");
  }
  return { messages, nextBeforeSequence: next as number | null };
}

function parseConversation(value: unknown): ConversationSummary | null {
  if (!isRecord(value) ||
    typeof value.id !== "string" ||
    !Number.isSafeInteger(value.version) || Number(value.version) < 1 ||
    typeof value.title !== "string" || value.title.length === 0 ||
    !isOneOf(value.status, ["active", "archived"]) ||
    !Number.isSafeInteger(value.message_count) || Number(value.message_count) < 0 ||
    typeof value.updated_at !== "string") return null;
  return value as unknown as ConversationSummary;
}

function parseSnapshot(value: unknown): FinanceAssistantSnapshot | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "appServer",
      "auth",
      "consent",
      "host",
      "models",
      "provider",
      "session",
      "turn",
      "usage",
    ])
  ) return null;
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
    !validModels(value.models) ||
    !validSession(value.session) ||
    !validTurn(value.turn) ||
    !validUsage(value.usage)
  ) return null;
  return value as unknown as FinanceAssistantSnapshot;
}

function validModels(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, ["available", "selected"])) return false;
  if (!Array.isArray(value.available) || value.available.length > 32) return false;
  return (
    value.available.every(
      (entry) =>
        isRecord(entry) &&
        exactKeys(entry, ["efforts", "model", "supportsFastMode"]) &&
        typeof entry.model === "string" &&
        typeof entry.supportsFastMode === "boolean" &&
        Array.isArray(entry.efforts) &&
        entry.efforts.every((effort) => isOneOf(effort, ["low", "medium", "high"])),
    ) && validModelSelection(value.selected)
  );
}

function validModelSelection(value: unknown): boolean {
  return (
    isRecord(value) &&
    exactKeys(value, ["effort", "fastMode", "model"]) &&
    typeof value.model === "string" &&
    typeof value.fastMode === "boolean" &&
    isOneOf(value.effort, ["low", "medium", "high"])
  );
}

function validUsage(value: unknown): boolean {
  return value === null || (
    isRecord(value) &&
    exactKeys(value, ["compactions", "contextWindow", "totalTokens", "usedTokens"]) &&
    isTokenCount(value.compactions) &&
    (value.contextWindow === null || isTokenCount(value.contextWindow)) &&
    isTokenCount(value.totalTokens) &&
    isTokenCount(value.usedTokens)
  );
}

function isTokenCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validSession(value: unknown): boolean {
  return value === null || (
    isRecord(value) &&
    exactKeys(value, ["conversationId", "id", "status"]) &&
    (value.conversationId === null || typeof value.conversationId === "string") &&
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
