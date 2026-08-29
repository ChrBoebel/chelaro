import { proxyFinanceJson } from "@/lib/finance-route";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const pendingOnly = new URL(request.url).searchParams.get("pending_only");
  const suffix = pendingOnly === null
    ? ""
    : `?pending_only=${encodeURIComponent(pendingOnly)}`;
  return proxyFinanceJson(`/api/v1/finance/change-proposals${suffix}`);
}
