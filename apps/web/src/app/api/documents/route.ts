import {
  FinanceApiConfigurationError,
  financeApiFetch,
} from "@/lib/finance-api";
import { isSameOriginMutation } from "@/lib/finance-route";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const query = new URLSearchParams();

  for (const key of ["cursor", "limit"] as const) {
    const value = requestUrl.searchParams.get(key);
    if (value !== null) query.set(key, value);
  }

  return callApi(`/api/v1/documents?${query.toString()}`);
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginMutation(request)) {
    return errorResponse(403, "cross_origin_request", "Anfrage nicht erlaubt.");
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return errorResponse(413, "file_too_large", "Die Datei ist größer als 25 MB.");
  }

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return errorResponse(400, "invalid_form_data", "Die Upload-Daten sind ungültig.");
  }
  const file = incoming.get("file");
  if (!(file instanceof File)) {
    return errorResponse(422, "file_required", "Bitte wähle einen Beleg aus.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return errorResponse(413, "file_too_large", "Die Datei ist größer als 25 MB.");
  }

  const outgoing = new FormData();
  outgoing.set("file", file, file.name);
  return callApi("/api/v1/documents", {
    method: "POST",
    body: outgoing,
  });
}

async function callApi(path: string, init?: RequestInit): Promise<Response> {
  try {
    const upstream = await financeApiFetch(path, init);
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    });
    for (const name of ["location", "x-request-id"] as const) {
      const value = upstream.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    const code =
      error instanceof FinanceApiConfigurationError
        ? "api_not_configured"
        : "api_unavailable";
    return errorResponse(
      503,
      code,
      "Der lokale Finanzdienst ist gerade nicht erreichbar.",
    );
  }
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
