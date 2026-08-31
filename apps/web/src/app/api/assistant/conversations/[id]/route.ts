import {
  isSameOriginMutation,
  isUuid,
  jsonError,
  proxyFinanceJson,
  proxyFinanceMutation,
} from "@/lib/finance-route";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  const id = await conversationId(context);
  return id
    ? proxyFinanceJson(`/api/v1/assistant/conversations/${id}`)
    : jsonError(404, "not_found", "Unterhaltung nicht gefunden.");
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const id = await conversationId(context);
  return id
    ? proxyFinanceMutation(request, `/api/v1/assistant/conversations/${id}`, "PATCH")
    : jsonError(404, "not_found", "Unterhaltung nicht gefunden.");
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const id = await conversationId(context);
  if (!id) return jsonError(404, "not_found", "Unterhaltung nicht gefunden.");
  if (!isSameOriginMutation(request)) {
    return jsonError(403, "cross_origin_request", "Anfrage nicht erlaubt.");
  }
  return proxyFinanceJson(`/api/v1/assistant/conversations/${id}`, { method: "DELETE" });
}

async function conversationId(context: Context): Promise<string | null> {
  const { id } = await context.params;
  return isUuid(id) ? encodeURIComponent(id) : null;
}
