import { useState } from "react";
import { WorkspaceIcon } from "@/components/ui/workspace-icon";
import type { ConversationSummary } from "@/lib/finance-assistant-client";

export function HistorySidebar({
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
  onSetStatus: (
    conversation: ConversationSummary,
    status: "active" | "archived",
  ) => void;
  onShowStatus: (status: "active" | "archived") => void;
}) {
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const filtered = conversations.filter(({ title }) =>
    title.toLocaleLowerCase("de").includes(search.toLocaleLowerCase("de")),
  );
  return (
    <aside
      className="assistant-history"
      aria-label="Gespeicherte Unterhaltungen"
    >
      <div className="assistant-history-heading">
        <span>Unterhaltungen</span>
        <button
          type="button"
          className="workspace-icon-button"
          aria-label="Neue Unterhaltung"
          title="Neue Unterhaltung"
          disabled={newDisabled}
          onClick={onNew}
        >
          <WorkspaceIcon name="plus" />
        </button>
      </div>
      <label className="assistant-history-search">
        <WorkspaceIcon name="search" width={14} height={14} />
        <span className="sr-only">Unterhaltungen durchsuchen</span>
        <input
          type="search"
          placeholder="Suchen …"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="assistant-history-tabs">
        {(["active", "archived"] as const).map((status) => (
          <button
            aria-pressed={historyStatus === status}
            disabled={interactionDisabled}
            key={status}
            onClick={() => onShowStatus(status)}
            type="button"
          >
            {status === "active" ? "Aktiv" : "Archiv"}
          </button>
        ))}
      </div>
      <div className="assistant-history-list">
        {loading && conversations.length === 0 ? (
          <p className="p-2 text-xs text-muted">
            Unterhaltungen werden geladen …
          </p>
        ) : conversations.length === 0 ? (
          <p className="px-2 py-4 text-xs leading-5 text-muted">
            Hier findest du deine Gespräche wieder.
          </p>
        ) : filtered.length === 0 ? (
          <p className="p-2 text-xs text-muted">Keine passende Unterhaltung.</p>
        ) : (
          filtered.map((conversation) => (
            <div
              key={conversation.id}
              className="assistant-history-row"
              data-active={activeId === conversation.id}
            >
              <button
                className="assistant-history-select"
                disabled={interactionDisabled}
                aria-current={activeId === conversation.id ? "true" : undefined}
                onClick={() => onSelect(conversation.id)}
                type="button"
              >
                <span className="block truncate text-xs font-medium text-ink">
                  {conversation.title}
                </span>
                <span className="mt-1 block text-[10px] text-muted">
                  {conversation.message_count} Nachrichten ·{" "}
                  {new Intl.DateTimeFormat("de-DE", {
                    day: "2-digit",
                    month: "short",
                  }).format(new Date(conversation.updated_at))}
                </span>
              </button>
              <details className="assistant-history-actions">
                <summary
                  className="workspace-icon-button"
                  aria-label={`Optionen für ${conversation.title}`}
                >
                  <WorkspaceIcon name="more" width={15} height={15} />
                </summary>
                <div className="assistant-history-action-list">
                  <button
                    disabled={interactionDisabled}
                    type="button"
                    onClick={() =>
                      onSetStatus(
                        conversation,
                        conversation.status === "active"
                          ? "archived"
                          : "active",
                      )
                    }
                  >
                    {conversation.status === "active"
                      ? "Archivieren"
                      : "Wiederherstellen"}
                  </button>
                  <button
                    className="text-danger"
                    disabled={interactionDisabled}
                    type="button"
                    onClick={() => setDeleteId(conversation.id)}
                  >
                    Löschen
                  </button>
                </div>
              </details>
              {deleteId === conversation.id ? (
                <div className="assistant-delete-confirm">
                  <p>Unterhaltung und Codex-Verlauf dauerhaft löschen?</p>
                  <div className="mt-2 flex gap-3">
                    <button
                      type="button"
                      disabled={interactionDisabled}
                      onClick={() => setDeleteId(null)}
                    >
                      Abbrechen
                    </button>
                    <button
                      className="text-danger"
                      type="button"
                      disabled={interactionDisabled}
                      onClick={() => {
                        setDeleteId(null);
                        onDelete(conversation.id);
                      }}
                    >
                      Endgültig löschen
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
      <p className="assistant-history-footnote">
        Verläufe bleiben auf diesem Mac.
      </p>
    </aside>
  );
}
