import { proxyFinanceJson, proxyFinanceMutation } from "@/lib/finance-route";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const suffix = status === "archived" ? "?status=archived" : "";
  return proxyFinanceJson(`/api/v1/assistant/conversations${suffix}`);
}

export function POST(request: Request): Promise<Response> {
  return proxyFinanceMutation(request, "/api/v1/assistant/conversations");
}
