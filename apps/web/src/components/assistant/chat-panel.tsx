import { type FormEvent, useEffect, useRef, useState } from "react";
import { ProposalCard } from "@/components/assistant/proposal-card";
import { useAssistantProposals } from "@/lib/use-assistant-proposals";
import { AssistantMessage } from "@/components/assistant-message";
import { BrandMark } from "@/components/brand-mark";
import { WorkspaceIcon } from "@/components/ui/workspace-icon";
import {
  MAX_PROMPT_CHARACTERS,
  type CatalogModel,
  type DisplayMessage,
  type ModelSelection,
  type ModelEffort,
  type ThreadUsage,
} from "@/lib/finance-assistant-client";

const EFFORT_LABELS: Record<ModelEffort, string> = {
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
};

export function ChatPanel({
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
  available,
  onSelectionChange,
  sessionReady,
  hasHistory,
  contextLost,
  onStart,
  draft,
  onDraftChange,
  conversationKey,
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
  available: CatalogModel[];
  onSelectionChange: (selection: ModelSelection) => void;
  sessionReady: boolean;
  hasHistory: boolean;
  contextLost: boolean;
  onStart: () => void;
  draft: string;
  onDraftChange: (value: string) => void;
  conversationKey: string;
}) {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const previousKeyRef = useRef(conversationKey);
  const olderAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const proposals = useAssistantProposals(conversationKey === "new" ? null : conversationKey, activeTurn);
  const lastMessageByTurn = new Map(messages.filter((message) => message.turnId).map((message) => [message.turnId, message.id]));
  const renderProposal = (item: (typeof proposals.items)[number]) => (
    <ProposalCard key={item.proposal.id} item={item} onChanged={proposals.update} onRefresh={proposals.refresh} />
  );
  const model = available.find((entry) => entry.model === selection.model);

  useEffect(() => {
    const field = promptRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(180, Math.max(64, field.scrollHeight))}px`;
  }, [draft]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!viewport.clientHeight) return;
      if (followRef.current) viewport.scrollTop = viewport.scrollHeight;
      setAwayFromBottom(
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 80,
      );
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || !viewport.clientHeight) return;
    if (previousKeyRef.current !== conversationKey) {
      previousKeyRef.current = conversationKey;
      followRef.current = true;
      olderAnchorRef.current = null;
    }
    if (olderAnchorRef.current && !historyLoading) {
      viewport.scrollTop =
        olderAnchorRef.current.top +
        viewport.scrollHeight -
        olderAnchorRef.current.height;
      olderAnchorRef.current = null;
    } else if (followRef.current) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [messages, activeTurn, historyLoading, conversationKey, proposals.items]);

  function scrollToLatest() {
    const viewport = scrollRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
    followRef.current = true;
    setAwayFromBottom(false);
  }

  return (
    <div className="assistant-chat">
      <div
        ref={scrollRef}
        className="assistant-transcript"
        aria-label="Unterhaltung mit dem Finanzassistenten"
        onScroll={() => {
          const viewport = scrollRef.current;
          if (!viewport || !viewport.clientHeight) return;
          const away =
            viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight >
            80;
          followRef.current = !away;
          setAwayFromBottom(away);
        }}
      >
        {hasOlderMessages ? (
          <div className="py-4 text-center">
            <button
              className="text-xs text-accent"
              disabled={historyLoading || working}
              onClick={() => {
                const viewport = scrollRef.current;
                if (viewport)
                  olderAnchorRef.current = {
                    height: viewport.scrollHeight,
                    top: viewport.scrollTop,
                  };
                onLoadOlder();
              }}
              type="button"
            >
              {historyLoading ? "Wird geladen …" : "Ältere Nachrichten laden"}
            </button>
          </div>
        ) : null}
        {messages.length === 0 ? (
          <div className="assistant-welcome">
            <BrandMark className="size-12 opacity-90" />
            <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
              Deine Finanzen. Im Gespräch.
            </p>
            <h2 className="mt-3 text-3xl font-medium tracking-[-0.045em] text-ink sm:text-4xl">
              Was möchtest du wissen?
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted">
              Gemeinsam den Überblick behalten, Ausgaben verstehen und offene
              Beträge klären.
            </p>
            <div className="assistant-suggestions">
              {SUGGESTED_PROMPTS.map((suggestion, index) => (
                <button
                  disabled={working}
                  key={suggestion}
                  onClick={() => {
                    onDraftChange(suggestion);
                    promptRef.current?.focus();
                  }}
                  type="button"
                >
                  <WorkspaceIcon
                    name={(["overview", "workbook", "banking"] as const)[index]}
                  />
                  <span>{suggestion}</span>
                  <span aria-hidden="true" className="ml-auto text-muted">
                    ↗
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div
            className="assistant-message-list"
            role="log"
            aria-live="polite"
            aria-busy={activeTurn}
          >
            {messages.map((message, index) => (
              <article
                key={message.id}
                className={`assistant-message assistant-message-${message.role}`}
                aria-label={
                  message.role === "user"
                    ? "Deine Nachricht"
                    : "Chelaros Antwort"
                }
              >
                <p className="assistant-message-author">
                  {message.role === "user" ? "Du" : "Chelaro"}
                </p>
                {message.status === "failed" ? (
                  <p className="text-sm text-danger">
                    Diese Antwort war unvollständig und wurde verworfen.
                  </p>
                ) : message.role === "assistant" ? (
                  <AssistantMessage text={message.text || "…"} />
                ) : (
                  <p className="whitespace-pre-wrap break-words text-sm leading-7">
                    {message.text}
                  </p>
                )}
                {proposals.items.filter((item) => item.turn_id && lastMessageByTurn.get(item.turn_id) === message.id).map(renderProposal)}
                <MessageActions
                  onRetry={
                    onRetry !== undefined && index === messages.length - 1
                      ? onRetry
                      : undefined
                  }
                  text={message.status === "complete" ? message.text : ""}
                />
              </article>
            ))}
          </div>
        )}
        <div className="assistant-proposal-remainder">
          {proposals.items.filter((item) => !item.turn_id || !lastMessageByTurn.has(item.turn_id)).map(renderProposal)}
          {proposals.error ? <p role="alert" className="my-3 text-xs text-danger">Vorschläge konnten nicht aktualisiert werden. <button type="button" className="underline" onClick={() => void proposals.refresh()}>Erneut prüfen</button></p> : null}
          {proposals.hasOlder ? <button type="button" className="my-3 text-xs text-accent" onClick={proposals.loadOlder}>Ältere Vorschläge laden</button> : null}
        </div>
        <div role="status" className="assistant-activity">
          {activeTurn ? (
            <>
              <span className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" />
              Chelaro arbeitet …
            </>
          ) : null}
        </div>
      </div>
      <div className="assistant-composer-dock">
        {awayFromBottom ? (
          <button
            className="assistant-jump"
            onClick={scrollToLatest}
            type="button"
          >
            <WorkspaceIcon name="down" />
            Zur neuesten Nachricht
          </button>
        ) : null}
        {contextLost ? (
          <p className="mb-2 text-xs text-review">
            Der Codex-Kontext konnte nicht wiederaufgenommen werden. Dein
            gespeicherter Verlauf bleibt erhalten.
          </p>
        ) : null}
        {!sessionReady && hasHistory ? (
          <button
            type="button"
            className="mb-3 text-xs text-accent"
            disabled={working || activeTurn}
            onClick={onStart}
          >
            Unterhaltung fortsetzen
          </button>
        ) : null}
        <form
          className="assistant-composer"
          onSubmit={(event) => {
            followRef.current = true;
            onSubmit(event);
          }}
        >
          <label className="sr-only" htmlFor="finance-assistant-prompt">
            Frage an den Finanzassistenten
          </label>
          <textarea
            id="finance-assistant-prompt"
            name="prompt"
            ref={promptRef}
            rows={2}
            maxLength={MAX_PROMPT_CHARACTERS}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            disabled={working}
            placeholder={
              activeTurn
                ? "Nächste Frage vorbereiten …"
                : "Frage zu deinen Finanzen …"
            }
            onKeyDown={(event) => {
              if (
                event.key !== "Enter" ||
                event.shiftKey ||
                event.nativeEvent.isComposing ||
                event.keyCode === 229
              )
                return;
              event.preventDefault();
              if (!activeTurn && !working && draft.trim())
                event.currentTarget.form?.requestSubmit();
            }}
          />
          <div className="assistant-composer-toolbar">
            {sessionReady ? (
              <ChatHeader
                activeTurn={activeTurn}
                onReconfigure={onReconfigure}
                selection={selection}
                working={working}
              />
            ) : (
              <div className="assistant-model-picker">
                {available.length > 0 ? (
                  <>
                    <label>
                      <span className="sr-only">Modell</span>
                      <select
                        value={selection.model}
                        disabled={working}
                        onChange={(event) => {
                          const next = available.find(
                            (entry) => entry.model === event.target.value,
                          );
                          if (next)
                            onSelectionChange({
                              model: next.model,
                              effort: next.efforts.includes(selection.effort)
                                ? selection.effort
                                : next.efforts[0],
                              fastMode:
                                selection.fastMode && next.supportsFastMode,
                            });
                        }}
                      >
                        {available.map((entry) => (
                          <option key={entry.model} value={entry.model}>
                            {entry.model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="sr-only">Denktiefe</span>
                      <select
                        value={selection.effort}
                        disabled={working}
                        onChange={(event) =>
                          onSelectionChange({
                            ...selection,
                            effort: event.target.value as ModelEffort,
                          })
                        }
                      >
                        {(
                          model?.efforts ??
                          (["low", "medium", "high"] as ModelEffort[])
                        ).map((effort) => (
                          <option key={effort} value={effort}>
                            {EFFORT_LABELS[effort]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {model?.supportsFastMode ? (
                      <label
                        className="assistant-fast-mode"
                        title="Höhere Geschwindigkeit, erhöhter Verbrauch"
                      >
                        <input
                          type="checkbox"
                          checked={selection.fastMode}
                          disabled={working}
                          onChange={(event) =>
                            onSelectionChange({
                              ...selection,
                              fastMode: event.target.checked,
                            })
                          }
                        />
                        Fast Mode
                      </label>
                    ) : null}
                  </>
                ) : (
                  <span className="text-xs text-muted">Standardmodell</span>
                )}
              </div>
            )}
            {activeTurn ? (
              <button
                className="assistant-send"
                aria-label="Stoppen"
                title="Antwort stoppen"
                type="button"
                disabled={working}
                onClick={onInterrupt}
              >
                <WorkspaceIcon name="stop" />
              </button>
            ) : (
              <button
                className="assistant-send"
                aria-label={working ? "Wird gesendet …" : "Senden"}
                title="Senden (Enter)"
                type="submit"
                disabled={working || !draft.trim()}
              >
                <WorkspaceIcon name="arrow" />
              </button>
            )}
          </div>
        </form>
        <div className="assistant-composer-meta">
          <span>
            Finanzänderungen bleiben Vorschläge, bis du sie hier akzeptierst.
          </span>
          <span className="hidden shrink-0 xl:inline">
            ↵ Senden · ⇧ ↵ Neue Zeile
          </span>
        </div>
        {usage ? (
          <p className="mt-1 text-[10px] text-muted">
            {usage.contextWindow
              ? `Kontext ${Math.min(100, Math.round((usage.usedTokens / usage.contextWindow) * 100))} % · `
              : ""}
            {formatTokens(usage.usedTokens)} Token im Kontext ·{" "}
            {formatTokens(usage.totalTokens)} Token insgesamt
            {usage.compactions
              ? ` · Verlauf ${usage.compactions}× verdichtet`
              : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}

const SUGGESTED_PROMPTS = [
  "Wie war mein Monat?",
  "Was ist noch offen?",
  "Wo gebe ich mehr aus?",
] as const;

function ChatHeader({
  activeTurn,
  onReconfigure,
  selection,
  working,
}: {
  activeTurn: boolean;
  onReconfigure: () => void;
  selection: ModelSelection;
  working: boolean;
}) {
  return (
    <div className="assistant-bound-model">
      <p className="text-muted">
        <span className="font-medium text-ink">{selection.model}</span> ·{" "}
        {EFFORT_LABELS[selection.effort]}
        {selection.fastMode ? (
          <span className="text-accent"> · Fast Mode</span>
        ) : null}
      </p>
      <button
        className="text-xs text-accent"
        aria-label="Konfiguration ändern"
        title="Konfiguration ändern"
        type="button"
        disabled={activeTurn || working}
        onClick={onReconfigure}
      >
        ⌄
      </button>
    </div>
  );
}

function MessageActions({
  onRetry,
  text,
}: {
  onRetry?: () => void;
  text: string;
}) {
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
        <button
          className="text-accent hover:underline"
          onClick={onRetry}
          type="button"
        >
          Erneut senden
        </button>
      ) : null}
    </div>
  );
}

function formatTokens(value: number): string {
  return value.toLocaleString("de-DE");
}
