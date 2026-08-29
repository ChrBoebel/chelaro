import {
  isUuid,
  jsonError,
  proxyFinanceMutation,
} from "@/lib/finance-route";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/banking/connections/[id]">,
): Promise<Response> {
  const { id } = await context.params;
  if (!isUuid(id)) {
    return jsonError(422, "invalid_bank_connection_id", "Ungültige Bankverbindungs-ID.");
  }
  return proxyFinanceMutation(
    request,
    `/api/v1/banking/connections/${encodeURIComponent(id)}`,
    "PATCH",
  );
}
