import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAssistantProposals } from "./use-assistant-proposals";

const proposal = (id: number) => ({
  currency: "EUR", payment: null, turn_id: null,
  proposal: {
    id: `10000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    action: "receivable_create", status: "pending", debtor_name: "Testperson",
    rationale: "Synthetischer Test", payload: {}, expected_version: null, current_version: null,
  },
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("refreshes a contiguous page chain when new proposals arrive between pages", async () => {
  let ids = [4, 3, 2, 1];
  const fetch = vi.fn(async (url: string) => {
    const before = new URL(url, "http://localhost").searchParams.get("before_id");
    const remaining = ids.filter((id) => before === null || id < Number(before));
    return new Response(JSON.stringify({ data: remaining.slice(0, 2).map(proposal), next_before_id: remaining.length > 2 ? remaining[1] : null }));
  });
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useAssistantProposals("conversation_test", false));
  await waitFor(() => expect(result.current.items).toHaveLength(2));
  act(() => result.current.loadOlder());
  await waitFor(() => expect(result.current.items).toHaveLength(4));
  ids = [6, 5, ...ids];
  await act(async () => result.current.refresh());
  expect(result.current.items.map((item) => item.proposal.id)).toEqual([6, 5, 4, 3].map((id) => proposal(id).proposal.id));
  expect(result.current.hasOlder).toBe(true);
  act(() => result.current.loadOlder());
  await waitFor(() => expect(result.current.items).toHaveLength(6));
  expect(result.current.hasOlder).toBe(false);
});
