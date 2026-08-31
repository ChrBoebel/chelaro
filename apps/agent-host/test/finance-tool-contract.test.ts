import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FINANCE_DYNAMIC_TOOLS,
  FINANCE_TOOL_NAMES,
  FinanceToolContractError,
  financeToolContractDigest,
  validateFinanceToolCall,
} from "../src/finance-tool-contract.js";

const receivableId = "123e4567-e89b-42d3-a456-426614174000";

test("publishes exactly eight directly callable bounded finance tools", () => {
  assert.equal(FINANCE_DYNAMIC_TOOLS.length, FINANCE_TOOL_NAMES.length);
  assert.deepEqual(FINANCE_DYNAMIC_TOOLS.map(({ name }) => name), FINANCE_TOOL_NAMES);
  assert.match(financeToolContractDigest(), /^[a-f0-9]{64}$/);
  for (const definition of FINANCE_DYNAMIC_TOOLS) {
    assert.equal(definition.type, "function");
    if (definition.type !== "function") assert.fail("Expected a directly callable finance function");
    assert.equal((definition.inputSchema as { additionalProperties?: boolean }).additionalProperties, false);
  }
});

test("accepts valid read and proposal arguments", () => {
  assert.deepEqual(
    validateFinanceToolCall(null, "finance_get_overview", {
      currency: "EUR",
      period: "2026-08",
    }),
    {
      name: "finance_get_overview",
      arguments: { currency: "EUR", period: "2026-08" },
    },
  );
  assert.equal(
    validateFinanceToolCall(null, "finance_propose_receivable_create", {
      currency: "EUR",
      debtor_name: "Synthetische Person",
      description: "Synthetisches Privatdarlehen",
      original_amount: "3000.00",
      rationale: "Die neue Forderung soll geprüft werden.",
    }).name,
    "finance_propose_receivable_create",
  );
  assert.equal(
    validateFinanceToolCall(null, "finance_propose_payment_record", {
      expected_version: 2,
      payment: {
        amount: "12.50",
        booked_on: "2026-08-28",
        payment_method: "bank_transfer",
        purpose: "Synthetische Teilzahlung",
      },
      rationale: "Die synthetische Zahlung soll geprüft werden.",
      receivable_id: receivableId,
    }).name,
    "finance_propose_payment_record",
  );
});

test("rejects namespace calls, extra fields, floats, and malformed money", () => {
  assert.throws(
    () => validateFinanceToolCall("terminal", "finance_get_overview", {}),
    (error: unknown) => error instanceof FinanceToolContractError && error.code === "unknown_tool",
  );
  for (const argumentsValue of [
    { limit: 1, secret: "unexpected" },
    { limit: 1.5 },
    { limit: 51 },
  ]) {
    assert.throws(
      () => validateFinanceToolCall(null, "finance_list_transactions", argumentsValue),
      (error: unknown) => error instanceof FinanceToolContractError && error.code === "invalid_arguments",
    );
  }
  assert.throws(
    () => validateFinanceToolCall(null, "finance_propose_receivable_update", {
      changes: { original_amount: "12.5" },
      expected_version: 1,
      rationale: "Ungültiges Geldformat",
      receivable_id: receivableId,
    }),
    FinanceToolContractError,
  );
  for (const argumentsValue of [
    {
      currency: "EUR",
      debtor_name: "Synthetische Person",
      description: "Synthetisches Privatdarlehen",
      original_amount: "3000",
      rationale: "Ungültiges Geldformat",
    },
    {
      currency: "EUR",
      debtor_name: "Synthetische Person",
      original_amount: "3000.00",
      rationale: "Fehlende Beschreibung",
    },
    {
      currency: "EUR",
      debtor_name: "Synthetische Person",
      description: "Synthetisches Privatdarlehen",
      original_amount: "3000.00",
      rationale: "Unerlaubtes Feld",
      secret: "unexpected",
    },
  ]) {
    assert.throws(
      () => validateFinanceToolCall(
        null,
        "finance_propose_receivable_create",
        argumentsValue,
      ),
      FinanceToolContractError,
    );
  }
});

test("rejects oversized and non-object arguments", () => {
  assert.throws(
    () => validateFinanceToolCall(null, "finance_get_overview", "not-an-object"),
    FinanceToolContractError,
  );
  assert.throws(
    () => validateFinanceToolCall(null, "finance_get_overview", {
      currency: "A".repeat(17_000),
    }),
    (error: unknown) =>
      error instanceof FinanceToolContractError && error.code === "arguments_too_large",
  );
});
