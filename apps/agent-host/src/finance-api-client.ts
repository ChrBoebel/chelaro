import Ajv, { type AnySchema, type ValidateFunction } from "ajv";

import type { JsonValue } from "../generated/codex/ts/serde_json/JsonValue.js";
import type { FinanceToolName } from "./finance-tool-contract.js";

export const MAX_FINANCE_API_RESPONSE_BYTES = 60 * 1024;
export const FINANCE_API_TIMEOUT_MS = 10_000;

const proposalTools = new Set<FinanceToolName>([
  "finance_propose_receivable_create",
  "finance_propose_receivable_update",
  "finance_propose_payment_record",
  "finance_propose_payment_reversal",
]);

export interface ProposalCorrelation {
  idempotencyKey: string;
  providerCallId: string;
  providerThreadId: string;
  providerTurnId: string;
}

export interface FinanceApiClientOptions {
  baseUrl: string;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
}

export class FinanceApiClient {
  readonly #baseUrl: URL;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  #token: string | undefined;

  constructor(options: FinanceApiClientOptions) {
    this.#baseUrl = validateLoopbackBaseUrl(options.baseUrl);
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#timeoutMs = positiveInteger(options.timeoutMs ?? FINANCE_API_TIMEOUT_MS, "timeout");
  }

  setCredential(token: string): void {
    if (this.#token !== undefined) throw new FinanceApiClientError("invalid_state");
    if (token.length < 16 || token.length > 512 || /[\r\n]/.test(token)) {
      throw new FinanceApiClientError("invalid_configuration");
    }
    this.#token = token;
  }

  clearCredential(): void {
    this.#token = undefined;
  }

  async call(
    name: FinanceToolName,
    argumentsValue: Record<string, JsonValue>,
    options: { correlation?: ProposalCorrelation; signal?: AbortSignal } = {},
  ): Promise<JsonValue> {
    const token = this.#token;
    if (!token) throw new FinanceApiClientError("invalid_state");
    const request = requestFor(name, argumentsValue, options.correlation);
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    if (request.body !== undefined) headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await this.#fetch(new URL(request.path, this.#baseUrl), {
        method: request.body === undefined ? "GET" : "POST",
        headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([
          ...(options.signal ? [options.signal] : []),
          AbortSignal.timeout(this.#timeoutMs),
        ]),
      });
    } catch {
      throw new FinanceApiClientError("unavailable");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw classifyHttpFailure(response.status);
    }
    if (response.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
      await response.body?.cancel().catch(() => undefined);
      throw new FinanceApiClientError("invalid_response");
    }
    const bytes = await readBounded(response.body, MAX_FINANCE_API_RESPONSE_BYTES);
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new FinanceApiClientError("invalid_response");
    }
    const validator = responseValidators.get(name);
    if (!validator?.(parsed)) throw new FinanceApiClientError("invalid_response");
    return parsed as JsonValue;
  }
}

export class FinanceApiClientError extends Error {
  readonly code:
    | "invalid_configuration"
    | "invalid_state"
    | "unavailable"
    | "invalid_request"
    | "unauthorized"
    | "rejected"
    | "stale"
    | "invalid_response"
    | "response_too_large";
  readonly httpStatus: number | undefined;

