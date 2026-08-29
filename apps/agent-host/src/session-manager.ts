export const MAX_ISSUED_RESOURCE_IDS = 256;

export type HostStatus = "starting" | "ready" | "degraded" | "stopping" | "stopped";
export type AppServerStatus = "stopped" | "starting" | "ready" | "stopping" | "crashed";
export type ConsentStatus = "unknown" | "granted" | "revoke_pending" | "revoked";
export type AuthStatus = "unknown" | "logged_out" | "login_pending" | "authenticated";
export type SessionStatus = "starting" | "ready" | "context_lost" | "closed";
export type TurnStatus =
  | "starting"
  | "running"
  | "interrupting"
  | "interrupted"
  | "completed"
  | "failed";

export interface FinanceChatState {
  appServer: AppServerStatus;
  auth: AuthStatus;
  consent: {
    status: ConsentStatus;
    version: string | null;
  };
  host: HostStatus;
  issuedResourceIds: ReadonlyArray<string>;
  session: null | {
    consentVersion: string;
    id: string;
    providerThreadId: string | null;
    status: SessionStatus;
  };
  turn: null | {
    id: string;
    providerTurnId: string | null;
    sessionId: string;
    status: TurnStatus;
  };
}

export type FinanceChatEvent =
  | { type: "host.status"; status: HostStatus }
  | { type: "app_server.status"; status: AppServerStatus }
  | { type: "auth.status"; status: AuthStatus }
  | { type: "consent.loaded"; status: "granted" | "revoke_pending" | "revoked"; version: string }
  | { type: "consent.granted"; version: string }
  | { type: "consent.revoke_pending"; version: string }
  | { type: "consent.revoked"; version: string }
  | { type: "session.start"; consentVersion: string; sessionId: string }
  | { type: "session.ready"; providerThreadId: string; sessionId: string }
  | { type: "session.fail"; sessionId: string }
  | { type: "session.close"; sessionId: string }
  | { type: "turn.start"; sessionId: string; turnId: string }
  | { type: "turn.running"; providerTurnId: string; turnId: string }
  | { type: "turn.interrupt"; turnId: string }
  | { type: "turn.finish"; status: "interrupted" | "completed" | "failed"; turnId: string }
  | { type: "child.exited" };

export class SessionTransitionError extends Error {
  readonly code:
    | "authentication_required"
    | "consent_required"
    | "consent_version_mismatch"
    | "identifier_exhausted"
    | "identifier_reused"
    | "invalid_state_transition"
    | "resource_not_found";

  constructor(code: SessionTransitionError["code"], message: string) {
    super(message);
    this.name = "SessionTransitionError";
    this.code = code;
  }
}

export const INITIAL_FINANCE_CHAT_STATE: FinanceChatState = Object.freeze({
  appServer: "stopped",
  auth: "unknown",
  consent: Object.freeze({ status: "unknown", version: null }),
  host: "starting",
  issuedResourceIds: Object.freeze([]),
  session: null,
  turn: null,
});

const hostTransitions = {
  starting: ["ready", "degraded", "stopping"],
  ready: ["degraded", "stopping"],
  degraded: ["ready", "stopping"],
  stopping: ["stopped"],
  stopped: [],
} as const satisfies Record<HostStatus, readonly HostStatus[]>;

const appServerTransitions = {
  stopped: ["starting"],
  starting: ["ready", "stopping", "crashed"],
  ready: ["stopping", "crashed"],
  stopping: ["stopped", "crashed"],
  crashed: ["starting", "stopping", "stopped"],
} as const satisfies Record<AppServerStatus, readonly AppServerStatus[]>;

const authTransitions = {
  unknown: ["logged_out", "authenticated"],
  logged_out: ["unknown", "login_pending", "authenticated"],
  login_pending: ["unknown", "logged_out", "authenticated"],
  authenticated: ["unknown", "logged_out"],
} as const satisfies Record<AuthStatus, readonly AuthStatus[]>;

