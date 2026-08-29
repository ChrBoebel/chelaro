import type { ServerNotification } from "../generated/codex/ts/ServerNotification.js";
import { FINANCE_CONSENT_VERSION } from "./consent-journal.js";
import type { FinanceConsentAuthority } from "./finance-tool-dispatcher.js";
import {
  assertEmptyCodexResponse,
  assertFinanceAccountResponse,
  assertFinanceLoginResponse,
} from "./finance-response-validator.js";

export const FINANCE_LOGIN_TIMEOUT_MS = 10 * 60 * 1_000;

export type FinanceAuthStatus = "unknown" | "logged_out" | "login_pending" | "authenticated";

export interface FinanceAuthProcessPort {
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
}

export interface FinanceAuthControllerOptions {
  consent: FinanceConsentAuthority;
  emit: (status: FinanceAuthStatus) => void;
  loginTimeoutMs?: number;
  process: FinanceAuthProcessPort;
}

export interface FinanceDeviceLogin {
  status: FinanceAuthStatus;
  userCode: string;
  verificationUrl: string;
}

export class FinanceAuthController {
  readonly #consent: FinanceConsentAuthority;
  readonly #emit: (status: FinanceAuthStatus) => void;
  readonly #loginTimeoutMs: number;
  readonly #process: FinanceAuthProcessPort;
  #earlyCompletion: Extract<ServerNotification, { method: "account/login/completed" }> | undefined;
  #loginStarting = false;
  #loginTimer: NodeJS.Timeout | undefined;
  #pendingLoginId: string | undefined;
  #status: FinanceAuthStatus = "unknown";

  constructor(options: FinanceAuthControllerOptions) {
    this.#consent = options.consent;
    this.#emit = options.emit;
    this.#loginTimeoutMs = positiveTimeout(options.loginTimeoutMs ?? FINANCE_LOGIN_TIMEOUT_MS);
    this.#process = options.process;
  }

  get status(): FinanceAuthStatus {
    return this.#status;
  }

  async refresh(): Promise<FinanceAuthStatus> {
    await this.#consent.assertGranted(FINANCE_CONSENT_VERSION);
    const response = await this.#process.request("account/read", { refreshToken: false });
    assertFinanceAccountResponse(response);
    this.#setStatus(response.account === null ? "logged_out" : "authenticated");
    return this.#status;
  }

  async startLogin(): Promise<FinanceDeviceLogin> {
    await this.#consent.assertGranted(FINANCE_CONSENT_VERSION);
    if (this.#loginStarting || this.#pendingLoginId) throw new FinanceAuthError("login_in_progress");
    if (this.#status === "authenticated") throw new FinanceAuthError("already_authenticated");
    this.#loginStarting = true;
    this.#earlyCompletion = undefined;
    try {
      const response = await this.#process.request("account/login/start", { type: "chatgptDeviceCode" });
      assertFinanceLoginResponse(response);
      this.#pendingLoginId = validProviderId(response.loginId);
      const verificationUrl = validVerificationUrl(response.verificationUrl);
      const userCode = validUserCode(response.userCode);
      if (this.status !== "authenticated") this.#setStatus("login_pending");
      this.#loginTimer = setTimeout(() => {
        void this.cancelLogin().catch(() => undefined);
      }, this.#loginTimeoutMs);
      this.#loginTimer.unref();
      const early = this.#takeEarlyCompletion();
      if (early) this.#completeLogin(early.params);
      return { status: this.#status, userCode, verificationUrl };
    } catch (error) {
      this.#clearPendingLogin();
      if (error instanceof FinanceAuthError) throw error;
      throw new FinanceAuthError("login_failed");
    } finally {
      this.#loginStarting = false;
    }
  }

  async cancelLogin(): Promise<void> {
    const loginId = this.#pendingLoginId;
    if (!loginId) return;
    this.#clearPendingLogin();
    try {
      await this.#consent.assertGranted(FINANCE_CONSENT_VERSION);
      const response = await this.#process.request("account/login/cancel", { loginId });
      if (!isRecord(response) || !["canceled", "notFound"].includes(String(response.status))) {
        throw new FinanceAuthError("protocol_incompatible");
      }
    } finally {
      if (this.#status !== "authenticated") this.#setStatus("logged_out");
    }
  }

  async logout(): Promise<void> {
    await this.#consent.assertGranted(FINANCE_CONSENT_VERSION);
    if (this.#loginStarting || this.#pendingLoginId) throw new FinanceAuthError("login_in_progress");
    const response = await this.#process.request("account/logout", undefined);
    assertEmptyCodexResponse(response);
    this.#setStatus("logged_out");
  }

  handleNotification(notification: ServerNotification): boolean {
    switch (notification.method) {
      case "account/updated":
        this.#setStatus(notification.params.authMode === null ? "logged_out" : "authenticated");
        return true;
      case "account/login/completed":
        if (this.#loginStarting && !this.#pendingLoginId) {
          this.#earlyCompletion = notification;
        } else {
          this.#completeLogin(notification.params);
        }
        return true;
      default:
        return false;
    }
  }

  stop(): void {
    this.#clearPendingLogin();
    this.#setStatus("unknown");
  }

  #completeLogin(params: Extract<ServerNotification, { method: "account/login/completed" }>["params"]): void {
    if (!this.#pendingLoginId || params.loginId !== this.#pendingLoginId) {
      throw new FinanceAuthError("protocol_incompatible");
    }
    this.#clearPendingLogin();
    this.#setStatus(params.success && params.error === null ? "authenticated" : "logged_out");
  }

  #clearPendingLogin(): void {
    clearTimeout(this.#loginTimer);
    this.#loginTimer = undefined;
    this.#pendingLoginId = undefined;
    this.#earlyCompletion = undefined;
  }

  #takeEarlyCompletion(): Extract<ServerNotification, { method: "account/login/completed" }> | undefined {
    const completion = this.#earlyCompletion;
    this.#earlyCompletion = undefined;
    return completion;
  }

  #setStatus(status: FinanceAuthStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#emit(status);
  }
}

export class FinanceAuthError extends Error {
  readonly code:
    | "already_authenticated"
    | "invalid_login_response"
    | "login_failed"
    | "login_in_progress"
    | "protocol_incompatible";

  constructor(code: FinanceAuthError["code"]) {
    super("Finance assistant authentication operation was rejected.");
    this.name = "FinanceAuthError";
    this.code = code;
  }
}

function validProviderId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new FinanceAuthError("invalid_login_response");
  return value;
}

function validUserCode(value: string): string {
  if (!/^[A-Z0-9-]{4,32}$/.test(value)) throw new FinanceAuthError("invalid_login_response");
  return value;
}

function validVerificationUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new FinanceAuthError("invalid_login_response");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "auth.openai.com" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    throw new FinanceAuthError("invalid_login_response");
  }
  return parsed.toString();
}

function positiveTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > FINANCE_LOGIN_TIMEOUT_MS) {
    throw new FinanceAuthError("protocol_incompatible");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
