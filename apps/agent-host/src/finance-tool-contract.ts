import { createHash } from "node:crypto";

import Ajv, { type AnySchema, type ErrorObject, type ValidateFunction } from "ajv";

import type { JsonValue } from "../generated/codex/ts/serde_json/JsonValue.js";
import type { DynamicToolSpec } from "../generated/codex/ts/v2/DynamicToolSpec.js";

export const MAX_FINANCE_TOOL_ARGUMENT_BYTES = 16 * 1024;

export const FINANCE_TOOL_NAMES = [
  "finance_get_overview",
  "finance_list_transactions",
  "finance_list_receivables",
  "finance_get_receivable",
  "finance_propose_receivable_create",
  "finance_propose_receivable_update",
  "finance_propose_payment_record",
  "finance_propose_payment_reversal",
] as const;

export type FinanceToolName = (typeof FINANCE_TOOL_NAMES)[number];

type JsonSchema = AnySchema;

const uuidPattern = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const datePattern = "^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])$";
const periodPattern = "^[0-9]{4}-(0[1-9]|1[0-2])$";
const moneyPattern = "^(0|[1-9][0-9]{0,15})\\.[0-9]{2}$";
const currencyPattern = "^[A-Z]{3}$";

const text = (maxLength: number): JsonSchema => ({
  type: "string",
  minLength: 1,
  maxLength,
});

const toolDefinitions = [
  tool(
    "finance_get_overview",
    "Liest den begrenzten Finanzüberblick für einen Monat und eine ISO-Währung.",
    objectSchema(
      {
        period: { type: "string", pattern: periodPattern },
        currency: { type: "string", pattern: currencyPattern },
      },
      [],
    ),
  ),
  tool(
    "finance_list_transactions",
    "Listet höchstens 50 aktuelle, typisierte Einnahmen und Ausgaben.",
    objectSchema({ limit: { type: "integer", minimum: 1, maximum: 50 } }, []),
  ),
  tool(
    "finance_list_receivables",
    "Listet höchstens 50 offene oder bereits bezahlte Forderungen.",
    objectSchema(
      {
        include_paid: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      [],
    ),
  ),
  tool(
    "finance_get_receivable",
    "Liest eine Forderung mit begrenzter Zahlungs- und Ereignisübersicht.",
    objectSchema({ receivable_id: { type: "string", pattern: uuidPattern } }, ["receivable_id"]),
  ),
  tool(
    "finance_propose_receivable_create",
    "Erstellt nur einen prüfpflichtigen Vorschlag für eine neue Forderung.",
    objectSchema(
      {
        debtor_name: text(240),
        original_amount: { type: "string", pattern: moneyPattern },
        currency: { type: "string", pattern: currencyPattern },
        due_date: {
          anyOf: [{ type: "string", pattern: datePattern }, { type: "null" }],
        },
        description: text(2_000),
        rationale: text(2_000),
      },
      ["debtor_name", "original_amount", "currency", "description", "rationale"],
    ),
  ),
  tool(
    "finance_propose_receivable_update",
    "Erstellt nur einen prüfpflichtigen Vorschlag zur Änderung einer Forderung.",
    objectSchema(
      {
        receivable_id: { type: "string", pattern: uuidPattern },
        expected_version: { type: "integer", minimum: 1 },
        rationale: text(2_000),
        changes: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            debtor_name: text(240),
            original_amount: { type: "string", pattern: moneyPattern },
            due_date: {
              anyOf: [{ type: "string", pattern: datePattern }, { type: "null" }],
            },
            description: text(2_000),
          },
        },
      },
      ["receivable_id", "expected_version", "rationale", "changes"],
    ),
  ),
  tool(
    "finance_propose_payment_record",
    "Erstellt nur einen prüfpflichtigen Vorschlag für einen Zahlungseingang.",
    objectSchema(
      {
        receivable_id: { type: "string", pattern: uuidPattern },
        expected_version: { type: "integer", minimum: 1 },
        rationale: text(2_000),
        payment: objectSchema(
          {
            amount: { type: "string", pattern: moneyPattern },
            booked_on: { type: "string", pattern: datePattern },
            purpose: text(2_000),
            payment_method: {
              enum: ["bank_transfer", "cash", "paypal", "card", "other"],
            },
            note: { anyOf: [text(2_000), { type: "null" }] },
          },
          ["amount", "booked_on", "purpose", "payment_method"],
        ),
      },
      ["receivable_id", "expected_version", "rationale", "payment"],
    ),
  ),
  tool(
    "finance_propose_payment_reversal",
    "Erstellt nur einen prüfpflichtigen Vorschlag zur Stornierung einer Zahlung.",
    objectSchema(
      {
        receivable_id: { type: "string", pattern: uuidPattern },
        expected_version: { type: "integer", minimum: 1 },
        rationale: text(2_000),
        payment_id: { type: "string", pattern: uuidPattern },
        reversal_reason: text(2_000),
      },
      [
        "receivable_id",
        "expected_version",
        "rationale",
        "payment_id",
        "reversal_reason",
      ],
    ),
  ),
] as const satisfies readonly DynamicToolSpec[];

