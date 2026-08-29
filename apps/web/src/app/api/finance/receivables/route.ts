import {
  proxyFinanceJson,
  proxyFinanceMutation,
} from "@/lib/finance-route";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const includePaid = new URL(request.url).searchParams.get("include_paid");
  const suffix = includePaid === null ? "" : `?include_paid=${encodeURIComponent(includePaid)}`;
  return proxyFinanceJson(`/api/v1/finance/receivables${suffix}`);
}

export async function POST(request: Request): Promise<Response> {
  return proxyFinanceMutation(request, "/api/v1/finance/receivables");
}
