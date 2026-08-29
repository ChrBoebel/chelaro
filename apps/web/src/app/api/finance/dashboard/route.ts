import { proxyFinanceJson } from "@/lib/finance-route";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const incoming = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  for (const key of ["period", "currency"] as const) {
    const value = incoming.get(key);
    if (value !== null) query.set(key, value);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return proxyFinanceJson(`/api/v1/finance/dashboard${suffix}`);
}
