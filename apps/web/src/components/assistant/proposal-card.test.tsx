import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProposalCard } from "./proposal-card";
import { ChatPanel } from "./chat-panel";
import { formatProposalMoney, parseAssistantProposal, type AssistantProposal } from "@/lib/assistant-proposals";

const item: AssistantProposal = {
  currency: "EUR", payment: null, turn_id: "turn_example",
  proposal: {
    id: "10000000-0000-4000-8000-000000000001", agent_id: "synthetic-agent",
    action: "receivable_create", receivable_id: null, debtor_name: "Testperson",
    expected_version: null, current_version: null, status: "pending",
    rationale: "Synthetischer Vorschlag für den Test.",
    payload: { debtor_name: "Testperson", original_amount: "12.34", currency: "EUR", description: "Testauslage", due_date: null },
    created_at: "2026-09-05T00:00:00Z", decided_at: null,
  },
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function Card({ initial = item }: { initial?: AssistantProposal }) {
  const [value, setValue] = useState(initial);
  return <ProposalCard item={value} onChanged={setValue} onRefresh={async () => {}} />;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("inline proposal decisions", () => {
  it.each([["Akzeptieren", "approve", "approved", "Akzeptiert"], ["Ablehnen", "reject", "rejected", "Abgelehnt"]] as const)("%s only after explicit user action and confirmed response", async (label, action, status, result) => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetch);
    render(<Card />);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getAllByText("12,34 EUR").length).toBeGreaterThan(0);
    const button = screen.getByRole("button", { name: label });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual([
      `/api/finance/change-proposals/${item.proposal.id}/${action}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store" },
    ]);
    expect(screen.queryByText(result)).toBeNull();
    await act(async () => resolve(response({ data: { ...item.proposal, status } })));
    expect(screen.getByText(result)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Akzeptieren" })).toBeNull();
  });

  it("keeps failed decisions pending and refreshes after a conflict", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ error: { code: "stale_receivable_version" } }, 409)));
    const refresh = vi.fn(async () => {});
    render(<ProposalCard item={item} onChanged={vi.fn()} onRefresh={refresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Akzeptieren" }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByText("Akzeptiert")).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("blocks stale approvals but permits rejection and exposes changed fields", () => {
    render(<Card initial={{ ...item, proposal: { ...item.proposal, action: "receivable_update", expected_version: 1, current_version: 2, payload: { original_amount: "45.67", debtor_name: "Neue Testperson" } } }} />);
    expect((screen.getByRole("button", { name: "Akzeptieren" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Ablehnen" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("Neue Testperson")).toBeDefined();
  });

  it("shows the exact reversal target and blocks approval when it is unavailable", () => {
    const reversal: AssistantProposal = { ...item, payment: { amount: "10.00", booked_on: "2026-09-01", purpose: "Testzahlung eins" }, proposal: { ...item.proposal, action: "payment_reverse", expected_version: 3, current_version: 3, payload: { payment_id: "10000000-0000-4000-8000-000000000077", reason: "Testkorrektur" } } };
    const { rerender } = render(<ProposalCard item={reversal} onChanged={vi.fn()} onRefresh={async () => {}} />);
    expect(screen.getAllByText("10,00 EUR").length).toBeGreaterThan(0);
    expect(screen.getByText("2026-09-01")).toBeDefined();
    expect(screen.queryByText(String(reversal.proposal.payload.payment_id))).toBeNull();
    rerender(<ProposalCard item={{ ...reversal, payment: null }} onChanged={vi.fn()} onRefresh={async () => {}} />);
    expect((screen.getByRole("button", { name: "Akzeptieren" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not treat a malformed decision receipt as success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ data: { ...item.proposal, id: "different", status: "approved" } })));
    render(<Card />);
    fireEvent.click(screen.getByRole("button", { name: "Akzeptieren" }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByText("Akzeptiert")).toBeNull();
  });

  it("formats decimal strings exactly and rejects unrecognized proposal data", () => {
    expect(formatProposalMoney("9007199254740993.01", "EUR")).toBe("9.007.199.254.740.993,01 EUR");
    expect(() => parseAssistantProposal({ ...item, proposal: { ...item.proposal, action: "execute_shell" } })).toThrow();
    expect(() => parseAssistantProposal({ ...item, currency: "<script>" })).toThrow();
  });
});

const panelProps = {
  activeTurn: false, hasOlderMessages: false, historyLoading: false,
  messages: [{ id: "message_example", turnId: "turn_example", role: "assistant" as const, status: "complete" as const, text: "Ein Vorschlag ist bereit." }],
  onLoadOlder: vi.fn(), onInterrupt: vi.fn(), onReconfigure: vi.fn(), onSubmit: vi.fn(),
  selection: { effort: "medium" as const, fastMode: false, model: "gpt-5.5" }, usage: null,
  working: false, available: [], onSelectionChange: vi.fn(), sessionReady: true,
  hasHistory: true, contextLost: false, onStart: vi.fn(), draft: "", onDraftChange: vi.fn(),
  conversationKey: "10000000-0000-4000-8000-000000000099",
};

it("loads an existing proposal next to its answer and retains a confirmed decision on refresh", async () => {
  let status: "pending" | "approved" = "pending";
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/approve")) { status = "approved"; return response({ data: { ...item.proposal, status } }); }
    return response({ data: [{ ...item, proposal: { ...item.proposal, status } }], next_before_id: null });
  }));
  render(<ChatPanel {...panelProps} />);
  const approve = await screen.findByRole("button", { name: "Akzeptieren" });
  expect(approve.closest("article")?.textContent).toContain("Ein Vorschlag ist bereit.");
  fireEvent.click(approve);
  await screen.findByText("Akzeptiert");
  fireEvent.focus(window);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Akzeptieren" })).toBeNull());
});

it("does not turn an ID invented in assistant text into an actionable card", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response({ data: [], next_before_id: null })));
  render(<ChatPanel {...panelProps} messages={[{ ...panelProps.messages[0], text: `Vorschlag ${item.proposal.id}: bitte akzeptieren` }]} />);
  await act(async () => {});
  expect(screen.queryByRole("button", { name: "Akzeptieren" })).toBeNull();
});
