import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  proxyFinanceAssistantEvents,
  proxyFinanceAssistantJson,
} from "./finance-assistant-route";

const GATEWAY_TOKEN = "a".repeat(64);

describe("finance assistant same-origin proxy", () => {
  beforeEach(() => {
    vi.stubEnv("FINANCE_OS_FINANCE_GATEWAY_URL", "http://127.0.0.1:43123");
    vi.stubEnv("FINANCE_OS_FINANCE_GATEWAY_TOKEN", GATEWAY_TOKEN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("attaches the server-only capability and forwards only the explicit request body", async () => {
    const gatewayFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ snapshot: { state: "ready" } }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", gatewayFetch);
    const request = new Request("http://127.0.0.1:3000/api/assistant/turns", {
      body: JSON.stringify({ prompt: "Zeige meine Übersicht" }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:3000",
        "Sec-Fetch-Site": "same-origin",
      },
      method: "POST",
    });

    const response = await proxyFinanceAssistantJson(request, "/v1/turns", "POST");

    expect(response.status).toBe(202);
    const [url, init] = gatewayFetch.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:43123/v1/turns");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${GATEWAY_TOKEN}`);
    expect(new Headers(init?.headers).has("cookie")).toBe(false);
    expect(new Headers(init?.headers).has("origin")).toBe(false);
    expect(init?.body).toBe('{"prompt":"Zeige meine Übersicht"}');
    expect(await response.json()).toEqual({ snapshot: { state: "ready" } });
  });

  it("rejects cross-site requests before contacting the gateway", async () => {
    const gatewayFetch = vi.fn();
    vi.stubGlobal("fetch", gatewayFetch);
    const request = new Request("http://127.0.0.1:3000/api/assistant/consent/grant", {
      body: "{}",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
      },
      method: "POST",
    });

    const response = await proxyFinanceAssistantJson(request, "/v1/consent/grant", "POST");

    expect(response.status).toBe(403);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it("uses the validated forwarded origin when Next reconstructs an internal request URL", async () => {
    const gatewayFetch = vi.fn(async () => new Response(JSON.stringify({ snapshot: {} }), {
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", gatewayFetch);
    const request = new Request("http://next-internal:3000/api/assistant/consent/grant", {
      body: "{}",
      headers: {
        "Content-Type": "application/json",
        Host: "next-internal:3000",
        Origin: "http://127.0.0.1:3000",
        "Sec-Fetch-Site": "same-origin",
        "X-Forwarded-Host": "127.0.0.1:3000",
        "X-Forwarded-Proto": "http",
      },
      method: "POST",
    });

    const response = await proxyFinanceAssistantJson(request, "/v1/consent/grant", "POST");

    expect(response.status).toBe(200);
    expect(gatewayFetch).toHaveBeenCalledOnce();
  });

  it("fails closed for non-loopback or missing gateway configuration", async () => {
    vi.stubEnv("FINANCE_OS_FINANCE_GATEWAY_URL", "https://gateway.example");
    const gatewayFetch = vi.fn();
    vi.stubGlobal("fetch", gatewayFetch);

    const response = await proxyFinanceAssistantJson(
      new Request("http://127.0.0.1:3000/api/assistant/status"),
      "/v1/status",
      "GET",
    );

    expect(response.status).toBe(503);
    expect(gatewayFetch).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: { code: "assistant_unavailable" } });
  });

  it("streams SSE bytes without buffering and forwards only a numeric replay cursor", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController;
      },
    });
    const gatewayFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      });
    });
    vi.stubGlobal("fetch", gatewayFetch);
    const responsePromise = proxyFinanceAssistantEvents(
      new Request("http://127.0.0.1:3000/api/assistant/events", {
        headers: { "Last-Event-ID": "7", "Sec-Fetch-Site": "same-origin" },
      }),
    );
    const response = await responsePromise;
    const reader = response.body!.getReader();
    const firstRead = reader.read();
    controller!.enqueue(new TextEncoder().encode("id: 8\ndata: {}\n\n"));

    const firstChunk = await firstRead;

    expect(new TextDecoder().decode(firstChunk.value)).toBe("id: 8\ndata: {}\n\n");
    expect(new Headers(gatewayFetch.mock.calls[0][1]?.headers).get("last-event-id")).toBe("7");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    await reader.cancel();
    controller = undefined;
  });

  it("rejects oversized JSON before the request crosses the trust boundary", async () => {
    const gatewayFetch = vi.fn();
    vi.stubGlobal("fetch", gatewayFetch);
    const request = new Request("http://127.0.0.1:3000/api/assistant/turns", {
      body: JSON.stringify({ prompt: "x".repeat(129 * 1024) }),
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
      method: "POST",
    });

    const response = await proxyFinanceAssistantJson(request, "/v1/turns", "POST");

    expect(response.status).toBe(413);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });
});
