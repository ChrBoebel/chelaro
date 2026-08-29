import {
  isUuid,
  jsonError,
  proxyFinanceMutation,
} from "@/lib/finance-route";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: RouteContext<"/api/finance/receivables/[id]/payments/[paymentId]/reverse">,
): Promise<Response> {
  const { id, paymentId } = await context.params;
  if (!isUuid(id) || !isUuid(paymentId)) {
    return jsonError(422, "invalid_payment_id", "Ungültige Zahlungs-ID.");
  }
  return proxyFinanceMutation(
    request,
    `/api/v1/finance/receivables/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}/reverse`,
  );
}
