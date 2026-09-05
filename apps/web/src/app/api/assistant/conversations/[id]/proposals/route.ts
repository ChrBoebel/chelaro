import { isUuid, jsonError, proxyFinanceJson } from "@/lib/finance-route";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Unterhaltung nicht gefunden.");
  const requestUrl = new URL(request.url);
  const upstream = new URLSearchParams();
  const before = requestUrl.searchParams.get("before_id");
  if (before && /^\d{1,10}$/.test(before)) upstream.set("before_id", before);
  const suffix = upstream.size > 0 ? `?${upstream}` : "";
  return proxyFinanceJson(
    `/api/v1/assistant/conversations/${encodeURIComponent(id)}/proposals${suffix}`,
  );
}
