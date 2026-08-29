import {
  isUuid,
  jsonError,
  proxyFinanceMutation,
} from "@/lib/finance-route";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: RouteContext<"/api/change-proposals/[id]/reject">,
): Promise<Response> {
  const { id } = await context.params;
  if (!isUuid(id)) {
    return jsonError(422, "invalid_proposal_id", "Ungültige Vorschlags-ID.");
  }
  return proxyFinanceMutation(
    request,
    `/api/v1/change-proposals/${encodeURIComponent(id)}/reject`,
  );
}
