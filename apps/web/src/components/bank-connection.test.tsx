import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BankConnectionSetup } from "./bank-connection";

const emptyReadiness = {
  data: {
    connection: null,
    ready_for_live_sync: false,
    security_notice: "PIN und TAN werden nicht in Chelaro gespeichert.",
    checks: [
      {
        code: "institution",
        label: "Bankdaten hinterlegt",
        complete: false,
        detail: "Institut, BLZ und BIC werden ohne Zugangsdaten gespeichert.",
      },
      {
        code: "adapter",
        label: "FinTS-Adapter installiert",
        complete: false,
        detail: "Der Live-Abruf wird später ergänzt.",
      },
    ],
  },
};

const connection = {
  id: "0198f558-5fb0-7df7-b8f0-78ad4e12d2c1",
  version: 1,
  provider: "fints",
  access_mode: "read_only",
  institution_name: "Kreissparkasse Göppingen",
  bank_code: "61050000",
  bic: "GOPSDE6GXXX",
  endpoint: null,
  tan_method: "unknown",
  transaction_access_confirmed: null,
  statement_access_confirmed: null,
  created_at: "2026-08-17T08:00:00Z",
  updated_at: "2026-08-17T08:00:00Z",
};

describe("BankConnectionSetup", () => {
  beforeEach(() => {
    let configured = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/connections")) {
          configured = true;
          return response({ data: connection }, 201);
        }
        return response(
          configured
            ? { data: { ...emptyReadiness.data, connection } }
            : emptyReadiness,
        );
      }),
    );
  });

  afterEach(() => cleanup());

  it("prepares Sparkasse metadata without asking for credentials", async () => {
    render(<BankConnectionSetup />);

    expect(await screen.findByDisplayValue("Kreissparkasse Göppingen")).toBeDefined();
    expect(screen.getByDisplayValue("61050000")).toBeDefined();
    expect(screen.queryByLabelText(/PIN/i)).toBeNull();
    expect(screen.queryByLabelText(/^TAN$/i)).toBeNull();
    expect(screen.getByText(/PIN und TAN werden nicht/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Vorbereitung speichern" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/banking/connections",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const connectionCall = vi.mocked(fetch).mock.calls.find(([url]) =>
      String(url).includes("/connections"),
    );
    const payload = JSON.parse(String(connectionCall?.[1]?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      provider: "fints",
      access_mode: "read_only",
      institution_name: "Kreissparkasse Göppingen",
      bank_code: "61050000",
      bic: "GOPSDE6GXXX",
    });
    expect(payload).not.toHaveProperty("pin");
    expect(payload).not.toHaveProperty("tan");
    expect(await screen.findByText(/ohne PIN oder TAN vorgemerkt/)).toBeDefined();
  });
});

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