  constructor(code: FinanceApiClientError["code"], httpStatus?: number) {
    super("Finance API request failed.");
    this.name = "FinanceApiClientError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function classifyHttpFailure(status: number): FinanceApiClientError {
  if (status === 400 || status === 422) return new FinanceApiClientError("invalid_request", status);
  if (status === 401 || status === 403) return new FinanceApiClientError("unauthorized", status);
  if (status === 409) return new FinanceApiClientError("stale", status);
  if (status >= 500) return new FinanceApiClientError("unavailable", status);
  return new FinanceApiClientError("rejected", status);
}

function requestFor(
  name: FinanceToolName,
  values: Record<string, JsonValue>,
  correlation: ProposalCorrelation | undefined,
): { path: string; body?: string } {
  switch (name) {
    case "finance_get_overview": {
      const query = new URLSearchParams();
      if (typeof values.period === "string") query.set("period", values.period);
      if (typeof values.currency === "string") query.set("currency", values.currency);
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      return { path: `/api/v1/finance-assistant/overview${suffix}` };
    }
    case "finance_list_transactions":
      return {
        path: `/api/v1/finance-assistant/transactions?limit=${integerOr(values.limit, 50)}`,
      };
    case "finance_list_receivables": {
      const query = new URLSearchParams({
        include_paid: String(booleanOr(values.include_paid, true)),
        limit: String(integerOr(values.limit, 50)),
      });
      return { path: `/api/v1/finance-assistant/receivables?${query.toString()}` };
    }
    case "finance_get_receivable":
      return {
        path: `/api/v1/finance-assistant/receivables/${requiredString(values.receivable_id)}`,
      };
    case "finance_propose_receivable_create":
      return proposalRequest(name, values, correlation, {
        action: "receivable_create",
        receivable: {
          debtor_name: values.debtor_name,
          original_amount: values.original_amount,
          currency: values.currency,
          ...(values.due_date === undefined ? {} : { due_date: values.due_date }),
          description: values.description,
        },
      });
    case "finance_propose_receivable_update":
      return proposalRequest(name, values, correlation, {
        action: "receivable_update",
        changes: values.changes,
      });
    case "finance_propose_payment_record":
      return proposalRequest(name, values, correlation, {
        action: "payment_record",
        payment: values.payment,
      });
    case "finance_propose_payment_reversal":
      return proposalRequest(name, values, correlation, {
        action: "payment_reverse",
        payment_id: values.payment_id,
        reversal_reason: values.reversal_reason,
      });
  }
}

function proposalRequest(
  name: FinanceToolName,
  values: Record<string, JsonValue>,
  correlation: ProposalCorrelation | undefined,
  actionFields: Record<string, JsonValue | undefined>,
): { path: string; body: string } {
  if (!proposalTools.has(name) || !correlation) throw new FinanceApiClientError("invalid_state");
  return {
    path: "/api/v1/finance-assistant/proposals",
    body: JSON.stringify({
      ...(values.receivable_id === undefined ? {} : { receivable_id: values.receivable_id }),
      ...(values.expected_version === undefined ? {} : { expected_version: values.expected_version }),
      rationale: values.rationale,
      ...actionFields,
      idempotency_key: correlation.idempotencyKey,
      provider_thread_id: correlation.providerThreadId,
      provider_turn_id: correlation.providerTurnId,
      provider_call_id: correlation.providerCallId,
    }),
  };
}

function validateLoopbackBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FinanceApiClientError("invalid_configuration");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new FinanceApiClientError("invalid_configuration");
  }
  return url;
}

async function readBounded(
  stream: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!stream) throw new FinanceApiClientError("invalid_response");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new FinanceApiClientError("response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function requiredString(value: JsonValue | undefined): string {
  if (typeof value !== "string") throw new FinanceApiClientError("invalid_state");
  return value;
}

function integerOr(value: JsonValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
}

function booleanOr(value: JsonValue | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}

const uuid = {
  type: "string",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
};
const decimal = { type: "string", pattern: "^(0|[1-9][0-9]{0,15})\\.[0-9]{2}$" };
const currency = { type: "string", pattern: "^[A-Z]{3}$" };
const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const nullableUuid = { anyOf: [uuid, { type: "null" }] };
const nullablePositiveInteger = {
  anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
};
const date = { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])$" };
const dateTime = {
  type: "string",
  pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]+(?:Z|[+-][0-9]{2}:[0-9]{2})$",
  maxLength: 64,
};
const nullableDateTime = { anyOf: [dateTime, { type: "null" }] };

