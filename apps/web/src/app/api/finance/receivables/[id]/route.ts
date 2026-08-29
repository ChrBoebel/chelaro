import {
  isUuid,
  jsonError,
  proxyFinanceJson,
  proxyFinanceMutation,
} from "@/lib/finance-route";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/finance/receivables/[id]">,
): Promise<Response> {
  const { id } = await context.params;
  if (!isUuid(id)) {
    return jsonError(422, "invalid_receivable_id", "Ungültige Forderungs-ID.");
  }
  return proxyFinanceJson(`/api/v1/finance/receivables/${encodeURIComponent(id)}`);
}

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/finance/receivables/[id]">,
): Promise<Response> {
  const { id } = await context.params;
  if (!isUuid(id)) {
    return jsonError(422, "invalid_receivable_id", "Ungültige Forderungs-ID.");
  }
  return proxyFinanceMutation(
    request,
    `/api/v1/finance/receivables/${encodeURIComponent(id)}`,
    "PATCH",
  );
}
