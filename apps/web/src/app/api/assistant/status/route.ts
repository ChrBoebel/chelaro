import { proxyFinanceAssistantJson } from "@/lib/finance-assistant-route";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return proxyFinanceAssistantJson(request, "/v1/status", "GET");
}
