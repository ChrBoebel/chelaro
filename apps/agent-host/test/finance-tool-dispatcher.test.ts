import assert from "node:assert/strict";
import { test } from "node:test";

import type { JsonValue } from "../generated/codex/ts/serde_json/JsonValue.js";
import type { DynamicToolCallParams } from "../generated/codex/ts/v2/DynamicToolCallParams.js";
import { FinanceApiClientError } from "../src/finance-api-client.js";
import type { FinanceToolName } from "../src/finance-tool-contract.js";
import {
  FINANCE_SESSION_READ_LIMIT,
  FINANCE_TURN_READ_LIMIT,
  FinanceToolDispatcher,
  type FinanceConsentAuthority,
  type FinanceToolApi,
} from "../src/finance-tool-dispatcher.js";

const threadId = "thread_1";
const turnId = "turn_1";

test("dispatches only a bound allowlisted read and wraps data as an artifact", async () => {
  const api = new StubApi({ data: [] });
  const consent = new StubConsent();
  const dispatcher = activeDispatcher(api, consent);

  const result = await dispatcher.dispatch(call("call_1", "finance_list_transactions", { limit: 2 }));

  assert.equal(result.abortTurn, false);
  assert.equal(result.response.success, true);
  assert.deepEqual(JSON.parse(textOf(result)), {
    status: "ok",
    summary: "Die letzten Transaktionen wurden geladen.",
    next_actions: [],
    artifacts: [{
      type: "finance_projection",
      tool: "finance_list_transactions",
      data: { data: [] },
    }],
  });
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0]?.options?.correlation, undefined);
  assert.deepEqual(consent.checkedVersions, ["consent_v1", "consent_v1"]);
});

test("derives stable proposal correlation and returns an exactly-once retry", async () => {
  const api = new StubApi({ data: { id: "223e4567-e89b-42d3-a456-426614174000", status: "pending" } });
  const dispatcher = activeDispatcher(api, new StubConsent());
  const request = call("call_proposal", "finance_propose_payment_reversal", {
    receivable_id: "123e4567-e89b-42d3-a456-426614174000",
    expected_version: 2,
    rationale: "Synthetischer Testvorschlag",
    payment_id: "323e4567-e89b-42d3-a456-426614174000",
    reversal_reason: "Synthetischer Testgrund",
  });

  const first = await dispatcher.dispatch(request);
  const retry = await dispatcher.dispatch(request);

  assert.deepEqual(retry, first);
  assert.equal(api.calls.length, 1);
  assert.match(api.calls[0]?.options?.correlation?.idempotencyKey ?? "", /^[0-9a-f-]{36}$/);
  assert.deepEqual(api.calls[0]?.options?.correlation, {
    idempotencyKey: api.calls[0]?.options?.correlation?.idempotencyKey,
    providerCallId: "call_proposal",
    providerThreadId: threadId,
    providerTurnId: turnId,
  });
  assert.equal(JSON.parse(textOf(first)).artifacts[0].type, "finance_proposal");
});

test("rejects mismatched, unknown, malformed identifiers, and contradictory calls without touching the API", async () => {
  const api = new StubApi({ data: [] });
  const dispatcher = activeDispatcher(api, new StubConsent());

  const wrongThread = await dispatcher.dispatch({
    ...call("wrong_thread", "finance_list_transactions", {}),
    threadId: "foreign_thread",
  });
  const unknown = await dispatcher.dispatch({
    ...call("unknown", "finance_list_transactions", {}),
    namespace: "coding",
    tool: "shell",
  });
  const malformedIdentifier = await dispatcher.dispatch(call("not a valid call id", "finance_list_transactions", {}));
  const accepted = call("same_call", "finance_list_transactions", { limit: 1 });
  await dispatcher.dispatch(accepted);
  const contradictory = await dispatcher.dispatch({ ...accepted, arguments: { limit: 2 } });

  for (const result of [wrongThread, unknown, malformedIdentifier, contradictory]) {
    assert.equal(result.abortTurn, true);
    assert.equal(result.response.success, false);
  }
  assert.equal(api.calls.length, 1);
});

test("allows exactly one privacy-safe correction for invalid tool arguments", async () => {
  const api = new StubApi({ data: { id: "223e4567-e89b-42d3-a456-426614174000", status: "pending" } });
  const dispatcher = activeDispatcher(api, new StubConsent());
  const privateMarker = "PRIVATE_SYNTHETIC_MARKER";

  const first = await dispatcher.dispatch(call("malformed_1", "finance_propose_receivable_create", {
    debtor_name: privateMarker,
    original_amount: 500,
    currency: "EUR",
    description: "Synthetischer Zweck",
    rationale: "Synthetischer Vorschlag",
  }));

  assert.equal(first.abortTurn, false);
  assert.equal(first.response.success, false);
  assert.deepEqual(JSON.parse(textOf(first)), {
    status: "rejected",
    error_code: "invalid_arguments",
    summary: "Die Werkzeugargumente sind ungültig.",
    next_actions: [
      "Korrigiere den Aufruf genau einmal: Geldbeträge als Dezimalstring mit zwei Nachkommastellen, Währung als ISO-4217-Code und alle Pflichtfelder angeben.",
    ],
    artifacts: [],
  });
  assert.doesNotMatch(textOf(first), new RegExp(privateMarker));
  assert.equal(api.calls.length, 0);

  const second = await dispatcher.dispatch(call("malformed_2", "finance_propose_receivable_create", {
    debtor_name: privateMarker,
    original_amount: 500,
    currency: "EUR",
    description: "Synthetischer Zweck",
    rationale: "Synthetischer Vorschlag",
  }));

  assert.equal(second.abortTurn, true);
  assert.equal(second.response.success, false);
  assert.equal(JSON.parse(textOf(second)).error_code, "invalid_arguments_retry_exhausted");
  assert.doesNotMatch(textOf(second), new RegExp(privateMarker));
  assert.equal(api.calls.length, 0);
});