const transaction = exactObject(
  {
    id: uuid,
    direction: { enum: ["income", "expense"] },
    amount: decimal,
    currency,
    booked_on: date,
    counterparty: { type: "string", maxLength: 240 },
    category: { type: "string", maxLength: 120 },
    description: nullableString,
    receivable_id: nullableUuid,
  },
  [
    "id",
    "direction",
    "amount",
    "currency",
    "booked_on",
    "counterparty",
    "category",
    "description",
    "receivable_id",
  ],
);
const receivableProperties = {
  id: uuid,
  version: { type: "integer", minimum: 1 },
  debtor_name: { type: "string", maxLength: 240 },
  original_amount: decimal,
  received_amount: decimal,
  outstanding_amount: decimal,
  currency,
  due_date: { anyOf: [date, { type: "null" }] },
  description: { type: "string", maxLength: 2_000 },
  status: { enum: ["open", "partial", "paid", "overdue"] },
};
const receivableRequired = Object.keys(receivableProperties);
const receivable = exactObject(receivableProperties, receivableRequired);
const payment = exactObject(
  {
    id: uuid,
    amount: decimal,
    booked_on: date,
    purpose: { type: "string", maxLength: 2_000 },
    payment_method: { enum: ["bank_transfer", "cash", "paypal", "card", "other"] },
    note: nullableString,
    reversed_at: nullableDateTime,
  },
  ["id", "amount", "booked_on", "purpose", "payment_method", "note", "reversed_at"],
);
const event = exactObject(
  {
    event_type: { enum: ["created", "details_updated", "payment_recorded", "payment_reversed"] },
    created_at: dateTime,
  },
  ["event_type", "created_at"],
);
const detail = exactObject(
  {
    ...receivableProperties,
    payments: { type: "array", maxItems: 50, items: payment },
    history: { type: "array", maxItems: 50, items: event },
    pending_proposals: { type: "integer", minimum: 0 },
  },
  [...receivableRequired, "payments", "history", "pending_proposals"],
);
const proposal = exactObject(
  {
    id: uuid,
    action: { enum: ["receivable_create", "receivable_update", "payment_record", "payment_reverse"] },
    receivable_id: nullableUuid,
    debtor_name: { type: "string", maxLength: 240 },
    expected_version: nullablePositiveInteger,
    current_version: nullablePositiveInteger,
    status: { enum: ["pending", "approved", "rejected"] },
  },
  [
    "id",
    "action",
    "receivable_id",
    "debtor_name",
    "expected_version",
    "current_version",
    "status",
  ],
);
const dashboard = exactObject(
  {
    period: exactObject(
      {
        key: { type: "string", maxLength: 7 },
        label: { type: "string", maxLength: 64 },
        start: date,
        end: date,
      },
      ["key", "label", "start", "end"],
    ),
    summary: exactObject(
      {
        income: decimal,
        expenses: decimal,
        net: { type: "string", pattern: "^-?(0|[1-9][0-9]{0,15})\\.[0-9]{2}$" },
        outstanding_receivables: decimal,
        overdue_receivables: { type: "integer", minimum: 0 },
        pending_finance_proposals: { type: "integer", minimum: 0 },
        currency,
      },
      [
        "income",
        "expenses",
        "net",
        "outstanding_receivables",
        "overdue_receivables",
        "pending_finance_proposals",
        "currency",
      ],
    ),
    cashflow: {
      type: "array",
      maxItems: 12,
      items: exactObject(
        {
          month: { type: "string", maxLength: 7 },
          label: { type: "string", maxLength: 32 },
          income: decimal,
          expenses: decimal,
          net: { type: "string", pattern: "^-?(0|[1-9][0-9]{0,15})\\.[0-9]{2}$" },
        },
        ["month", "label", "income", "expenses", "net"],
      ),
    },
    open_receivables: { type: "array", maxItems: 20, items: receivable },
    recent_transactions: { type: "array", maxItems: 10, items: transaction },
  },
  ["period", "summary", "cashflow", "open_receivables", "recent_transactions"],
);

const responseSchemas = new Map<FinanceToolName, AnySchema>([
  ["finance_get_overview", envelope(dashboard)],
  ["finance_list_transactions", envelope({ type: "array", maxItems: 50, items: transaction })],
  ["finance_list_receivables", envelope({ type: "array", maxItems: 50, items: receivable })],
  ["finance_get_receivable", envelope(detail)],
  ["finance_propose_receivable_create", envelope(proposal)],
  ["finance_propose_receivable_update", envelope(proposal)],
  ["finance_propose_payment_record", envelope(proposal)],
  ["finance_propose_payment_reversal", envelope(proposal)],
]);
const responseAjv = new Ajv({ allErrors: false, strict: true });
const responseValidators = new Map<FinanceToolName, ValidateFunction>(
  [...responseSchemas].map(([name, schema]) => [name, responseAjv.compile(schema)]),
);

function envelope(data: AnySchema): AnySchema {
  return exactObject({ data }, ["data"]);
}

function exactObject(properties: Record<string, AnySchema>, required: string[]): AnySchema {
  return { type: "object", additionalProperties: false, properties, required };
}
