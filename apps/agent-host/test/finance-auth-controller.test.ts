import assert from "node:assert/strict";
import test from "node:test";

import type { ServerNotification } from "../generated/codex/ts/ServerNotification.js";
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
  handler: (method: string, params: unknown) => Promise<unknown> | unknown = () => ({});

  async request(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    return this.handler(method, params);
  }
}

function fixture() {
  const consent = new GrantedConsent();
  const process = new StubProcess();
  const statuses: FinanceAuthStatus[] = [];
  const controller = new FinanceAuthController({
    consent,
    emit: (status) => statuses.push(status),
    loginTimeoutMs: 50,
    process,
  });
  return { consent, controller, process, statuses };
}

function loginCompleted(loginId: string | null = "login_1"): ServerNotification {
  return {
    method: "account/login/completed",
    params: { error: null, loginId, onboardingEntrypoint: null, success: true },
  };
}

test("finance auth: reads only a bounded authentication status", async () => {
  const state = fixture();
  state.process.handler = () => ({
    account: { email: "must-not-cross@example.invalid", planType: "plus", type: "chatgpt" },
    requiresOpenaiAuth: true,
  });
  assert.equal(await state.controller.refresh(), "authenticated");
  assert.deepEqual(state.statuses, ["authenticated"]);
  assert.equal(JSON.stringify(state.statuses).includes("must-not-cross"), false);
});

test("finance auth: completes device login even when notification races the response", async () => {
  const state = fixture();
  state.process.handler = async (method) => {
    if (method === "account/login/start") {
      state.controller.handleNotification(loginCompleted());
      return {
        loginId: "login_1",
        type: "chatgptDeviceCode",
        userCode: "ABCD-EFGH",
        verificationUrl: "https://auth.openai.com/device",
      };
    }
    return {};
  };
  const login = await state.controller.startLogin();
  assert.equal(login.status, "authenticated");
  assert.equal(state.controller.status, "authenticated");
});

test("finance auth: rejects non-OpenAI device URLs and mismatched completion IDs", async () => {
  const state = fixture();
  state.process.handler = () => ({
    loginId: "login_1",
    type: "chatgptDeviceCode",
    userCode: "ABCD-EFGH",
    verificationUrl: "https://example.test/device",
  });
  await assert.rejects(
    () => state.controller.startLogin(),
    (error: unknown) => error instanceof FinanceAuthError && error.code === "invalid_login_response",
  );

  state.process.handler = () => ({
    loginId: "login_1",
    type: "chatgptDeviceCode",
    userCode: "ABCD-EFGH",
    verificationUrl: "https://auth.openai.com/device",
  });
  await state.controller.startLogin();
  assert.throws(
    () => state.controller.handleNotification(loginCompleted("foreign_login")),
    (error: unknown) => error instanceof FinanceAuthError && error.code === "protocol_incompatible",
  );
});

test("finance auth: consent blocks account reads and login before any process request", async () => {
  const state = fixture();
  state.consent.granted = false;
  await assert.rejects(() => state.controller.refresh());
  await assert.rejects(() => state.controller.startLogin());
  assert.deepEqual(state.process.calls, []);
});

test("finance auth: logout never exposes account data and validates the empty response", async () => {
  const state = fixture();
  state.controller.handleNotification({
    method: "account/updated",
    params: { authMode: "chatgpt", planType: "plus" },
  });
  state.process.handler = () => ({});
  await state.controller.logout();
  assert.equal(state.controller.status, "logged_out");
  assert.deepEqual(state.process.calls.at(-1), { method: "account/logout", params: undefined });
});
