"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { WorkspaceIcon } from "@/components/ui/workspace-icon";
import { ChatPanel } from "@/components/assistant/chat-panel";
import { HistorySidebar } from "@/components/assistant/history-sidebar";
import {
  ConsentPanel,
  ProviderPanel,
  ArchivedConversationNotice,
  StoredMessagesPanel,
  AssistantControls,
  AssistantLoading,
  AssistantUnavailable,
} from "@/components/assistant/setup-panels";
import {
  MAX_PROMPT_CHARACTERS,
  MAX_ASSISTANT_MESSAGE_BYTES,
  type FinanceAssistantSnapshot,
  type ConversationSummary,
  type DisplayMessage,
  type ModelSelection,
  type ActiveStream,
  assistantRequest,
  describeAssistantError,
  historyMutation,
  loadConversationList,
  loadMessages,
  parseConversation,
  parseSnapshot,
  isStartedEvent,
  isChunkEvent,
  isCompletedEvent,
  isTurnActive,
  resourceId,
  streamKey,
  decodeBase64,
  verifyDigest,
  failMessage,
  exactKeys,
  isRecord,
} from "@/lib/finance-assistant-client";

export function FinanceAssistant({
  historyContainer,
  onConversationSelect,
}: {
  historyContainer?: HTMLElement | null;
  onConversationSelect?: () => void;
}) {
  const [snapshot, setSnapshotState] =
    useState<FinanceAssistantSnapshot | null>(null);
  const [availability, setAvailability] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [requestWorking, setIsWorking] = useState(false);
  const [historyWorking, setHistoryWorking] = useState(false);
  const historyMutationRef = useRef(false);
  const isWorking = requestWorking || historyWorking;
  const [connectionInterrupted, setConnectionInterrupted] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyStatus, setHistoryStatus] = useState<"active" | "archived">(
    "active",
  );
  const [nextBeforeSequence, setNextBeforeSequence] = useState<number | null>(
    null,
  );
  // Replaced by the host's verified default as soon as the first snapshot
  // arrives; this only avoids an empty picker on the very first render.
  const [draftSelection, setDraftSelection] = useState<ModelSelection>({
    effort: "medium",
    fastMode: false,
    model: "gpt-5.6-luna",
  });
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const submissionRef = useRef(false);
  const selectionRequestRef = useRef(0);
  const activeConversationRef = useRef<string | null>(null);
  const snapshotRef = useRef<FinanceAssistantSnapshot | null>(null);
  const streamsRef = useRef(new Map<string, ActiveStream>());

  const historyStatusRef = useRef<"active" | "archived">("active");
  const historyListRequestRef = useRef(0);
  const refreshConversations = useCallback(
    async (status = historyStatusRef.current) => {
      const request = ++historyListRequestRef.current;
      const items = await loadConversationList(status);
      if (
        request === historyListRequestRef.current &&
        status === historyStatusRef.current
      )
        setConversations(items);
      return items;
    },
    [],
  );

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

  const applyEvent = useCallback(
    (raw: string) => {
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
            void refreshConversations().catch(() => undefined);
          }
        }
        return;
      }
      const activeSnapshot = snapshotRef.current;
      if (!activeSnapshot?.session || !activeSnapshot.turn) return;
      if (
        event.sessionId !== activeSnapshot.session.id ||
        event.turnId !== activeSnapshot.turn.id
      )
        return;

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
        setMessages((current) =>
          current.map((message) =>
            message.id === key ? { ...message, text } : message,
          ),
        );
        return;
      }
      if (
        event.type === "assistant.message.completed" &&
        isCompletedEvent(event)
      ) {
        const key = streamKey(event.turnId, event.messageId);
        const stream = streamsRef.current.get(key);
        if (!stream || stream.bytes.length !== event.totalBytes) {
          failMessage(key, setMessages);
          return;
        }
        streamsRef.current.delete(key);
        void verifyDigest(Uint8Array.from(stream.bytes), event.sha256).then(
          (valid) => {
            setMessages((current) =>
              current.map((message) =>
                message.id === key
                  ? { ...message, status: valid ? "complete" : "failed" }
                  : message,
              ),
            );
          },
        );
      }
    },
    [refreshConversations, setSnapshot],
  );

  useEffect(() => {
    let disposed = false;
    let events: EventSource | undefined;
    void refreshConversations()
      .then((items) => {
        if (disposed) return;
        const first = items[0];
        if (first) {
          setActiveConversationId(first.id);
          activeConversationRef.current = first.id;
          return loadMessages(first.id).then((stored) => {
            if (!disposed && activeConversationRef.current === first.id) {
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
  }, [applyEvent, refreshConversations, setSnapshot]);

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
    const state = snapshotRef.current;
    if (
      state?.consent.status !== "granted" ||
      state.auth !== "authenticated" ||
      state.provider.status !== "ready" ||
      isTurnActive(state.turn)
    )
      return false;
    const currentSession = snapshotRef.current?.session;
    if (currentSession && currentSession.status !== "closed") {
      if (
        conversationId &&
        currentSession.conversationId === conversationId &&
        currentSession.status === "ready"
      )
        return true;
      await closeSession();
      if (getSessionStatus() !== "closed") return;
    }
    streamsRef.current.clear();
    let selectedId = conversationId;
    if (!selectedId) {
      let created: Record<string, unknown>;
      try {
        created = await historyMutation(
          "/api/assistant/conversations",
          "POST",
          {},
        );
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
      historyStatusRef.current = "active";
      setHistoryStatus("active");
      setConversations([summary]);
      void refreshConversations().catch(() => undefined);
      setActiveConversationId(summary.id);
      activeConversationRef.current = summary.id;
      setMessages([]);
      setNextBeforeSequence(null);
    }
    const response = await runAction("/api/assistant/sessions", {
      conversation_id: selectedId,
      model_selection: {
        effort: draftSelection.effort,
        fast_mode: draftSelection.fastMode,
        model: draftSelection.model,
      },
      session_id: resourceId("session"),
    });
    return (
      response !== null &&
      snapshotRef.current?.session?.status === "ready" &&
      snapshotRef.current.session.conversationId === selectedId
    );
  }

  async function newConversation() {
    if (
      isWorking ||
      historyLoading ||
      isTurnActive(snapshotRef.current?.turn ?? null)
    )
      return;
    if (
      snapshotRef.current?.session &&
      snapshotRef.current.session.status !== "closed"
    ) {
      await closeSession();
      if (getSessionStatus() !== "closed") return;
    }
    selectionRequestRef.current += 1;
    streamsRef.current.clear();
    activeConversationRef.current = null;
    setActiveConversationId(null);
    setMessages([]);
    setNextBeforeSequence(null);
    setLastPrompt(null);
    setNotice(null);
    if (historyStatus !== "active") await showHistoryStatus("active");
    onConversationSelect?.();
  }

  async function selectConversation(conversationId: string) {
    if (
      isWorking ||
      historyLoading ||
      isTurnActive(snapshotRef.current?.turn ?? null)
    )
      return;
    const request = ++selectionRequestRef.current;
    setHistoryLoading(true);
    setNotice(null);
    try {
      if (
        snapshotRef.current?.session &&
        snapshotRef.current.session.status !== "closed"
      ) {
        await closeSession();
        if (getSessionStatus() !== "closed") return;
      }
      const stored = await loadMessages(conversationId);
      if (request !== selectionRequestRef.current) return;
      streamsRef.current.clear();
      activeConversationRef.current = conversationId;
      setActiveConversationId(conversationId);
      setMessages(stored.messages);
      setNextBeforeSequence(stored.nextBeforeSequence);
      setLastPrompt(null);
      onConversationSelect?.();
    } catch {
      setNotice("Die gespeicherte Unterhaltung konnte nicht geladen werden.");
    } finally {
      if (request === selectionRequestRef.current) setHistoryLoading(false);
    }
  }

  async function loadOlderMessages() {
    if (!activeConversationId || nextBeforeSequence === null || historyLoading)
      return;
    setHistoryLoading(true);
    try {
      const stored = await loadMessages(
        activeConversationId,
        nextBeforeSequence,
      );
      setMessages((current) => [...stored.messages, ...current]);
      setNextBeforeSequence(stored.nextBeforeSequence);
    } catch {
      setNotice("Ältere Nachrichten konnten nicht geladen werden.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function runHistoryAction(action: () => Promise<void>) {
    if (
      historyMutationRef.current ||
      isWorking ||
      historyLoading ||
      isTurnActive(snapshotRef.current?.turn ?? null)
    )
      return;
    historyMutationRef.current = true;
    historyListRequestRef.current += 1;
    setHistoryWorking(true);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice(describeAssistantError(error));
    } finally {
      historyListRequestRef.current += 1;
      historyMutationRef.current = false;
      setHistoryWorking(false);
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
    setConversations((current) =>
      current.filter(({ id }) => id !== updated.id),
    );
    if (activeConversationRef.current === updated.id) {
      setActiveConversationId(null);
      activeConversationRef.current = null;
      setLastPrompt(null);
      setMessages([]);
      setNextBeforeSequence(null);
    }
  }

  async function showHistoryStatus(status: "active" | "archived") {
    if (isTurnActive(snapshotRef.current?.turn ?? null)) return;
    if (
      snapshotRef.current?.session &&
      snapshotRef.current.session.status !== "closed"
    ) {
      await closeSession();
      if (getSessionStatus() !== "closed") return;
    }
    setLastPrompt(null);
    activeConversationRef.current = null;
    historyStatusRef.current = status;
    setHistoryStatus(status);
    setHistoryLoading(true);
    setActiveConversationId(null);
    setMessages([]);
    setNextBeforeSequence(null);
    try {
      await refreshConversations(status);
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
      setNotice(
        "Der zugehörige Codex-Verlauf konnte nicht gelöscht werden. Es wurde nichts entfernt.",
      );
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
    setConversations((current) =>
      current.filter(({ id }) => id !== conversationId),
    );
    if (activeConversationRef.current === conversationId) {
      setActiveConversationId(null);
      activeConversationRef.current = null;
      setLastPrompt(null);
      setMessages([]);
      setNextBeforeSequence(null);
    }
  }

  function hasLiveSessionFor(conversationId: string): boolean {
    const session = snapshotRef.current?.session;
    return Boolean(
      session &&
      session.conversationId === conversationId &&
      session.status !== "closed",
    );
  }

  function getSessionStatus() {
    return snapshotRef.current?.session?.status;
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
    const key = activeConversationId ?? "new";
    const prompt = (drafts[key] ?? "").trim();
    if (
      !prompt ||
      prompt.length > MAX_PROMPT_CHARACTERS ||
      submissionRef.current ||
      isWorking ||
      historyLoading
    )
      return;
    submissionRef.current = true;
    setIsWorking(true);
    try {
      let active = snapshotRef.current;
      if (
        active?.consent.status !== "granted" ||
        active.auth !== "authenticated" ||
        active.provider.status !== "ready" ||
        isTurnActive(active.turn) ||
        historyStatus === "archived"
      )
        return;
      if (
        active.session?.status !== "ready" ||
        (active.session.conversationId !== null &&
          active.session.conversationId !== activeConversationId)
      ) {
        if (!(await createSession(activeConversationId ?? undefined))) {
          const destination = activeConversationRef.current ?? "new";
          setDrafts((current) => ({
            ...current,
            [key]: "",
            [destination]: prompt,
          }));
          return;
        }
      }
      active = snapshotRef.current;
      if (!active?.session || active.session.status !== "ready") return;
      const sent = await sendPrompt(prompt);
      const destination = activeConversationRef.current ?? "new";
      setDrafts((current) => ({
        ...current,
        [key]: "",
        [destination]: sent ? "" : prompt,
      }));
    } finally {
      submissionRef.current = false;
      setIsWorking(false);
    }
  }

  async function sendPrompt(prompt: string) {
    const active = snapshotRef.current;
    if (
      !active?.session ||
      active.session.status !== "ready" ||
      active.consent.status !== "granted" ||
      isTurnActive(active.turn)
    )
      return false;
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
    if (response) {
      void refreshConversations().catch(() => undefined);
    } else {
      setMessages((current) =>
        current.filter(({ id }) => id !== `user:${turnId}`),
      );
    }
    return response !== null;
  }

  if (availability === "loading" && historyLoading) return <AssistantLoading />;

  const activeTurn = isTurnActive(snapshot?.turn ?? null);
  // Offering a retry only makes sense while the last attempt visibly failed and
  // nothing else is running; anything else would resend a question twice.
  const retryPrompt =
    !activeTurn &&
    !isWorking &&
    lastPrompt !== null &&
    (snapshot?.turn?.status === "failed" ||
      snapshot?.turn?.status === "interrupted" ||
      messages.at(-1)?.status === "failed")
      ? lastPrompt
      : null;
  const selectedConversation = conversations.find(
    ({ id }) => id === activeConversationId,
  );
  const selectedConversationArchived =
    selectedConversation?.status === "archived";
  const sessionReady =
    snapshot?.session?.status === "ready" &&
    (snapshot.session.conversationId === null ||
      snapshot.session.conversationId === activeConversationId);
  const storedHistory = activeConversationId ? (
    <StoredMessagesPanel
      hasOlderMessages={nextBeforeSequence !== null}
      loading={historyLoading}
      messages={messages}
      onLoadOlder={() => void loadOlderMessages()}
    />
  ) : null;

  const sidebar = (
    <HistorySidebar
      activeId={activeConversationId}
      conversations={conversations}
      historyStatus={historyStatus}
      interactionDisabled={isWorking || activeTurn || historyLoading}
      loading={historyLoading}
      onSetStatus={(conversation, status) =>
        void runHistoryAction(() => setConversationStatus(conversation, status))
      }
      onDelete={(conversationId) =>
        void runHistoryAction(() => deleteConversation(conversationId))
      }
      onNew={() => void newConversation()}
      onSelect={(conversationId) => void selectConversation(conversationId)}
      onShowStatus={(status) => void showHistoryStatus(status)}
      newDisabled={isWorking || activeTurn || historyLoading}
    />
  );
  const canChat =
    availability === "ready" &&
    snapshot?.consent.status === "granted" &&
    snapshot.provider.status === "ready" &&
    snapshot.auth === "authenticated" &&
    historyStatus === "active" &&
    !selectedConversationArchived;

  return (
    <section
      className={`assistant-workspace ${historyContainer ? "assistant-workspace-embedded" : ""}`}
      aria-label="Finanzassistent"
    >
      {historyContainer ? createPortal(sidebar, historyContainer) : sidebar}
      <div className="assistant-main">
        <header className="assistant-thread-header">
          <div className="min-w-0">
            <h1
              id="assistant-title"
              className="truncate text-sm font-medium text-ink"
            >
              {selectedConversation?.title ?? "Neue Unterhaltung"}
            </h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
              <span
                className={`size-1.5 rounded-full ${activeTurn ? "bg-accent motion-safe:animate-pulse" : "bg-muted/50"}`}
              />
              {activeTurn
                ? "Chelaro arbeitet …"
                : activeConversationId
                  ? "Lokal gespeichert"
                  : "Dein Finanzassistent"}
            </p>
          </div>
          {snapshot?.consent.status === "granted" ? (
            <details className="assistant-options">
              <summary
                className="workspace-icon-button"
                aria-label="Unterhaltungsoptionen"
              >
                <WorkspaceIcon name="more" />
              </summary>
              <AssistantControls
                activeTurn={activeTurn}
                hasLiveSession={Boolean(
                  snapshot.session && snapshot.session.status !== "closed",
                )}
                consentGranted
                onCloseSession={() => void closeSession()}
                onRevoke={() => void revokeConsent()}
                working={isWorking}
              />
            </details>
          ) : null}
        </header>
        {connectionInterrupted || notice ? (
          <p role="status" className="assistant-notice">
            {connectionInterrupted
              ? "Verbindung unterbrochen – die Wiederverbindung läuft."
              : notice}
          </p>
        ) : null}
        {canChat && snapshot ? (
          <ChatPanel
            activeTurn={activeTurn}
            working={isWorking || historyLoading}
            messages={messages}
            hasOlderMessages={nextBeforeSequence !== null}
            historyLoading={historyLoading}
            onLoadOlder={() => void loadOlderMessages()}
            onInterrupt={() => void runAction("/api/assistant/turns/interrupt")}
            onReconfigure={() => void closeSession()}
            onRetry={
              retryPrompt === null
                ? undefined
                : () => void sendPrompt(retryPrompt)
            }
            onSubmit={submitPrompt}
            selection={sessionReady ? snapshot.models.selected : draftSelection}
            usage={sessionReady ? snapshot.usage : null}
            available={snapshot.models.available}
            onSelectionChange={setDraftSelection}
            sessionReady={sessionReady}
            hasHistory={activeConversationId !== null}
            contextLost={snapshot.session?.status === "context_lost"}
            onStart={() =>
              void createSession(activeConversationId ?? undefined)
            }
            draft={drafts[activeConversationId ?? "new"] ?? ""}
            onDraftChange={(value) =>
              setDrafts((current) => ({
                ...current,
                [activeConversationId ?? "new"]: value,
              }))
            }
            conversationKey={activeConversationId ?? "new"}
          />
        ) : (
          <div className="assistant-setup">
            {availability === "unavailable" || !snapshot ? (
              <AssistantUnavailable compact />
            ) : snapshot.consent.status !== "granted" ? (
              <ConsentPanel
                pending={
                  snapshot.consent.status === "revoke_pending" || isWorking
                }
                onGrant={() => void grantConsent()}
              />
            ) : snapshot.provider.status !== "ready" ||
              snapshot.auth !== "authenticated" ? (
              <ProviderPanel
                disabled={isWorking}
                provider={snapshot.provider}
                authenticated={snapshot.auth === "authenticated"}
                onRefresh={() =>
                  void runAction("/api/assistant/provider/refresh")
                }
              />
            ) : (
              <ArchivedConversationNotice />
            )}
            {storedHistory}
          </div>
        )}
      </div>
    </section>
  );
}
