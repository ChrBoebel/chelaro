import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FinanceAssistant } from "./finance-assistant";

const baseSnapshot = {
  appServer: "ready",
  auth: "logged_out",
  consent: { status: "unknown", version: null },
  host: "ready",
  session: null,
  turn: null,
};

class TestEventSource {
  static latest: TestEventSource | undefined;
  readonly listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    TestEventSource.latest = this;
  }

  addEventListener(type: string, callback: EventListenerOrEventListenerObject) {
    const listener = callback as (event: MessageEvent<string>) => void;
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: "finance" | "reset", data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  close() {
    this.closed = true;
  }
}

describe("FinanceAssistant", () => {
  beforeEach(() => {
    TestEventSource.latest = undefined;
    vi.stubGlobal("EventSource", TestEventSource);
  });

  afterEach(() => {
    cleanup();
    delete window.financeOS;
    vi.unstubAllGlobals();
  });

  it("requires explicit informed consent before authentication or finance access", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/consent/grant")) {
        return jsonResponse({
          snapshot: {
            ...baseSnapshot,
            consent: { status: "granted", version: "2026-08-28.v1" },
          },
        });
      }
      return jsonResponse({ snapshot: baseSnapshot });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FinanceAssistant />);

    expect(await screen.findByRole("heading", { name: "Du entscheidest, was geteilt wird." })).toBeDefined();
    expect(screen.getByText(/Originaldokumente, OCR-Inhalte, Bankzugänge/)).toBeDefined();
    expect(screen.getByText("Keine Änderung ohne deine Prüfung")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Zustimmen und fortfahren" }));

    expect(await screen.findByRole("heading", { name: "Mit ChatGPT verbinden" })).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assistant/consent/grant",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("opens only a validated OpenAI device login URL through the desktop bridge", async () => {
    const consented = {
      ...baseSnapshot,
      consent: { status: "granted", version: "2026-08-28.v1" },
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/auth/login")) {
        return jsonResponse({
          login: {
            status: "login_pending",
            userCode: "ABCD-EFGH",
            verificationUrl: "https://auth.openai.com/device",
          },
        });
      }
      return jsonResponse({ snapshot: consented });
    }));
    const openOpenAiLogin = vi.fn(async () => true);
    window.financeOS = {
      external: { openOpenAiLogin },
      platform: "darwin",
      updates: disabledUpdates(),
    };

    render(<FinanceAssistant />);
    fireEvent.click(await screen.findByRole("button", { name: "Gerätecode anfordern" }));

    expect(await screen.findByText("ABCD-EFGH")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Anmeldung öffnen" }));
    await waitFor(() => {
      expect(openOpenAiLogin).toHaveBeenCalledWith("https://auth.openai.com/device");
    });
  });

  it("streams bound plain-text finance answers and keeps mutations review-only", async () => {
    const sessionId = "session_test_1";
    const authenticated = {
      ...baseSnapshot,
      auth: "authenticated",
      consent: { status: "granted", version: "2026-08-28.v1" },
      session: { id: sessionId, status: "ready" },
    };
    const running = {
      ...authenticated,
      turn: { id: "turn_12345678123442348123456789012345", status: "running" },
    };
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("12345678-1234-4234-8123-456789012345");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/turns")) return jsonResponse({ snapshot: running }, 202);
      return jsonResponse({ snapshot: authenticated });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FinanceAssistant />);
    const prompt = await screen.findByLabelText("Frage an den Finanzassistenten");
    fireEvent.change(prompt, { target: { value: "Wie hoch ist mein Monatssaldo?" } });
    fireEvent.submit(prompt.closest("form")!);

    expect(await screen.findByText("Wie hoch ist mein Monatssaldo?")).toBeDefined();
    await waitFor(() => expect(TestEventSource.latest).toBeDefined());
    expect(await screen.findByRole("button", { name: "Stoppen" })).toBeDefined();
    await act(async () => {
      TestEventSource.latest!.emit("finance", {
        messageId: "message_1",
        sessionId: "another_session",
        turnId: running.turn.id,
        type: "assistant.message.started",
      });
      TestEventSource.latest!.emit("finance", {
        messageId: "message_1",
        sessionId,
        turnId: running.turn.id,
        type: "assistant.message.started",
      });
      const text = "Dein Monatssaldo beträgt 1.190,40 EUR.";
      const encoded = new TextEncoder().encode(text);
      TestEventSource.latest!.emit("finance", {
        dataBase64: btoa(String.fromCharCode(...encoded)),
        messageId: "message_1",
        rawBytes: encoded.byteLength,
        sequence: 0,
        sessionId,
        turnId: running.turn.id,
        type: "assistant.message.chunk",
      });
    });

    expect(await screen.findByText("Dein Monatssaldo beträgt 1.190,40 EUR.")).toBeDefined();
    expect(screen.getByText(/Finanzänderungen bleiben Vorschläge/)).toBeDefined();
    expect(screen.queryByText("another_session")).toBeNull();
  });

  it("isolates assistant startup failure from the rest of the finance workspace", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(
      { error: { code: "assistant_unavailable" } },
      503,
    )));

    render(<FinanceAssistant />);

    expect(await screen.findByRole("heading", { name: "Finanzassistent nicht verfügbar." })).toBeDefined();
    expect(screen.getByText(/übrigen Finanzfunktionen bleiben vollständig nutzbar/)).toBeDefined();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function disabledUpdates() {
  return {
    getState: async () => ({ status: "disabled" as const }),
    download: async () => ({ status: "disabled" as const }),
    install: async () => ({ status: "disabled" as const }),
    subscribe: () => () => undefined,
  };
}
