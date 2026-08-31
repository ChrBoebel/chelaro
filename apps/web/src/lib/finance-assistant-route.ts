import "server-only";

const MAX_JSON_BYTES = 70 * 1024;
const JSON_TIMEOUT_MS = 20_000;

export type FinanceAssistantJsonPath =
  | "/v1/status"
  | "/v1/consent/grant"
  | "/v1/consent/revoke"
  | "/v1/provider/refresh"
  | "/v1/models/refresh"
  | "/v1/sessions"
  | `/v1/sessions/${string}`
  | `/v1/conversations/${string}`
  | "/v1/turns"
  | "/v1/turns/interrupt";

type FinanceAssistantMethod = "GET" | "POST" | "DELETE";

export async function proxyFinanceAssistantJson(
  request: Request,
  path: FinanceAssistantJsonPath,
  method: FinanceAssistantMethod,
): Promise<Response> {
  if (!isTrustedSameOriginRequest(request)) return assistantError(403, "cross_origin_request");

  let body: string | undefined;
  if (method === "POST") {
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
      return assistantError(415, "json_required");
    }
    const read = await readBoundedRequest(request);
    if (read instanceof Response) return read;
    body = read;
  } else if (hasRequestBody(request)) {
    return assistantError(400, "unexpected_body");
  }

  try {
    const configuration = financeAssistantConfiguration();
    const upstream = await fetch(new URL(path, configuration.gatewayOrigin), {
      body,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${configuration.gatewayToken}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      method,
      redirect: "error",
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    });
    if (!upstream.headers.get("content-type")?.startsWith("application/json")) {
      return assistantError(502, "invalid_gateway_response");
    }
    const payload = await readBoundedResponse(upstream, MAX_JSON_BYTES);
    if (payload === undefined) return assistantError(502, "invalid_gateway_response");
    return new Response(payload, {
      headers: responseHeaders("application/json; charset=utf-8"),
      status: upstream.status,
    });
  } catch {
    return assistantError(503, "assistant_unavailable");
  }
}

export async function proxyFinanceAssistantEvents(request: Request): Promise<Response> {
  if (!isTrustedSameOriginRequest(request)) return assistantError(403, "cross_origin_request");
  const cursor = request.headers.get("last-event-id");
  if (cursor !== null && !/^[0-9]{1,16}$/.test(cursor)) {
    return assistantError(400, "invalid_cursor");
  }

  try {
    const configuration = financeAssistantConfiguration();
    const upstream = await fetch(new URL("/v1/events", configuration.gatewayOrigin), {
      cache: "no-store",
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${configuration.gatewayToken}`,
        ...(cursor === null ? {} : { "Last-Event-ID": cursor }),
      },
      redirect: "error",
      signal: request.signal,
    });
    if (!upstream.ok) {
      const payload = await readBoundedResponse(upstream, MAX_JSON_BYTES);
      return new Response(payload ?? JSON.stringify({ error: { code: "gateway_rejected" } }), {
        headers: responseHeaders("application/json; charset=utf-8"),
        status: upstream.status,
      });
    }
    if (
      !upstream.body ||
      !upstream.headers.get("content-type")?.startsWith("text/event-stream")
    ) {
      return assistantError(502, "invalid_gateway_response");
    }
    return new Response(upstream.body, {
      headers: responseHeaders("text/event-stream; charset=utf-8", true),
      status: 200,
    });
  } catch {
    return assistantError(503, "assistant_unavailable");
  }
}

export function isFinanceAssistantId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function financeAssistantConfiguration(): { gatewayOrigin: string; gatewayToken: string } {
  const rawOrigin = process.env.FINANCE_OS_FINANCE_GATEWAY_URL;
  const gatewayToken = process.env.FINANCE_OS_FINANCE_GATEWAY_TOKEN;
  if (
    !rawOrigin ||
    !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(rawOrigin) ||
    !gatewayToken ||
    !/^[a-f0-9]{64}$/.test(gatewayToken)
  ) {
    throw new Error("Finance assistant is not configured.");
  }
  const url = new URL(rawOrigin);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.port === "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) throw new Error("Finance assistant gateway must be an exact loopback origin.");
  return { gatewayOrigin: url.origin, gatewayToken };
}

function isTrustedSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
    const targetHost = forwardedHost || request.headers.get("host") || requestUrl.host;
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
    const targetProtocol = forwardedProtocol ? `${forwardedProtocol}:` : requestUrl.protocol;
    return originUrl.host === targetHost && originUrl.protocol === targetProtocol;
  } catch {
    return false;
  }
}

async function readBoundedRequest(request: Request): Promise<string | Response> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^[0-9]{1,10}$/.test(declared) || Number(declared) > MAX_JSON_BYTES)) {
    return assistantError(413, "payload_too_large");
  }
  let body: string | undefined;
  try {
    body = await readBoundedStream(request.body, MAX_JSON_BYTES);
  } catch {
    return assistantError(400, "invalid_json");
  }
  if (body === undefined) return assistantError(413, "payload_too_large");
  try {
    JSON.parse(body);
    return body;
  } catch {
    return assistantError(400, "invalid_json");
  }
}

async function readBoundedResponse(response: Response, limit: number): Promise<string | undefined> {
  return readBoundedStream(response.body, limit);
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<string | undefined> {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(merged);
}

function hasRequestBody(request: Request): boolean {
  return request.headers.has("transfer-encoding") || Number(request.headers.get("content-length") ?? 0) > 0;
}

function responseHeaders(contentType: string, streaming = false): Headers {
  const headers = new Headers({
    "Cache-Control": streaming ? "no-store, no-transform" : "no-store",
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  if (streaming) {
    headers.set("X-Accel-Buffering", "no");
  }
  return headers;
}

function assistantError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code } }), {
    headers: responseHeaders("application/json; charset=utf-8"),
    status,
  });
}
