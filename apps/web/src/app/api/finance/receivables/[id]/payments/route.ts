import {
  isUuid,
  jsonError,
  proxyFinanceMutation,
} from "@/lib/finance-route";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: RouteContext<"/api/finance/receivables/[id]/payments">,
): Promise<Response> {
  const { id } = await context.params;
  if (!isUuid(id)) {
    return jsonError(422, "invalid_receivable_id", "Ungültige Forderungs-ID.");
  }
  return proxyFinanceMutation(
    request,
    `/api/v1/finance/receivables/${encodeURIComponent(id)}/payments`,
  );
}
