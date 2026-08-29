import { proxyFinanceAssistantEvents } from "@/lib/finance-assistant-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return proxyFinanceAssistantEvents(request);
}
