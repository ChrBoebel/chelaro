import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InvoiceWorkbook } from "./invoice-workbook";

const row = {
  id: "0198f558-5fb0-7df7-b8f0-78ad4e12d2bb",
  version: 1,
  document_id: "0198f558-5fb0-7df7-b8f0-78ad4e12d2bc",
  document_filename: "Strom August.pdf",
  document_download_url: "/api/v1/documents/id/content",
  vendor: null,
  invoice_number: null,
  invoice_date: null,
  gross_amount: null,
  currency: "EUR",
  category: null,
  status: "unverified",
  notes: null,
  updated_at: "2026-08-13T08:00:00Z",
};

const columns = [
  { key: "document", label: "Beleg", data_type: "document", editable: false, width: 260, options: null },
  { key: "vendor", label: "Aussteller", data_type: "text", editable: true, width: 190, options: null },
  { key: "invoice_number", label: "Rechnungsnr.", data_type: "text", editable: true, width: 150, options: null },
  { key: "invoice_date", label: "Datum", data_type: "date", editable: true, width: 140, options: null },
  { key: "gross_amount", label: "Brutto", data_type: "money", editable: true, width: 140, options: null },
  { key: "currency", label: "Währung", data_type: "currency", editable: true, width: 110, options: null },
  { key: "category", label: "Kategorie", data_type: "category", editable: true, width: 160, options: null },
  {
    key: "status",
    label: "Status",
    data_type: "status",
    editable: true,
    width: 150,
    options: ["unverified", "verified", "open", "paid", "archived"],
  },
  { key: "notes", label: "Notiz", data_type: "text", editable: true, width: 240, options: null },
] as const;

function workbookResponse(pendingProposals = 0, vendor: string | null = null) {
  return {
    data: {
      id: "invoices",
      name: "Rechnungen",
      version: 1,
      columns,
      rows: [{ ...row, vendor, version: vendor ? 2 : 1 }],
      pending_proposals: pendingProposals,
    },
  };
}

describe("InvoiceWorkbook", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("saves edited cells as one versioned change set", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/workbooks/invoices/change-sets") {
        return response({
          data: { id: "0198f558-5fb0-7df7-b8f0-78ad4e12d2bd", rows: [{ ...row, vendor: "Nordlicht GmbH", version: 2 }] },
        }, 201);
      }
      expect(init?.method).toBeUndefined();
      return response(workbookResponse());
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<InvoiceWorkbook />);
    const vendorInput = await screen.findByRole("textbox", {
      name: "Aussteller für Strom August.pdf",
    });
    fireEvent.change(vendorInput, { target: { value: "Nordlicht GmbH" } });

    fireEvent.click(screen.getByRole("button", { name: "Änderungen speichern" }));

    expect(await screen.findByText("1 Änderung sicher gespeichert.")).toBeDefined();
    const saveCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("change-sets"));
    expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual({
      changes: [
        {
          row_id: row.id,
          expected_version: 1,
          cells: { vendor: "Nordlicht GmbH" },
        },
      ],
    });
    expect(screen.queryByRole("button", { name: "Änderungen speichern" })).toBeNull();
  });

  it("keeps agent changes pending until the owner approves them", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/change-proposals") {
        return response({
          data: [
            {
              id: "0198f558-5fb0-7df7-b8f0-78ad4e12d2be",
              agent_id: "codex-local",
              rationale: "Aussteller aus dem Beleg erkannt",
              status: "pending",
              created_at: "2026-08-13T08:00:00Z",
              decided_at: null,
              items: [
                {
                  row_id: row.id,
                  field: "vendor",
                  before: null,
                  proposed: "Nordlicht GmbH",
                  expected_version: 1,
                },
              ],
            },
          ],
        });
      }
      if (url.endsWith("/approve")) {
        return response({ data: { status: "approved" } });
      }
      return response(workbookResponse(url.endsWith("/invoices") ? 1 : 0, url.endsWith("/approve") ? "Nordlicht GmbH" : null));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<InvoiceWorkbook />);
    fireEvent.click(await screen.findByRole("button", { name: "1 KI-Vorschlag" }));

    expect(await screen.findByText("Aussteller aus dem Beleg erkannt")).toBeDefined();
    expect(screen.getByText(/leer → Nordlicht GmbH/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/change-proposals/0198f558-5fb0-7df7-b8f0-78ad4e12d2be/approve",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
