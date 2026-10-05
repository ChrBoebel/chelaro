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
import { SCHEMA_CODEX_VERSION } from "../src/codex-provider.js";
import { DEFAULT_FINANCE_MODEL_SELECTION } from "../src/finance-thread-contract.js";

function safeThread(runtimeDirectory: string): Record<string, unknown> {
  return {
    activePermissionProfile: null,
    approvalPolicy: "never",
    approvalsReviewer: "user",
    cwd: runtimeDirectory,
    instructionSources: [],
    model: DEFAULT_FINANCE_MODEL_SELECTION.model,
    modelProvider: "openai",
    multiAgentMode: "explicitRequestOnly",
    reasoningEffort: "medium",
    runtimeWorkspaceRoots: [],
    sandbox: { networkAccess: false, type: "readOnly" },
    serviceTier: "default",
    thread: {
      agentNickname: null,
      agentRole: null,
      cliVersion: SCHEMA_CODEX_VERSION,
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

test("finance response validator: accepts a resumed thread without provider history", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "finance-response-")));
  // A resumed thread carries three fields a started one does not. Measured
  // against the pinned App Server; rejecting them made every real resume fail.
  const resumed = {
    ...safeThread(root),
    initialTurnsPage: null,
    itemsBackwardsCursor: '{"scope":{"kind":"itemsByCreatedAtOrdinal"}}',
    // A resumed thread names the workspace it was started in; a started one
    // reports none. Demanding an empty list made every real resume fail.
    runtimeWorkspaceRoots: [root],
    turnsBackwardsCursor: '{"scope":{"kind":"turns"}}',
  };
  try {
    assert.doesNotThrow(() => assertSafeFinanceThreadResponse(resumed, root, "resume"));
    // The started shape is not a resumed shape and vice versa.
    assert.throws(() => assertSafeFinanceThreadResponse(safeThread(root), root, "resume"));
    assert.throws(() => assertSafeFinanceThreadResponse(resumed, root, "start"));
    // Chelaro renders its own database, so hydrated provider history is refused.
    assert.throws(() => assertSafeFinanceThreadResponse(
      { ...resumed, initialTurnsPage: { items: [], nextCursor: null } },
      root,
      "resume",
    ));
    // A workspace root outside Chelaro's runtime directory stays forbidden,
    // and a started thread may still not name one at all.
    assert.throws(() => assertSafeFinanceThreadResponse(
      { ...resumed, runtimeWorkspaceRoots: [root, tmpdir()] },
      root,
      "resume",
    ));
    assert.throws(() => assertSafeFinanceThreadResponse(
      { ...safeThread(root), runtimeWorkspaceRoots: [root] },
      root,
      "start",
    ));
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

test("finance response validator: optional thread metadata must agree with the verified selection", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "finance-response-metadata-")));
  try {
    const response = safeThread(root);
    const thread = response.thread as Record<string, unknown>;
    for (const metadata of [
      {},
      { model: null, reasoningEffort: null },
      { model: DEFAULT_FINANCE_MODEL_SELECTION.model, reasoningEffort: DEFAULT_FINANCE_MODEL_SELECTION.effort },
    ]) {
      assert.doesNotThrow(() => assertSafeFinanceThreadResponse({ ...response, thread: { ...thread, ...metadata } }, root));
    }
    for (const metadata of [
      { model: "unverified-model" },
      { reasoningEffort: "high" },
    ]) {
      assert.throws(() => assertSafeFinanceThreadResponse({ ...response, thread: { ...thread, ...metadata } }, root));
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
