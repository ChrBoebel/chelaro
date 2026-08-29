import {
  FinanceApiConfigurationError,
  financeApiFetch,
} from "@/lib/finance-api";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/documents/[id]/content">,
): Promise<Response> {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return Response.json(
      { error: { code: "invalid_document_id", message: "Ungültige Beleg-ID." } },
      { status: 422 },
    );
  }

  try {
    const upstream = await financeApiFetch(
      `/api/v1/documents/${encodeURIComponent(id)}/content`,
    );
    const headers = new Headers({ "Cache-Control": "no-store" });
    for (const name of [
      "content-disposition",
      "content-length",
      "content-type",
      "x-request-id",
    ] as const) {
      const value = upstream.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    const code =
      error instanceof FinanceApiConfigurationError
        ? "api_not_configured"
        : "api_unavailable";
    return Response.json(
      {
        error: {
          code,
          message: "Der Beleg kann gerade nicht geladen werden.",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
