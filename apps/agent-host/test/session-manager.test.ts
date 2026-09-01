import assert from "node:assert/strict";
import test from "node:test";

import {
  INITIAL_FINANCE_CHAT_STATE,
  reduceFinanceChatState,
  SessionTransitionError,
  type FinanceChatEvent,
  type FinanceChatState,
} from "../src/session-manager.js";

const CONSENT_VERSION = "2026-08-31.v2";

function apply(state: FinanceChatState, ...events: FinanceChatEvent[]): FinanceChatState {
  return events.reduce(reduceFinanceChatState, state);
}

function prerequisites(): FinanceChatState {
  return apply(
    INITIAL_FINANCE_CHAT_STATE,
    { type: "host.status", status: "ready" },
    { type: "app_server.status", status: "starting" },
    { type: "app_server.status", status: "ready" },
    { type: "auth.status", status: "authenticated" },
    { type: "consent.loaded", status: "granted", version: CONSENT_VERSION },
  );
}

function runningTurn(): FinanceChatState {
  return apply(
    prerequisites(),
    { type: "session.start", consentVersion: CONSENT_VERSION, sessionId: "session_1" },
    { type: "session.ready", providerThreadId: "codex_thread_1", resumed: false, sessionId: "session_1" },
    { type: "turn.start", sessionId: "session_1", turnId: "turn_1" },
    { type: "turn.running", providerTurnId: "codex_turn_1", turnId: "turn_1" },
  );
}

test("finance chat lifecycle: models the authenticated and consent-bound happy path", () => {
  const completed = apply(
    runningTurn(),
    { type: "turn.finish", status: "completed", turnId: "turn_1" },
    { type: "session.close", sessionId: "session_1" },
  );

  assert.equal(completed.host, "ready");
  assert.equal(completed.appServer, "ready");
  assert.deepEqual(completed.consent, { status: "granted", version: CONSENT_VERSION });
  assert.equal(completed.auth, "authenticated");
  assert.deepEqual(completed.session, {
    consentVersion: CONSENT_VERSION,
    id: "session_1",
    providerThreadId: "codex_thread_1",
    status: "closed",
  });
  assert.deepEqual(completed.turn, {
    id: "turn_1",
    providerTurnId: "codex_turn_1",
    sessionId: "session_1",
    status: "completed",
  });
});

test("finance chat lifecycle: refuses sessions unless host, App Server, auth, and consent are ready", () => {
  const event = { type: "session.start", consentVersion: CONSENT_VERSION, sessionId: "session_1" } as const;
  assert.throws(
    () => reduceFinanceChatState(INITIAL_FINANCE_CHAT_STATE, event),
    (error: unknown) => error instanceof SessionTransitionError && error.code === "invalid_state_transition",
  );

  const infrastructureReady = apply(
    INITIAL_FINANCE_CHAT_STATE,
    { type: "host.status", status: "ready" },
    { type: "app_server.status", status: "starting" },
    { type: "app_server.status", status: "ready" },
  );
  assert.throws(
    () => reduceFinanceChatState(infrastructureReady, event),
    (error: unknown) => error instanceof SessionTransitionError && error.code === "authentication_required",
  );

  const authenticated = reduceFinanceChatState(infrastructureReady, {
    type: "auth.status",
    status: "authenticated",
  });
  assert.throws(
    () => reduceFinanceChatState(authenticated, event),
    (error: unknown) => error instanceof SessionTransitionError && error.code === "consent_required",
  );
});

test("finance chat lifecycle: durable revoke-pending is an immediate deny barrier", () => {
  const pending = reduceFinanceChatState(runningTurn(), {
    type: "consent.revoke_pending",
    version: CONSENT_VERSION,
  });
  assert.equal(pending.consent.status, "revoke_pending");
  assert.equal(pending.turn?.status, "interrupting");

  const interrupted = reduceFinanceChatState(pending, {
    type: "turn.finish",
    status: "interrupted",
    turnId: "turn_1",
  });
  assert.throws(
    () => reduceFinanceChatState(interrupted, {
      type: "turn.start",
      sessionId: "session_1",
      turnId: "turn_2",
    }),
    (error: unknown) => error instanceof SessionTransitionError && error.code === "consent_required",
  );
  const revoked = reduceFinanceChatState(interrupted, {
    type: "consent.revoked",
    version: CONSENT_VERSION,
  });
  assert.equal(revoked.consent.status, "revoked");
});

test("finance chat lifecycle: a child crash makes context loss explicit", () => {
  const crashed = reduceFinanceChatState(runningTurn(), { type: "child.exited" });
  assert.equal(crashed.host, "degraded");
  assert.equal(crashed.appServer, "crashed");
  assert.equal(crashed.session?.status, "context_lost");
  assert.equal(crashed.turn?.status, "failed");
});