test("accepts a corrected proposal after invalid arguments without consuming its budget", async () => {
  const api = new StubApi({ data: { id: "223e4567-e89b-42d3-a456-426614174000", status: "pending" } });
  const dispatcher = activeDispatcher(api, new StubConsent());

  const malformed = await dispatcher.dispatch(call("malformed", "finance_propose_receivable_create", {
    debtor_name: "Synthetische Person",
    original_amount: 500,
    currency: "EUR",
    description: "Synthetischer Zweck",
    rationale: "Synthetischer Vorschlag",
  }));
  const corrected = await dispatcher.dispatch(call("corrected", "finance_propose_receivable_create", {
    debtor_name: "Synthetische Person",
    original_amount: "500.00",
    currency: "EUR",
    description: "Synthetischer Zweck",
    rationale: "Synthetischer Vorschlag",
  }));

  assert.equal(malformed.abortTurn, false);
  assert.equal(corrected.abortTurn, false);
  assert.equal(corrected.response.success, true);
  assert.equal(api.calls.length, 1);
});

test("releases the proposal budget for one correctable API rejection", async () => {
  let attempts = 0;
  const api: FinanceToolApi = {
    call: async () => {
      attempts += 1;
      if (attempts === 1) throw new FinanceApiClientError("invalid_request", 422);
      return { id: "223e4567-e89b-42d3-a456-426614174000", status: "pending" };
    },
  };
  const dispatcher = activeDispatcher(api, new StubConsent());
  const argumentsValue = {
    debtor_name: "Synthetische Person",
    original_amount: "500.00",
    currency: "EUR",
    description: "Synthetischer Zweck",
    rationale: "Synthetischer Vorschlag",
  };

  const rejected = await dispatcher.dispatch(call("api_rejected", "finance_propose_receivable_create", argumentsValue));
  const corrected = await dispatcher.dispatch(call("api_corrected", "finance_propose_receivable_create", argumentsValue));

  assert.equal(rejected.abortTurn, false);
  assert.equal(rejected.response.success, false);
  assert.equal(JSON.parse(textOf(rejected)).error_code, "api_rejected_422");
  assert.equal(corrected.abortTurn, false);
  assert.equal(corrected.response.success, true);
  assert.equal(attempts, 2);
});

test("checks consent both before and after access and withholds data after revocation", async () => {
  const api = new StubApi({ data: [{ counterparty: "Synthetische Gegenpartei" }] });
  const consent = new StubConsent(2);
  const dispatcher = activeDispatcher(api, consent);

  const result = await dispatcher.dispatch(call("revoked", "finance_list_transactions", {}));

  assert.equal(result.abortTurn, true);
  assert.equal(result.response.success, false);
  assert.doesNotMatch(textOf(result), /Gegenpartei/);
  assert.equal(api.calls.length, 1);
});

test("rejects a concurrent call and aborts an interrupted in-flight call", async () => {
  let release: (() => void) | undefined;
  const api = new StubApi({ data: [] }, () => new Promise<void>((resolve) => { release = resolve; }));
  const dispatcher = activeDispatcher(api, new StubConsent());

  const firstPromise = dispatcher.dispatch(call("slow", "finance_list_transactions", {}));
  await new Promise<void>((resolve) => setImmediate(resolve));
  const concurrent = await dispatcher.dispatch(call("concurrent", "finance_list_receivables", {}));
  assert.equal(concurrent.abortTurn, true);
  assert.equal(api.calls.length, 1);

  dispatcher.interruptTurn();
  release?.();
  const interrupted = await firstPromise;
  assert.equal(interrupted.abortTurn, true);
  assert.equal(interrupted.response.success, false);
});

