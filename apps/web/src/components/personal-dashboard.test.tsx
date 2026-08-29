import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PersonalDashboard } from "./personal-dashboard";

const dashboard = {
  data: {
    period: {
      key: "2026-08",
      label: "August 2026",
      start: "2026-08-01",
      end: "2026-09-01",
    },
    summary: {
      income: "3300.00",
      expenses: "2109.60",
      net: "1190.40",
      outstanding_receivables: "260.00",
      overdue_receivables: 1,
      pending_finance_proposals: 0,
      currency: "EUR",
    },
    cashflow: [
      { month: "2026-03", label: "Mär", income: "3100.00", expenses: "2050.00", net: "1050.00" },
      { month: "2026-04", label: "Apr", income: "3100.00", expenses: "2250.00", net: "850.00" },
      { month: "2026-05", label: "Mai", income: "3200.00", expenses: "2090.00", net: "1110.00" },
      { month: "2026-06", label: "Jun", income: "3200.00", expenses: "2400.00", net: "800.00" },
      { month: "2026-07", label: "Jul", income: "3200.00", expenses: "2180.00", net: "1020.00" },
      { month: "2026-08", label: "Aug", income: "3300.00", expenses: "2109.60", net: "1190.40" },
    ],
    open_receivables: [
      {
        id: "0198f558-5fb0-7df7-b8f0-78ad4e12d2bb",
        version: 2,
        debtor_name: "Max Mustermann",
        original_amount: "300.00",
        received_amount: "100.00",
        outstanding_amount: "200.00",
        currency: "EUR",
        due_date: "2026-08-20",
        description: "Reisekosten",
        status: "partial",
        created_at: "2026-08-01T08:00:00Z",
        updated_at: "2026-08-10T08:00:00Z",
      },
    ],
    recent_transactions: [
      {
        id: "0198f558-5fb0-7df7-b8f0-78ad4e12d2bc",
        direction: "income",
        amount: "3200.00",
        currency: "EUR",
        booked_on: "2026-08-01",
        counterparty: "Arbeitgeber",
        category: "Gehalt",
        description: "Gehalt August",
        source: "manual",
        receivable_id: null,
        created_at: "2026-08-01T08:00:00Z",
      },
    ],
  },
};

const receivableDetail = {
  data: {
    ...dashboard.data.open_receivables[0],
    payments: [
      {
        id: "0198f558-5fb0-7df7-b8f0-78ad4e12d2bd",
        transaction_id: "0198f558-5fb0-7df7-b8f0-78ad4e12d2be",
        amount: "100.00",
        booked_on: "2026-08-10",
        purpose: "Erste Rate der Reisekosten",
        payment_method: "bank_transfer",
        note: "Wie vereinbart",
        actor_type: "owner",
        actor_id: "owner",
        proposal_id: null,
        created_at: "2026-08-10T08:00:00Z",
        reversal: null,
      },
    ],
    history: [
      {
        id: "0198f558-5fb0-7df7-b8f0-78ad4e12d2bf",
        event_type: "payment_recorded",
        actor_type: "owner",
        actor_id: "owner",
        proposal_id: null,
        details: { amount: "100.00" },
        created_at: "2026-08-10T08:00:00Z",
      },
    ],
    pending_proposals: 0,
  },
};