export function reduceFinanceChatState(
  state: FinanceChatState,
  event: FinanceChatEvent,
): FinanceChatState {
  switch (event.type) {
    case "host.status":
      assertTransition(hostTransitions, state.host, event.status, "host");
      if (event.status === "stopping" && isLiveSession(state.session)) {
        throw invalidTransition("The finance chat session must close before the host stops.");
      }
      return { ...state, host: event.status };
    case "app_server.status":
      assertTransition(appServerTransitions, state.appServer, event.status, "App Server");
      if (event.status === "crashed") return handleChildExit(state);
      if (event.status === "stopping" && isLiveSession(state.session)) {
        throw invalidTransition("The finance chat session must close before the App Server stops.");
      }
      return { ...state, appServer: event.status };
    case "auth.status":
      assertTransition(authTransitions, state.auth, event.status, "authentication");
      return event.status === "logged_out"
        ? loseActiveContext({ ...state, auth: event.status })
        : { ...state, auth: event.status };
    case "consent.loaded":
      if (state.consent.status !== "unknown" || isLiveSession(state.session)) {
        throw invalidTransition("Persisted consent can only be loaded before a session starts.");
      }
      return { ...state, consent: { status: event.status, version: validConsentVersion(event.version) } };
    case "consent.granted":
      if (!(["unknown", "revoked"] as ConsentStatus[]).includes(state.consent.status)) {
        throw invalidTransition("Consent cannot be granted from its current state.");
      }
      return { ...state, consent: { status: "granted", version: validConsentVersion(event.version) } };
    case "consent.revoke_pending":
      assertConsentVersion(state, event.version);
      if (state.consent.status !== "granted") {
        throw invalidTransition("Only granted consent can enter the revocation barrier.");
      }
      return {
        ...state,
        consent: { ...state.consent, status: "revoke_pending" },
        turn: isActiveTurn(state.turn) ? { ...state.turn, status: "interrupting" } : state.turn,
      };
    case "consent.revoked":
      assertConsentVersion(state, event.version);
      if (state.consent.status !== "revoke_pending") {
        throw invalidTransition("Consent revocation requires the durable pending barrier.");
      }
      return { ...state, consent: { ...state.consent, status: "revoked" } };
    case "session.start":
      return startSession(state, event.sessionId, event.consentVersion);
    case "session.ready":
      return markSessionReady(state, event.sessionId, event.providerThreadId);
    case "session.fail":
      if (!state.session || state.session.id !== validResourceId(event.sessionId) || state.session.status !== "starting") {
        throw resourceNotFound("The finance chat session was not found in the starting state.");
      }
      return { ...state, session: { ...state.session, status: "context_lost" } };
    case "session.close":
      return closeSession(state, event.sessionId);
    case "turn.start":
      return startTurn(state, event.sessionId, event.turnId);
    case "turn.running":
      return markTurnRunning(state, event.turnId, event.providerTurnId);
    case "turn.interrupt":
      return updateTurn(state, event.turnId, ["starting", "running"], { status: "interrupting" });
    case "turn.finish":
      return updateTurn(state, event.turnId, ["starting", "running", "interrupting"], {
        status: event.status,
      });
    case "child.exited":
      return handleChildExit(state);
    default:
      return assertNever(event);
  }
}

function startSession(
  state: FinanceChatState,
  rawSessionId: string,
  rawConsentVersion: string,
): FinanceChatState {
  if (state.host !== "ready" || state.appServer !== "ready") {
    throw invalidTransition("The host and App Server must be ready before a finance chat starts.");
  }
  assertAuthenticated(state);
  assertGrantedConsent(state, rawConsentVersion);
  if (state.session && state.session.status !== "closed") {
    throw invalidTransition("The previous finance chat session must close before another starts.");
  }
  const sessionId = availableResourceId(state, rawSessionId);
  return issueResourceIds({
    ...state,
    session: {
      consentVersion: validConsentVersion(rawConsentVersion),
      id: sessionId,
      providerThreadId: null,
      status: "starting",
    },
    turn: null,
  }, sessionId);
}

function markSessionReady(
  state: FinanceChatState,
  rawSessionId: string,
  rawProviderThreadId: string,
): FinanceChatState {
  const sessionId = validResourceId(rawSessionId);
  if (!state.session || state.session.id !== sessionId || state.session.status !== "starting") {
    throw resourceNotFound("The finance chat session was not found in the starting state.");
  }
  assertAuthenticated(state);
  assertGrantedConsent(state, state.session.consentVersion);
  const providerThreadId = availableResourceId(state, rawProviderThreadId);
  return issueResourceIds({
    ...state,
    session: { ...state.session, providerThreadId, status: "ready" },
  }, providerThreadId);
}

function closeSession(state: FinanceChatState, rawSessionId: string): FinanceChatState {
  const sessionId = validResourceId(rawSessionId);
  if (!state.session || state.session.id !== sessionId || state.session.status === "closed") {
    throw resourceNotFound("The finance chat session was not found.");
  }
  if (isActiveTurn(state.turn)) {
    throw invalidTransition("The active finance turn must finish before its session closes.");
  }
  return { ...state, session: { ...state.session, status: "closed" } };
}

function startTurn(state: FinanceChatState, rawSessionId: string, rawTurnId: string): FinanceChatState {
  const sessionId = validResourceId(rawSessionId);
  if (!state.session || state.session.id !== sessionId || state.session.status !== "ready") {
    throw resourceNotFound("A ready finance chat session is required to start a turn.");
  }
  assertAuthenticated(state);
  assertGrantedConsent(state, state.session.consentVersion);
  if (isActiveTurn(state.turn)) {
    throw invalidTransition("A finance turn is already active.");
  }
  const turnId = availableResourceId(state, rawTurnId);
  return issueResourceIds({
    ...state,
    turn: { id: turnId, providerTurnId: null, sessionId, status: "starting" },
  }, turnId);
}

