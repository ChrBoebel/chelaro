import {
  proxyFinanceJson,
  proxyFinanceMutation,
} from "@/lib/finance-route";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return proxyFinanceJson("/api/v1/finance/transactions");
}

export async function POST(request: Request): Promise<Response> {
  return proxyFinanceMutation(request, "/api/v1/finance/transactions");
}
