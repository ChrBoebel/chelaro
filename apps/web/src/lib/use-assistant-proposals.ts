import { useCallback, useEffect, useRef, useState } from "react";
import { assistantRequest } from "@/lib/finance-assistant-client";
import { parseAssistantProposal, type AssistantProposal } from "@/lib/assistant-proposals";

async function loadPage(conversationId: string, before?: number) {
  const suffix = before === undefined ? "" : `?before_id=${before}`;
  const body = await assistantRequest(`/api/assistant/conversations/${encodeURIComponent(conversationId)}/proposals${suffix}`, { method: "GET" });
  if (!Array.isArray(body.data) || !(body.next_before_id === null || (Number.isSafeInteger(body.next_before_id) && Number(body.next_before_id) > 0))) throw new Error("invalid_proposals");
  return { items: body.data.map(parseAssistantProposal), before: body.next_before_id as number | null };
}

export function useAssistantProposals(conversationId: string | null, activeTurn: boolean) {
  const [items, setItems] = useState<AssistantProposal[]>([]);
  const [before, setBefore] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const requests = useRef({ sequence: 0, pageCount: 1 });
  const load = useCallback((older?: number): Promise<void> => {
    if (!conversationId) return Promise.resolve();
    const state = requests.current;
    const sequence = ++state.sequence;
    // Refresh every loaded page so decisions in another view cannot leave old
    // cards stale. Pagination never replaces newer cards with an older page.
    async function loadPages() {
      const pages = [await loadPage(conversationId!, older)];
      while (older === undefined && pages.length < state.pageCount && pages.at(-1)!.before !== null) {
        pages.push(await loadPage(conversationId!, pages.at(-1)!.before!));
      }
      return pages;
    }
    return loadPages()
      .then((pages) => {
        if (state.sequence !== sequence) return;
        if (older !== undefined) state.pageCount++;
        setItems((previous) => {
          const merged = new Map((older === undefined ? [] : previous).map((item) => [item.proposal.id, item]));
          for (const page of pages) for (const item of page.items) merged.set(item.proposal.id, item);
          return [...merged.values()];
        });
        setBefore(pages.at(-1)!.before);
        setError(false);
      })
      .catch(() => { if (state.sequence === sequence) setError(true); });
  }, [conversationId]);

  useEffect(() => {
    const state = requests.current;
    void load();
    const refresh = () => { void load(); };
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, activeTurn ? 2_000 : 15_000);
    return () => {
      state.sequence++;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load, activeTurn]);

  function update(item: AssistantProposal) {
    requests.current.sequence++;
    setItems((previous) => previous.map((entry) => entry.proposal.id === item.proposal.id ? item : entry));
  }

  return { items, hasOlder: before !== null, loadOlder: () => { if (before !== null) void load(before); }, refresh: () => load(), update, error };
}
