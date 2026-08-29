import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertFinanceAccountResponse,
  assertFinanceLoginResponse,
  assertFinanceTurnStartResponse,
  assertSafeFinanceThreadResponse,
} from "../src/finance-response-validator.js";

function safeThread(runtimeDirectory: string): Record<string, unknown> {
  return {
    activePermissionProfile: null,
    approvalPolicy: "never",
    approvalsReviewer: "user",
    cwd: runtimeDirectory,
    instructionSources: [],
    model: "gpt-test",
    modelProvider: "openai",
    multiAgentMode: "explicitRequestOnly",
    reasoningEffort: null,
    runtimeWorkspaceRoots: [],
    sandbox: { networkAccess: false, type: "readOnly" },
    serviceTier: null,
    thread: {
      agentNickname: null,
      agentRole: null,
      cliVersion: "0.149.1",
      createdAt: 1,
      cwd: runtimeDirectory,
      ephemeral: true,
      forkedFromId: null,
      gitInfo: null,
      id: "01900000-0000-7000-8000-000000000001",
      modelProvider: "openai",
      name: null,
      parentThreadId: null,
      path: null,
      preview: "",
      projectId: null,
      recencyAt: 1,
      section: null,
      sectionEnteredAt: null,
      sessionId: "01900000-0000-7000-8000-000000000001",
      source: "appServer",
      status: { type: "idle" },
      threadSource: "appServer",
      turns: [],
      updatedAt: 1,
    },
  };
}

test("finance response validator: accepts the exact pinned read-only thread projection", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "finance-response-")));
  try {
    assert.doesNotThrow(() => assertSafeFinanceThreadResponse(safeThread(root), root));
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("finance response validator: rejects each security-relevant thread relaxation", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "finance-response-")));
  try {
    const safe = safeThread(root);
    const mutations = [
      { ...safe, approvalPolicy: "untrusted" },
      { ...safe, approvalsReviewer: "auto_review" },
      { ...safe, instructionSources: [join(root, "AGENTS.md")] },
      { ...safe, runtimeWorkspaceRoots: [root] },
      { ...safe, activePermissionProfile: { id: ":workspace" } },
      { ...safe, multiAgentMode: "explicitRequest" },
      { ...safe, sandbox: { networkAccess: true, type: "readOnly" } },
      { ...safe, sandbox: { type: "dangerFullAccess" } },
      { ...safe, modelProvider: "custom" },
      { ...safe, futureSecurityField: true },
      { ...safe, thread: { ...(safe.thread as object), ephemeral: false } },
      { ...safe, thread: { ...(safe.thread as object), path: join(root, "thread.jsonl") } },
      { ...safe, thread: { ...(safe.thread as object), parentThreadId: "parent" } },
      { ...safe, thread: { ...(safe.thread as object), gitInfo: { branch: "main" } } },
    ];
    for (const mutation of mutations) {
      assert.throws(() => assertSafeFinanceThreadResponse(mutation, root));
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("finance response validator: accepts only ChatGPT device login and ChatGPT accounts", () => {
  assert.doesNotThrow(() => assertFinanceAccountResponse({ account: null, requiresOpenaiAuth: true }));
  assert.doesNotThrow(() => assertFinanceAccountResponse({
    account: { email: null, planType: "plus", type: "chatgpt" },
    requiresOpenaiAuth: true,
  }));
  assert.throws(() => assertFinanceAccountResponse({ account: { type: "apiKey" }, requiresOpenaiAuth: true }));
  assert.doesNotThrow(() => assertFinanceLoginResponse({
    loginId: "login_1",
    type: "chatgptDeviceCode",
    userCode: "ABCD-EFGH",
    verificationUrl: "https://auth.openai.com/device",
  }));
  assert.throws(() => assertFinanceLoginResponse({ loginId: "login_1", type: "chatgpt", authUrl: "https://example.test" }));
});

test("finance response validator: accepts only a fresh in-progress empty turn", () => {
  const safe = {
    turn: {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "01900000-0000-7000-8000-000000000002",
      items: [],
      itemsView: "full",
      startedAt: 1,
      status: "inProgress",
    },
  };
  assert.doesNotThrow(() => assertFinanceTurnStartResponse(safe));
  assert.throws(() => assertFinanceTurnStartResponse({ ...safe, turn: { ...safe.turn, status: "completed" } }));
  assert.throws(() => assertFinanceTurnStartResponse({ ...safe, turn: { ...safe.turn, items: [{ type: "plan" }] } }));
  assert.throws(() => assertFinanceTurnStartResponse({ ...safe, extra: true }));
});
