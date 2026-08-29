import { proxyFinanceMutation } from "@/lib/finance-route";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return proxyFinanceMutation(request, "/api/v1/workbooks/invoices/change-sets");
}