describe("PersonalDashboard", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(dashboard)));
  });

  afterEach(() => cleanup());

  it("keeps booked cashflow separate from outstanding receivables", async () => {
    render(<PersonalDashboard />);

    expect(await screen.findByText(/\+1\.190,40/)).toBeDefined();
    expect(screen.getByText(/3\.300,00/)).toBeDefined();
    expect(screen.getByText(/2\.109,60/)).toBeDefined();
    expect(screen.getByText(/260,00/)).toBeDefined();
    expect(screen.getByText("Max Mustermann")).toBeDefined();
    expect(screen.getByText(/100,00.*erhalten/)).toBeDefined();
    expect(screen.getByRole("heading", { name: "Letzte Bewegungen" })).toBeDefined();
  });

  it("records a received payment through the focused review dialog", async () => {
    const fetchMock = vi.fn(
      async (...args: [string | URL | Request, RequestInit?]) => {
      const [input] = args;
      const url = String(input);
      if (url.includes("/payments")) {
        return response(receivableDetail, 201);
      }
      if (url.includes("/api/finance/receivables/")) {
        return response(receivableDetail);
      }
      return response(dashboard);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<PersonalDashboard />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Zahlung von Max Mustermann eintragen",
      }),
    );
    expect(await screen.findByDisplayValue("200,00")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Erhaltener Betrag"), {
      target: { value: "50,00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zahlung verbuchen" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/finance/receivables/0198f558-5fb0-7df7-b8f0-78ad4e12d2bb/payments",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const paymentCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/payments"),
    );
    expect(JSON.parse(String(paymentCall?.[1]?.body))).toEqual({
      expected_version: 2,
      amount: "50.00",
      booked_on: "2026-08-13",
      purpose: "Reisekosten",
      payment_method: "bank_transfer",
      note: null,
    });
    expect(await screen.findByText("Zahlung wurde verbucht und ist im Verlauf sichtbar.")).toBeDefined();
  });

  it("shows purpose, payment method and history only after opening a receivable", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/api/finance/receivables/")) {
        return response(receivableDetail);
      }
      return response(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PersonalDashboard />);

    fireEvent.click(await screen.findByRole("button", { name: "Details zu Max Mustermann öffnen" }));

    expect(await screen.findByRole("heading", { name: "Zahlungsverlauf" })).toBeDefined();
    expect(screen.getByText("Erste Rate der Reisekosten")).toBeDefined();
    expect(screen.getByText(/10\. August 2026 · Überweisung/)).toBeDefined();
    expect(screen.getByRole("heading", { name: "Aktivitäten" })).toBeDefined();
  });

  it("lets the owner review and approve a safe agent proposal", async () => {
    const dashboardWithProposal = {
      data: {
        ...dashboard.data,
        summary: { ...dashboard.data.summary, pending_finance_proposals: 1 },
      },
    };
    const proposal = {
      id: "0198f558-5fb0-7df7-b8f0-78ad4e12d2c0",
      agent_id: "local-agent",
      action: "payment_record",
      receivable_id: dashboard.data.open_receivables[0].id,
      debtor_name: "Max Mustermann",
      expected_version: 2,
      current_version: 2,
      payload: {
        amount: "50.00",
        booked_on: "2026-08-13",
        purpose: "Zweite Rate der Reisekosten",
        payment_method: "bank_transfer",
        note: null,
      },
      rationale: "Die Zahlung wurde im Kontoauszug erkannt.",
      status: "pending",
      created_at: "2026-08-13T09:00:00Z",
      decided_at: null,
    };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("change-proposals") && url.includes("approve")) {
        return response({ data: { ...proposal, status: "approved" } });
      }
      if (url.includes("change-proposals")) return response({ data: [proposal] });
      return response(dashboardWithProposal);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PersonalDashboard />);

    fireEvent.click(await screen.findByRole("button", { name: "1 KI-Vorschlag" }));
    expect(await screen.findByText("Zweite Rate der Reisekosten", { exact: false })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/finance/change-proposals/${proposal.id}/approve`,
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText("KI-Vorschlag wurde geprüft und übernommen.")).toBeDefined();
  });

  it("reviews and approves an agent proposal for a new receivable", async () => {
    const dashboardWithProposal = {
      data: {
        ...dashboard.data,
        summary: { ...dashboard.data.summary, pending_finance_proposals: 1 },
      },
    };
    const proposal = {
      id: "0198f558-5fb0-7df7-b8f0-78ad4e12d2c1",
      agent_id: "codex-finance",
      action: "receivable_create",
      receivable_id: null,
      debtor_name: "Synthetische Testperson",
      expected_version: null,
      current_version: null,
      payload: {
        debtor_name: "Synthetische Testperson",
        original_amount: "3000.00",
        currency: "EUR",
        due_date: "2026-09-30",
        description: "Synthetisches Privatdarlehen",
      },
      rationale: "Der offene Betrag soll zunächst geprüft werden.",
      status: "pending",
      created_at: "2026-08-28T09:00:00Z",
      decided_at: null,
    };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("change-proposals") && url.includes("approve")) {
        return response({
          data: {
            ...proposal,
            status: "approved",
            receivable_id: "0198f558-5fb0-7df7-b8f0-78ad4e12d2c2",
            current_version: 1,
          },
        });
      }
      if (url.includes("change-proposals")) return response({ data: [proposal] });
      return response(dashboardWithProposal);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PersonalDashboard />);

    fireEvent.click(await screen.findByRole("button", { name: "1 KI-Vorschlag" }));
    expect(await screen.findByText("Offenen Betrag anlegen")).toBeDefined();
    expect(screen.getByText(/3\.000,00\s*€.*Synthetisches Privatdarlehen.*30\.09\.2026/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Offenen Betrag ansehen" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/finance/change-proposals/${proposal.id}/approve`,
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText("KI-Vorschlag wurde geprüft und übernommen.")).toBeDefined();
  });
});

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
