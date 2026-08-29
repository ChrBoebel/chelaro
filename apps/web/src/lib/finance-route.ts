import "server-only";

import {
  FinanceApiConfigurationError,
  financeApiFetch,
} from "@/lib/finance-api";

const MAX_JSON_BYTES = 128 * 1024;

export async function proxyFinanceJson(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    const upstream = await financeApiFetch(path, init);
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    });
    const requestId = upstream.headers.get("x-request-id");
    if (requestId) headers.set("x-request-id", requestId);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    const code =
      error instanceof FinanceApiConfigurationError
        ? "api_not_configured"
        : "api_unavailable";
    return jsonError(
      503,
      code,
      "Der lokale Finanzdienst ist gerade nicht erreichbar.",
    );
  }
}

export async function proxyFinanceMutation(
  request: Request,
  path: string,
  method: "POST" | "PATCH" = "POST",
): Promise<Response> {
  if (!isSameOriginMutation(request)) {
    return jsonError(403, "cross_origin_request", "Anfrage nicht erlaubt.");
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return jsonError(415, "json_required", "JSON-Daten werden erwartet.");
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_JSON_BYTES) {
    return jsonError(413, "payload_too_large", "Die Änderung ist zu groß.");
  }
  try {
    JSON.parse(body);
  } catch {
    return jsonError(400, "invalid_json", "Die JSON-Daten sind ungültig.");
  }
  return proxyFinanceJson(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body,
  });
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  if (origin === null) return true;

  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    const forwardedHost = request.headers
      .get("x-forwarded-host")
      ?.split(",", 1)[0]
      ?.trim();
    const targetHost = forwardedHost || request.headers.get("host") || requestUrl.host;
    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",", 1)[0]
      ?.trim();
    const targetProtocol = forwardedProtocol
      ? `${forwardedProtocol}:`
      : requestUrl.protocol;
    return originUrl.host === targetHost && originUrl.protocol === targetProtocol;
  } catch {
    return false;
  }
}

export function jsonError(
  status: number,
  code: string,
  message: string,
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
