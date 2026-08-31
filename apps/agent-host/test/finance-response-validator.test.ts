import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertFinanceAccountResponse,
  assertFinanceThreadUnsubscribeResponse,
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
    model: "gpt-5.5",
    modelProvider: "openai",
    multiAgentMode: "explicitRequestOnly",
    reasoningEffort: "medium",
    runtimeWorkspaceRoots: [],
    sandbox: { networkAccess: false, type: "readOnly" },
    serviceTier: "default",
    thread: {
      agentNickname: null,
      agentRole: null,
      cliVersion: "0.151.0",
      createdAt: 1,
      cwd: runtimeDirectory,
      ephemeral: false,
      forkedFromId: null,
      gitInfo: null,
      id: "01900000-0000-7000-8000-000000000001",
      modelProvider: "openai",
      name: null,
      parentThreadId: null,
      path: join(runtimeDirectory, "thread.jsonl"),
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

test("finance response validator: binds the thread to the requested model configuration", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "finance-response-")));
  try {
    const fast = {
      ...safeThread(root),
      model: "gpt-5.5",
      reasoningEffort: "high",
      serviceTier: "priority",
    };
    assert.doesNotThrow(() =>
      assertSafeFinanceThreadResponse(fast, root, "start", {
        effort: "high",
        fastMode: true,
        model: "gpt-5.5",
      }),
    );
    // Fast mode requested, standard tier delivered: the silent downgrade must
    // not pass as a verified thread.
    assert.throws(() =>
      assertSafeFinanceThreadResponse({ ...fast, serviceTier: "default" }, root, "start", {
        effort: "high",
        fastMode: true,
        model: "gpt-5.5",
      }),
    );
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
      // Codex accepts an unknown model, effort, or tier without an error and
      // reports a substituted or null value instead.
      { ...safe, model: "gpt-5.4" },
      { ...safe, reasoningEffort: "high" },
      { ...safe, reasoningEffort: null },
      { ...safe, serviceTier: "priority" },
      { ...safe, serviceTier: null },
      { ...safe, thread: { ...(safe.thread as object), ephemeral: true } },
      { ...safe, thread: { ...(safe.thread as object), path: null } },
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

test("finance response validator: accepts only shared ChatGPT accounts", () => {
  assert.doesNotThrow(() => assertFinanceAccountResponse({ account: null, requiresOpenaiAuth: true }));
  assert.doesNotThrow(() => assertFinanceAccountResponse({
    account: { email: null, planType: "plus", type: "chatgpt" },
    requiresOpenaiAuth: true,
  }));
  assert.throws(() => assertFinanceAccountResponse({ account: { type: "apiKey" }, requiresOpenaiAuth: true }));
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

test("finance response validator: requires a completed thread unsubscribe", () => {
  assert.doesNotThrow(() => assertFinanceThreadUnsubscribeResponse({ status: "unsubscribed" }));
  assert.throws(() => assertFinanceThreadUnsubscribeResponse({ status: "notLoaded" }));
  assert.throws(() => assertFinanceThreadUnsubscribeResponse({ status: "unsubscribed", extra: true }));
  assert.throws(() => assertFinanceThreadUnsubscribeResponse({}));
});
