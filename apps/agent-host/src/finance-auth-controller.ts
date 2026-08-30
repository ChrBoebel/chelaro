import type { ServerNotification } from "../generated/codex/ts/ServerNotification.js";
import { FINANCE_CONSENT_VERSION } from "./consent-journal.js";
import type { FinanceConsentAuthority } from "./finance-tool-dispatcher.js";
import { assertFinanceAccountResponse } from "./finance-response-validator.js";

export type FinanceAuthStatus = "unknown" | "logged_out" | "authenticated";

export interface FinanceAuthProcessPort {
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
}

export interface FinanceAuthControllerOptions {
  consent: FinanceConsentAuthority;
  emit: (status: FinanceAuthStatus) => void;
  process: FinanceAuthProcessPort;
}

export class FinanceAuthController {
  readonly #consent: FinanceConsentAuthority;
  readonly #emit: (status: FinanceAuthStatus) => void;
  readonly #process: FinanceAuthProcessPort;
  #status: FinanceAuthStatus = "unknown";

  constructor(options: FinanceAuthControllerOptions) {
    this.#consent = options.consent;
    this.#emit = options.emit;
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

  handleNotification(notification: ServerNotification): boolean {
    if (notification.method === "account/updated") {
      this.#setStatus(notification.params.authMode === null ? "logged_out" : "authenticated");
      return true;
    }
    if (notification.method === "account/login/completed") {
      throw new FinanceAuthError("unexpected_login_flow");
    }
    return false;
  }

  stop(): void {
    this.#setStatus("unknown");
  }

  #setStatus(status: FinanceAuthStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#emit(status);
  }
}

export class FinanceAuthError extends Error {
  readonly code: "unexpected_login_flow";

  constructor(code: FinanceAuthError["code"]) {
    super("Finance assistant authentication operation was rejected.");
    this.name = "FinanceAuthError";
    this.code = code;
  }
}
