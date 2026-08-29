import { proxyFinanceJson } from "@/lib/finance-route";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return proxyFinanceJson("/api/v1/banking/readiness");
}
