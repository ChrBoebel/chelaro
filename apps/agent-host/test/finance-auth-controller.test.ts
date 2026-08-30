import assert from "node:assert/strict";
import test from "node:test";

import {
  FinanceAuthController,
  FinanceAuthError,
  type FinanceAuthProcessPort,
  type FinanceAuthStatus,
} from "../src/finance-auth-controller.js";

class GrantedConsent {
  granted = true;
  assertGranted(): void {
    if (!this.granted) throw new Error("revoked");
  }
}

class StubProcess implements FinanceAuthProcessPort {
  readonly calls: Array<{ method: string; params: unknown }> = [];
  handler: (method: string, params: unknown) => unknown = () => ({});
  async request(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    return this.handler(method, params);
  }
}

function fixture() {
  const consent = new GrantedConsent();
  const process = new StubProcess();
  const statuses: FinanceAuthStatus[] = [];
  const controller = new FinanceAuthController({ consent, process, emit: (status) => statuses.push(status) });
  return { consent, controller, process, statuses };
}

test("finance auth: probes only the existing CLI account and exposes no account data", async () => {
  const state = fixture();
  state.process.handler = () => ({
    account: { email: "must-not-cross@example.invalid", planType: "plus", type: "chatgpt" },
    requiresOpenaiAuth: true,
  });
  assert.equal(await state.controller.refresh(), "authenticated");
  assert.deepEqual(state.process.calls, [{ method: "account/read", params: { refreshToken: false } }]);
  assert.equal(JSON.stringify(state.statuses).includes("must-not-cross"), false);
});

test("finance auth: reports a missing shared login and honors consent before probing", async () => {
  const state = fixture();
  state.process.handler = () => ({ account: null, requiresOpenaiAuth: true });
  assert.equal(await state.controller.refresh(), "logged_out");
  state.consent.granted = false;
  await assert.rejects(() => state.controller.refresh());
  assert.equal(state.process.calls.length, 1);
});

test("finance auth: accepts account updates but rejects an app-owned login completion", () => {
  const state = fixture();
  assert.equal(state.controller.handleNotification({
    method: "account/updated",
    params: { authMode: "chatgpt", planType: "plus" },
  }), true);
  assert.equal(state.controller.status, "authenticated");
  assert.throws(
    () => state.controller.handleNotification({
      method: "account/login/completed",
      params: { error: null, loginId: "foreign", onboardingEntrypoint: null, success: true },
    }),
    (error: unknown) => error instanceof FinanceAuthError && error.code === "unexpected_login_flow",
  );
});
