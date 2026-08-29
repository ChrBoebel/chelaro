import "server-only";

const DEFAULT_DEVELOPMENT_API_URL = "http://127.0.0.1:8000";
const DEFAULT_DEVELOPMENT_TOKEN = "development-only-change-me";

export class FinanceApiConfigurationError extends Error {}

export async function financeApiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { apiUrl, apiToken } = getFinanceApiConfiguration();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiToken}`);

  return fetch(new URL(path, apiUrl), {
    ...init,
    cache: "no-store",
    headers,
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
}

function getFinanceApiConfiguration(): {
  apiUrl: string;
  apiToken: string;
} {
  const apiUrl =
    process.env.FINANCE_OS_API_URL ?? DEFAULT_DEVELOPMENT_API_URL;
  const apiToken =
    process.env.FINANCE_OS_API_TOKEN ??
    (process.env.NODE_ENV === "development"
      ? DEFAULT_DEVELOPMENT_TOKEN
      : undefined);

  if (!apiToken) {
    throw new FinanceApiConfigurationError(
      "FINANCE_OS_API_TOKEN is not configured.",
    );
  }

  return { apiUrl, apiToken };
}