test("finance chat lifecycle: a restarted child never resumes a lost provider thread", () => {
  const restarted = apply(
    reduceFinanceChatState(runningTurn(), { type: "child.exited" }),
    { type: "app_server.status", status: "starting" },
    { type: "app_server.status", status: "ready" },
    { type: "host.status", status: "ready" },
  );
  assert.equal(restarted.session?.status, "context_lost");
  assert.throws(
    () => reduceFinanceChatState(restarted, {
      type: "turn.start",
      sessionId: "session_1",
      turnId: "turn_2",
    }),
    (error: unknown) => error instanceof SessionTransitionError && error.code === "resource_not_found",
  );
});

test("finance chat lifecycle: refuses session closure while a turn is active", () => {
  assert.throws(
    () => reduceFinanceChatState(runningTurn(), { type: "session.close", sessionId: "session_1" }),
    /active finance turn must finish/,
  );
});

test("finance chat lifecycle: rejects resource mismatches and identifier reuse", () => {
  const state = runningTurn();
  assert.throws(
    () => reduceFinanceChatState(state, {
      type: "turn.finish",
      status: "completed",
      turnId: "foreign_turn",
    }),
    (error: unknown) => error instanceof SessionTransitionError && error.code === "resource_not_found",
  );

  const closed = apply(
    state,
    { type: "turn.finish", status: "completed", turnId: "turn_1" },
    { type: "session.close", sessionId: "session_1" },
  );
  assert.throws(
    () => reduceFinanceChatState(closed, {
      type: "session.start",
      consentVersion: CONSENT_VERSION,
      sessionId: "session_1",
    }),
    (error: unknown) => error instanceof SessionTransitionError && error.code === "identifier_reused",
  );
});

test("finance chat lifecycle: reattaches a resumed provider thread but not a foreign role", () => {
  const closed = apply(
    runningTurn(),
    { type: "turn.finish", status: "completed", turnId: "turn_1" },
    { type: "session.close", sessionId: "session_1" },
  );
  const reopened = apply(
    closed,
    { type: "session.start", consentVersion: CONSENT_VERSION, sessionId: "session_2" },
    {
      type: "session.ready",
      providerThreadId: "codex_thread_1",
      resumed: true,
      sessionId: "session_2",
    },
  );
  assert.equal(reopened.session?.providerThreadId, "codex_thread_1");
  // The ledger records each identifier once, so reopening a conversation does
  // not consume budget that a long session needs for its turns.
  assert.equal(
    reopened.issuedResourceIds.filter(({ id }) => id === "codex_thread_1").length,
    1,
  );

  // The same identifier arriving in any other role is still a collision.
  assert.throws(
    () => reduceFinanceChatState(reopened, {
      type: "turn.start",
      sessionId: "session_2",
      turnId: "codex_thread_1",
    }),
    (error: unknown) => error instanceof SessionTransitionError && error.code === "identifier_reused",
  );
  assert.throws(
    () => reduceFinanceChatState(closed, {
      type: "session.start",
      consentVersion: CONSENT_VERSION,
      sessionId: "codex_thread_1",
    }),
    (error: unknown) => error instanceof SessionTransitionError && error.code === "identifier_reused",
  );
});

test("finance chat lifecycle: binds each session to the exact granted consent version", () => {
  assert.throws(
    () => reduceFinanceChatState(prerequisites(), {
      type: "session.start",
      consentVersion: "2026-09-01.v2",
      sessionId: "session_1",
    }),
    (error: unknown) => error instanceof SessionTransitionError && error.code === "consent_version_mismatch",
  );
});

test("finance chat lifecycle: preserves a recovered revoke-pending deny barrier", () => {
  const pending = reduceFinanceChatState(INITIAL_FINANCE_CHAT_STATE, {
    type: "consent.loaded",
    status: "revoke_pending",
    version: CONSENT_VERSION,
  });
  assert.deepEqual(pending.consent, { status: "revoke_pending", version: CONSENT_VERSION });
  assert.throws(
    () => reduceFinanceChatState(pending, {
      type: "session.start",
      consentVersion: CONSENT_VERSION,
      sessionId: "session_1",
    }),
  );
});

test("finance chat lifecycle: shared account loss fails active work and prevents new turns", () => {
  const loggedOut = reduceFinanceChatState(runningTurn(), { type: "auth.status", status: "logged_out" });
  assert.equal(loggedOut.session?.status, "context_lost");
  assert.equal(loggedOut.turn?.status, "failed");
  assert.throws(
    () => reduceFinanceChatState(loggedOut, {
      type: "turn.start",
      sessionId: "session_1",
      turnId: "turn_2",
    }),
    (error: unknown) => error instanceof SessionTransitionError && error.code === "resource_not_found",
  );
});
