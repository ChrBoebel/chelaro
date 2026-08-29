import { proxyFinanceAssistantJson } from "@/lib/finance-assistant-route";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return proxyFinanceAssistantJson(request, "/v1/turns", "POST");
}