function markTurnRunning(
  state: FinanceChatState,
  rawTurnId: string,
  rawProviderTurnId: string,
): FinanceChatState {
  assertAuthenticated(state);
  if (!state.session) throw resourceNotFound("The finance chat session was not found.");
  assertGrantedConsent(state, state.session.consentVersion);
  const providerTurnId = availableResourceId(state, rawProviderTurnId);
  const updated = updateTurn(state, rawTurnId, "starting", { providerTurnId, status: "running" });
  return issueResourceIds(updated, providerTurnId);
}

function handleChildExit(state: FinanceChatState): FinanceChatState {
  return loseActiveContext({
    ...state,
    appServer: "crashed",
    host: state.host === "stopping" || state.host === "stopped" ? state.host : "degraded",
  });
}

function loseActiveContext(state: FinanceChatState): FinanceChatState {
  return {
    ...state,
    session: isLiveSession(state.session) ? { ...state.session, status: "context_lost" } : state.session,
    turn: isActiveTurn(state.turn) ? { ...state.turn, status: "failed" } : state.turn,
  };
}

function updateTurn(
  state: FinanceChatState,
  rawTurnId: string,
  expected: TurnStatus | readonly TurnStatus[],
  update: Partial<NonNullable<FinanceChatState["turn"]>>,
): FinanceChatState {
  const turnId = validResourceId(rawTurnId);
  const expectedStatuses: readonly TurnStatus[] = typeof expected === "string" ? [expected] : expected;
  if (!state.turn || state.turn.id !== turnId || !expectedStatuses.includes(state.turn.status)) {
    throw resourceNotFound("The finance turn was not found in the expected state.");
  }
  return { ...state, turn: { ...state.turn, ...update } };
}

function assertAuthenticated(state: FinanceChatState): void {
  if (state.auth !== "authenticated") {
    throw new SessionTransitionError("authentication_required", "OpenAI authentication is required.");
  }
}

function assertGrantedConsent(state: FinanceChatState, rawVersion: string): void {
  const version = validConsentVersion(rawVersion);
  if (state.consent.status !== "granted") {
    throw new SessionTransitionError("consent_required", "Granted finance assistant consent is required.");
  }
  if (state.consent.version !== version) {
    throw new SessionTransitionError(
      "consent_version_mismatch",
      "The granted consent version does not match the finance chat contract.",
    );
  }
}

function assertConsentVersion(state: FinanceChatState, rawVersion: string): void {
  const version = validConsentVersion(rawVersion);
  if (state.consent.version !== version) {
    throw new SessionTransitionError("consent_version_mismatch", "The consent version does not match.");
  }
}

function availableResourceId(state: FinanceChatState, rawId: string): string {
  const id = validResourceId(rawId);
  if (state.issuedResourceIds.includes(id)) {
    throw new SessionTransitionError(
      "identifier_reused",
      "A resource identifier cannot be reused in this host epoch.",
    );
  }
  return id;
}

function issueResourceIds(state: FinanceChatState, ...ids: string[]): FinanceChatState {
  if (state.issuedResourceIds.length + ids.length > MAX_ISSUED_RESOURCE_IDS) {
    throw new SessionTransitionError(
      "identifier_exhausted",
      "The bounded resource identifier ledger is exhausted; restart the host safely.",
    );
  }
  return { ...state, issuedResourceIds: [...state.issuedResourceIds, ...ids] };
}

function validResourceId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw resourceNotFound("Resource identifier is invalid.");
  }
  return value;
}

function validConsentVersion(value: string): string {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value)) {
    throw new SessionTransitionError("consent_version_mismatch", "Consent version is invalid.");
  }
  return value;
}

function isLiveSession(
  session: FinanceChatState["session"],
): session is NonNullable<FinanceChatState["session"]> {
  return session !== null && (session.status === "starting" || session.status === "ready");
}

function isActiveTurn(turn: FinanceChatState["turn"]): turn is NonNullable<FinanceChatState["turn"]> {
  return turn !== null && ["starting", "running", "interrupting"].includes(turn.status);
}

function assertTransition<T extends string>(
  transitions: Record<T, readonly T[]>,
  current: T,
  next: T,
  label: string,
): void {
  if (!(transitions[current] as readonly T[]).includes(next)) {
    throw invalidTransition(`Invalid ${label} transition from ${current} to ${next}.`);
  }
}

function invalidTransition(message: string): SessionTransitionError {
  return new SessionTransitionError("invalid_state_transition", message);
}

function resourceNotFound(message: string): SessionTransitionError {
  return new SessionTransitionError("resource_not_found", message);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled finance chat event: ${JSON.stringify(value)}`);
}
