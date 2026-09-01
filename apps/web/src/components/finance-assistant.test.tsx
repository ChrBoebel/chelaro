import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FinanceAssistant } from "./finance-assistant";

const baseSnapshot = {
  appServer: "ready",
  auth: "logged_out",
  consent: { status: "unknown", version: null },
  host: "ready",
  models: {
    available: [
      { efforts: ["low", "medium", "high"], model: "gpt-5.6-luna", supportsFastMode: true },
      { efforts: ["low", "medium", "high"], model: "gpt-5.5", supportsFastMode: true },
      { efforts: ["low", "medium", "high"], model: "gpt-5.4-mini", supportsFastMode: false },
    ],
    selected: { effort: "medium", fastMode: false, model: "gpt-5.6-luna" },
  },
  provider: { status: "ready", supportedVersions: ["0.152.0"], version: "0.152.0" },
  session: null,
  turn: null,
  usage: null,
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
            consent: { status: "granted", version: "2026-08-31.v2" },
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

    expect(await screen.findByRole("heading", { name: "Codex-Anmeldung erforderlich" })).toBeDefined();
    expect(screen.getByText("codex login")).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assistant/consent/grant",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rechecks the installed Codex CLI instead of starting a separate login", async () => {
    const consented = {
      ...baseSnapshot,
      consent: { status: "granted", version: "2026-08-31.v2" },
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/provider/refresh")) {
        return jsonResponse({ snapshot: { ...consented, auth: "authenticated" } });
      }
      return jsonResponse({ snapshot: consented });
    }));

    render(<FinanceAssistant />);
    fireEvent.click(await screen.findByRole("button", { name: "Status erneut prüfen" }));
    expect(await screen.findByRole("heading", { name: "Beginne eine private Unterhaltung." })).toBeDefined();
  });

  it("keeps the workspace usable when Codex is not installed", async () => {
    const unavailable = {
      ...baseSnapshot,
      appServer: "stopped",
      consent: { status: "granted", version: "2026-08-31.v2" },
      provider: { status: "not_found", supportedVersions: ["0.152.0"], version: null },
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ snapshot: unavailable })));
    render(<FinanceAssistant />);
    expect(await screen.findByRole("heading", { name: "Codex wurde nicht gefunden" })).toBeDefined();
    expect(screen.getByText(/übrigen Finanzfunktionen bleiben nutzbar/)).toBeDefined();
  });

  it("names the supported Codex version the host reports instead of a literal", async () => {
    const unsupported = {
      ...baseSnapshot,
      appServer: "stopped",
      consent: { status: "granted", version: "2026-08-31.v2" },
      provider: { status: "unsupported", supportedVersions: ["9.9.9"], version: "0.1.0" },
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ snapshot: unsupported })));
    render(<FinanceAssistant />);
    expect(await screen.findByRole("heading", { name: "Codex-Version wird nicht unterstützt" })).toBeDefined();
    expect(screen.getByText(/Installiert ist 0\.1\.0; Chelaro benötigt die geprüfte Codex CLI 9\.9\.9\./)).toBeDefined();
    expect(screen.getByText("npm install -g @openai/codex@9.9.9")).toBeDefined();
  });

  it("streams bound plain-text finance answers and keeps mutations review-only", async () => {
    const sessionId = "session_test_1";
    const authenticated = {
      ...baseSnapshot,
      auth: "authenticated",
      consent: { status: "granted", version: "2026-08-31.v2" },
      session: { conversationId: null, id: sessionId, status: "ready" },
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

  it("shows complete local history even when the Codex host is unavailable", async () => {
    const conversationId = "123e4567-e89b-42d3-a456-426614174000";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/assistant/conversations")) {
        return jsonResponse({
          data: [{
            id: conversationId,
            message_count: 2,
            status: "active",
            title: "Gespeicherter Testchat",
            updated_at: "2026-08-31T12:00:00Z",
            version: 3,
          }],
        });
      }
      if (url.endsWith(`/conversations/${conversationId}/messages`)) {
        return jsonResponse({
          data: [
            { id: "message-user", role: "user", status: "complete", text: "Lokale Frage" },
            { id: "message-answer", role: "assistant", status: "complete", text: "Lokale Antwort" },
          ],
          next_before_sequence: null,
        });
      }
      return jsonResponse({ error: { code: "assistant_unavailable" } }, 503);
    }));

    render(<FinanceAssistant />);

    expect(await screen.findByText("Gespeicherter Testchat")).toBeDefined();
    expect(await screen.findByText("Lokale Frage")).toBeDefined();
    expect(screen.getByText("Lokale Antwort")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Finanzassistent nicht verfügbar." })).toBeDefined();
  });

  it("keeps local history readable while the shared Codex account is logged out", async () => {
    const conversationId = "123e4567-e89b-42d3-a456-426614174001";
    const loggedOut = {
      ...baseSnapshot,
      consent: { status: "granted", version: "2026-08-31.v2" },
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/assistant/conversations")) {
        return jsonResponse({
          data: [{
            id: conversationId,
            message_count: 1,
            status: "active",
            title: "Offline lesbarer Testchat",
            updated_at: "2026-08-31T12:00:00Z",
            version: 2,
          }],
        });
      }
      if (url.endsWith(`/conversations/${conversationId}/messages`)) {
        return jsonResponse({
          data: [{
            id: "message-offline",
            role: "assistant",
            status: "complete",
            text: "Lokal gespeicherte Antwort",
          }],
          next_before_sequence: null,
        });
      }
      return jsonResponse({ snapshot: loggedOut });
    }));

    render(<FinanceAssistant />);

    expect(await screen.findByRole("heading", { name: "Codex-Anmeldung erforderlich" })).toBeDefined();
    expect(await screen.findByText("Lokal gespeicherte Antwort")).toBeDefined();
  });

  it("offers the suggestions as controls and shows the bound configuration while chatting", async () => {
    const authenticated = {
      ...baseSnapshot,
      auth: "authenticated",
      consent: { status: "granted", version: "2026-08-31.v2" },
      models: {
        ...baseSnapshot.models,
        selected: { effort: "high", fastMode: true, model: "gpt-5.5" },
      },
      session: { conversationId: null, id: "session_test_2", status: "ready" },
      usage: { compactions: 2, contextWindow: 200_000, totalTokens: 40_000, usedTokens: 50_000 },
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ snapshot: authenticated })));

    render(<FinanceAssistant />);

    // The configuration is bound for the whole conversation, so it stays
    // readable after the picker is gone.
    expect(await screen.findByText("gpt-5.5")).toBeDefined();
    expect(screen.getByText(/Fast Mode/)).toBeDefined();
    expect(screen.getByText(/Kontext 25 %/)).toBeDefined();
    expect(screen.getByText(/2× verdichtet/)).toBeDefined();

    const suggestion = screen.getByRole("button", { name: "Wie war mein Monat?" });
    fireEvent.click(suggestion);
    const prompt = screen.getByLabelText("Frage an den Finanzassistenten");
    expect((prompt as HTMLTextAreaElement).value).toBe("Wie war mein Monat?");
  });

  it("offers the newest verified model first and preselects it", async () => {
    const authenticated = {
      ...baseSnapshot,
      auth: "authenticated",
      consent: { status: "granted", version: "2026-08-31.v2" },
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ snapshot: authenticated })));

    render(<FinanceAssistant />);

    const picker = await screen.findByLabelText("Modell");
    // The host orders the catalog newest first; an owner starting a
    // conversation must not land on an older model by accident.
    expect([...(picker as HTMLSelectElement).options].map((option) => option.value)).toEqual([
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4-mini",
    ]);
    expect((picker as HTMLSelectElement).value).toBe("gpt-5.6-luna");
  });

  it("names the reason a rejected action failed instead of suggesting a retry", async () => {
    const authenticated = {
      ...baseSnapshot,
      auth: "authenticated",
      consent: { status: "granted", version: "2026-08-31.v2" },
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/assistant/conversations")) {
        return init?.method === "POST"
          ? jsonResponse({
              data: {
                id: "123e4567-e89b-42d3-a456-426614174002",
                message_count: 0,
                status: "active",
                title: "Neue Unterhaltung",
                updated_at: "2026-09-01T12:00:00Z",
                version: 1,
              },
            }, 201)
          : jsonResponse({ data: [] });
      }
      if (url.endsWith("/api/assistant/sessions")) {
        return jsonResponse({ error: { code: "model_not_available" } }, 409);
      }
      return jsonResponse({ snapshot: authenticated });
    }));

    render(<FinanceAssistant />);
    const [startButton] = await screen.findAllByRole("button", { name: "Neue Unterhaltung" });
    fireEvent.click(startButton);

    expect(await screen.findByText(/Das gewählte Modell bietet Codex gerade nicht an/)).toBeDefined();
  });

  it("continues a selected local conversation with its exact conversation id", async () => {
    const conversationId = "123e4567-e89b-42d3-a456-426614174000";
    const authenticated = {
      ...baseSnapshot,
      auth: "authenticated",
      consent: { status: "granted", version: "2026-08-31.v2" },
    };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/assistant/conversations")) {
        return jsonResponse({
          data: [{
            id: conversationId,
            message_count: 1,
            status: "active",
            title: "Fortsetzbarer Testchat",
            updated_at: "2026-08-31T12:00:00Z",
            version: 2,
          }],
        });
      }
      if (url.endsWith(`/conversations/${conversationId}/messages`)) {
        return jsonResponse({ data: [], next_before_sequence: null });
      }
      if (url.endsWith("/api/assistant/sessions")) {
        return jsonResponse({
          snapshot: {
            ...authenticated,
            session: { conversationId, id: "session_test", status: "ready" },
          },
        }, 201);
      }
      return jsonResponse({ snapshot: authenticated });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FinanceAssistant />);
    fireEvent.click(await screen.findByRole("button", { name: "Unterhaltung fortsetzen" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/assistant/sessions",
      expect.objectContaining({
        body: expect.stringContaining(`"conversation_id":"${conversationId}"`),
        method: "POST",
      }),
    ));

    const sessionCall = (
      fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>
    ).find(([url]) => typeof url === "string" && url.endsWith("/api/assistant/sessions"));
    // The renderer must name the configuration explicitly; an absent selection
    // would let the host fall back instead of binding a verified one.
    expect(JSON.parse(String(sessionCall?.[1]?.body)).model_selection).toEqual({
      effort: "medium",
      fast_mode: false,
      model: "gpt-5.6-luna",
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
