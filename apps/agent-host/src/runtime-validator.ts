import { readFileSync } from "node:fs";

import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

import type { ServerNotification } from "../generated/codex/ts/ServerNotification.js";
import type { InitializeResponse } from "../generated/codex/ts/InitializeResponse.js";
import type { GetAccountResponse } from "../generated/codex/ts/v2/GetAccountResponse.js";
import type { LoginAccountResponse } from "../generated/codex/ts/v2/LoginAccountResponse.js";
import type { ModelListResponse } from "../generated/codex/ts/v2/ModelListResponse.js";
import type { ThreadStartResponse } from "../generated/codex/ts/v2/ThreadStartResponse.js";
import type { ThreadResumeResponse } from "../generated/codex/ts/v2/ThreadResumeResponse.js";
import type { TurnStartResponse } from "../generated/codex/ts/v2/TurnStartResponse.js";

const serverRequestSchemaPath = new URL(
  "../../generated/codex/schema/ServerRequest.json",
  import.meta.url,
);

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
  formats: {
    double: true,
    int32: true,
    int64: true,
    uint: true,
    uint16: true,
    uint32: true,
    uint64: true,
  },
});

const validateServerRequestSchema = ajv.compile(
  JSON.parse(readFileSync(serverRequestSchemaPath, "utf8")),
) as ValidateFunction;
const validateServerNotificationSchema = compileSchema(
  "../../generated/codex/schema/ServerNotification.json",
);
const validateInitializeResponseSchema = compileSchema(
  "../../generated/codex/schema/v1/InitializeResponse.json",
);
const validateGetAccountResponseSchema = compileSchema(
  "../../generated/codex/schema/v2/GetAccountResponse.json",
);
const validateLoginAccountResponseSchema = compileSchema(
  "../../generated/codex/schema/v2/LoginAccountResponse.json",
);
const validateThreadStartResponseSchema = compileSchema(
  "../../generated/codex/schema/v2/ThreadStartResponse.json",
);
const validateThreadResumeResponseSchema = compileSchema(
  "../../generated/codex/schema/v2/ThreadResumeResponse.json",
);
const validateTurnStartResponseSchema = compileSchema(
  "../../generated/codex/schema/v2/TurnStartResponse.json",
);
const validateModelListResponseSchema = compileSchema(
  "../../generated/codex/schema/v2/ModelListResponse.json",
);

export class ProtocolValidationError extends Error {
  readonly errors: ErrorObject[];

  constructor(message: string, errors: ErrorObject[] = []) {
    super(message);
    this.name = "ProtocolValidationError";
    this.errors = errors;
  }
}

export function validateServerRequest(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolValidationError("Codex ServerRequest envelope must be an object.");
  }
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["id", "method", "params"])) {
    throw new ProtocolValidationError("Codex ServerRequest envelope contains unexpected fields.");
  }
  if (!validateServerRequestSchema(value)) {
    throw new ProtocolValidationError(
      "Codex ServerRequest failed runtime schema validation.",
      validateServerRequestSchema.errors ?? [],
    );
  }
}

export function validateServerNotification(value: unknown): asserts value is ServerNotification {
  validateWithSchema(value, validateServerNotificationSchema, "Codex ServerNotification");
}

export function validateInitializeResponse(value: unknown): asserts value is InitializeResponse {
  validateWithSchema(value, validateInitializeResponseSchema, "Codex InitializeResponse");
}

export function validateGetAccountResponse(value: unknown): asserts value is GetAccountResponse {
  validateWithSchema(value, validateGetAccountResponseSchema, "Codex GetAccountResponse");
}

export function validateLoginAccountResponse(value: unknown): asserts value is LoginAccountResponse {
  validateWithSchema(value, validateLoginAccountResponseSchema, "Codex LoginAccountResponse");
}

export function validateThreadStartResponse(value: unknown): asserts value is ThreadStartResponse {
  validateWithSchema(value, validateThreadStartResponseSchema, "Codex ThreadStartResponse");
}

export function validateThreadResumeResponse(value: unknown): asserts value is ThreadResumeResponse {
  validateWithSchema(value, validateThreadResumeResponseSchema, "Codex ThreadResumeResponse");
}

export function validateTurnStartResponse(value: unknown): asserts value is TurnStartResponse {
  validateWithSchema(value, validateTurnStartResponseSchema, "Codex TurnStartResponse");
}

export function validateModelListResponse(value: unknown): asserts value is ModelListResponse {
  validateWithSchema(value, validateModelListResponseSchema, "Codex ModelListResponse");
}

function compileSchema(relativePath: string): ValidateFunction {
  const schema = JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as Record<string, unknown>;
  if (schema.properties !== undefined && schema.type === undefined) schema.type = "object";
  return ajv.compile(schema) as ValidateFunction;
}

function validateWithSchema(value: unknown, validator: ValidateFunction, label: string): void {
  if (!validator(value)) {
    throw new ProtocolValidationError(`${label} failed runtime schema validation.`, validator.errors ?? []);
  }
}