export const FINANCE_DYNAMIC_TOOLS: readonly DynamicToolSpec[] = deepFreeze(
  toolDefinitions.map((definition) => deepFreeze(definition)),
);
export const FINANCE_TOOL_CONTRACT_DIGEST = digestTools(FINANCE_DYNAMIC_TOOLS);

const ajv = new Ajv({ allErrors: false, strict: true });
const validators = new Map<FinanceToolName, ValidateFunction>(
  toolDefinitions.map((definition) => [
    definition.name,
    ajv.compile(definition.inputSchema as AnySchema),
  ]),
);

export function validateFinanceToolCall(
  namespace: string | null,
  name: string,
  argumentsValue: JsonValue,
): { name: FinanceToolName; arguments: Record<string, JsonValue> } {
  if (namespace !== null || !isFinanceToolName(name)) {
    throw new FinanceToolContractError("unknown_tool", "Finance tool is not allowlisted.");
  }
  const encoded = JSON.stringify(argumentsValue);
  if (Buffer.byteLength(encoded, "utf8") > MAX_FINANCE_TOOL_ARGUMENT_BYTES) {
    throw new FinanceToolContractError("arguments_too_large", "Finance tool arguments are too large.");
  }
  if (!isPlainObject(argumentsValue)) {
    throw new FinanceToolContractError("invalid_arguments", "Finance tool arguments must be an object.");
  }
  const validator = validators.get(name);
  if (!validator?.(argumentsValue)) {
    throw new FinanceToolContractError(
      "invalid_arguments",
      "Finance tool arguments failed validation.",
      validator?.errors ?? [],
    );
  }
  return { name, arguments: argumentsValue };
}

export function financeToolContractDigest(): string {
  return digestTools(FINANCE_DYNAMIC_TOOLS);
}

export class FinanceToolContractError extends Error {
  readonly code: "unknown_tool" | "arguments_too_large" | "invalid_arguments";
  readonly validationErrors: readonly ErrorObject[];

  constructor(
    code: FinanceToolContractError["code"],
    message: string,
    validationErrors: readonly ErrorObject[] = [],
  ) {
    super(message);
    this.name = "FinanceToolContractError";
    this.code = code;
    this.validationErrors = validationErrors;
  }
}

function tool(
  name: FinanceToolName,
  description: string,
  inputSchema: JsonSchema,
): Extract<DynamicToolSpec, { type: "function" }> & { name: FinanceToolName } {
  return { type: "function", name, description, inputSchema };
}

function objectSchema(
  properties: Record<string, JsonSchema>,
  required: readonly string[],
): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: [...required],
  };
}

function isFinanceToolName(value: string): value is FinanceToolName {
  return (FINANCE_TOOL_NAMES as readonly string[]).includes(value);
}

function isPlainObject(value: JsonValue): value is Record<string, JsonValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function digestTools(value: readonly DynamicToolSpec[]): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
