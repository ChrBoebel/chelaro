import {
  isFinanceAssistantId,
  proxyFinanceAssistantJson,
} from "@/lib/finance-assistant-route";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/assistant/sessions/[id]">,
): Promise<Response> {
  const { id } = await context.params;
  if (!isFinanceAssistantId(id)) {
    return Response.json(
      { error: { code: "invalid_session_id" } },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }
  return proxyFinanceAssistantJson(
    request,
    `/v1/sessions/${encodeURIComponent(id)}`,
    "DELETE",
  );
}