test("enforces per-turn and cumulative session read budgets", async () => {
  const api = new StubApi({ data: [] });
  const dispatcher = activeDispatcher(api, new StubConsent());

  for (let index = 0; index < FINANCE_TURN_READ_LIMIT; index += 1) {
    assert.equal((await dispatcher.dispatch(call(`turn1_${index}`, "finance_list_transactions", {}))).abortTurn, false);
  }
  const turnOverflow = await dispatcher.dispatch(call("turn1_overflow", "finance_list_transactions", {}));
  assert.equal(turnOverflow.abortTurn, true);
  dispatcher.finishTurn();

  let issued = FINANCE_TURN_READ_LIMIT;
  for (let turn = 2; issued < FINANCE_SESSION_READ_LIMIT; turn += 1) {
    dispatcher.startTurn({ providerTurnId: `turn_${turn}` });
    for (let index = 0; index < FINANCE_TURN_READ_LIMIT && issued < FINANCE_SESSION_READ_LIMIT; index += 1) {
      const request = call(`session_${issued}`, "finance_list_transactions", {});
      request.turnId = `turn_${turn}`;
      assert.equal((await dispatcher.dispatch(request)).abortTurn, false);
      issued += 1;
    }
    dispatcher.finishTurn();
  }
  dispatcher.startTurn({ providerTurnId: "turn_final" });
  const request = call("session_overflow", "finance_list_transactions", {});
  request.turnId = "turn_final";
  const sessionOverflow = await dispatcher.dispatch(request);
  assert.equal(sessionOverflow.abortTurn, true);
  assert.equal(api.calls.length, FINANCE_SESSION_READ_LIMIT);
});

test("keeps proposal budgets separate from reads", async () => {
  const api = new StubApi({ data: { id: "223e4567-e89b-42d3-a456-426614174000", status: "pending" } });
  const dispatcher = activeDispatcher(api, new StubConsent());
  const argumentsValue = {
    debtor_name: "Synthetische Person",
    original_amount: "3000.00",
    currency: "EUR",
    description: "Synthetisches Privatdarlehen",
    rationale: "Synthetischer Vorschlag",
  };

  assert.equal((await dispatcher.dispatch(call("proposal_1", "finance_propose_receivable_create", argumentsValue))).abortTurn, false);
  const overflow = await dispatcher.dispatch(call("proposal_2", "finance_propose_receivable_create", argumentsValue));
  assert.equal(overflow.abortTurn, true);
  assert.equal(api.calls.length, 1);
});

test("aborts before provider delivery when cumulative output exceeds the turn budget", async () => {
  const api = new StubApi({ data: [{ description: "x".repeat(59_000) }] });
  const dispatcher = activeDispatcher(api, new StubConsent());

  for (let index = 0; index < 4; index += 1) {
    assert.equal((await dispatcher.dispatch(call(`large_${index}`, "finance_list_transactions", {}))).abortTurn, false);
  }
  const overflow = await dispatcher.dispatch(call("large_overflow", "finance_list_transactions", {}));
  assert.equal(overflow.abortTurn, true);
  assert.equal(overflow.response.success, false);
  assert.ok(Buffer.byteLength(textOf(overflow), "utf8") < 1_000);
  assert.doesNotMatch(textOf(overflow), /x{100}/);
});

function activeDispatcher(api: FinanceToolApi, consent: FinanceConsentAuthority): FinanceToolDispatcher {
  const dispatcher = new FinanceToolDispatcher(api, consent);
  dispatcher.startSession({
    consentVersion: "consent_v1",
    hostEpoch: "epoch_1",
    providerThreadId: threadId,
    sessionId: "session_1",
  });
  dispatcher.startTurn({ providerTurnId: turnId });
  return dispatcher;
}

function call(
  callId: string,
  tool: string,
  argumentsValue: JsonValue,
): DynamicToolCallParams {
  return {
    threadId,
    turnId,
    callId,
    namespace: null,
    tool,
    arguments: argumentsValue,
  };
}

function textOf(result: Awaited<ReturnType<FinanceToolDispatcher["dispatch"]>>): string {
  const item = result.response.contentItems[0];
  assert.equal(item?.type, "inputText");
  return item.text;
}

class StubConsent implements FinanceConsentAuthority {
  readonly checkedVersions: string[] = [];
  readonly #rejectAt: number | undefined;

  constructor(rejectAt?: number) {
    this.#rejectAt = rejectAt;
  }

  assertGranted(consentVersion: string): void {
    this.checkedVersions.push(consentVersion);
    if (this.#rejectAt === this.checkedVersions.length) throw new Error("Synthetic revoked consent");
  }
}

class StubApi implements FinanceToolApi {
  readonly calls: Array<{
    argumentsValue: Record<string, JsonValue>;
    name: FinanceToolName;
    options?: { correlation?: { idempotencyKey: string; providerCallId: string; providerThreadId: string; providerTurnId: string }; signal?: AbortSignal };
  }> = [];
  readonly #result: JsonValue;
  readonly #beforeResult: (() => Promise<void>) | undefined;

  constructor(result: JsonValue, beforeResult?: () => Promise<void>) {
    this.#result = result;
    this.#beforeResult = beforeResult;
  }

  async call(
    name: FinanceToolName,
    argumentsValue: Record<string, JsonValue>,
    options?: { correlation?: { idempotencyKey: string; providerCallId: string; providerThreadId: string; providerTurnId: string }; signal?: AbortSignal },
  ): Promise<JsonValue> {
    this.calls.push({ name, argumentsValue, ...(options ? { options } : {}) });
    await this.#beforeResult?.();
    return this.#result;
  }
}
