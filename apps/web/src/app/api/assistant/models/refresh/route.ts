import { proxyFinanceAssistantJson } from "@/lib/finance-assistant-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return proxyFinanceAssistantJson(request, "/v1/models/refresh", "POST");
}
