import type { ServerRequest } from "../generated/codex/ts/ServerRequest.js";
import type { FinanceToolDispatcher } from "./finance-tool-dispatcher.js";
import {
  JsonRpcDeferredServerResponse,
  JsonRpcDeferredServerError,
  JsonRpcServerRequestError,
  type CodexServerRequest,
} from "./json-rpc-client.js";
import { validateServerRequest } from "./runtime-validator.js";
import { classifyServerRequest } from "./server-request-policy.js";

export interface FinanceServerRequestHandlerOptions {
  dispatcher: Pick<FinanceToolDispatcher, "dispatch">;
  onAbortTurn: () => Promise<void> | void;
}

export class FinanceServerRequestHandler {
  readonly #dispatcher: Pick<FinanceToolDispatcher, "dispatch">;
  readonly #onAbortTurn: () => Promise<void> | void;

  constructor(options: FinanceServerRequestHandlerOptions) {
    this.#dispatcher = options.dispatcher;
    this.#onAbortTurn = options.onAbortTurn;
  }

  async handle(request: CodexServerRequest): Promise<unknown> {
    const envelope = { id: request.id, method: request.method, params: request.params };
    try {
      validateServerRequest(envelope);
    } catch {
      return new JsonRpcDeferredServerError(
        new JsonRpcServerRequestError(-32_600, "Invalid Request"),
        this.#onAbortTurn,
      );
    }
    const outcome = classifyServerRequest(envelope as ServerRequest);
    switch (outcome.kind) {
      case "finance_tool": {
        const dispatched = await this.#dispatcher.dispatch(outcome.params);
        return dispatched.abortTurn
          ? new JsonRpcDeferredServerResponse(dispatched.response, this.#onAbortTurn)
          : dispatched.response;
      }
      case "response":
        return outcome.abortTurn
          ? new JsonRpcDeferredServerResponse(outcome.result, this.#onAbortTurn)
          : outcome.result;
      case "error":
        return new JsonRpcDeferredServerError(
          new JsonRpcServerRequestError(outcome.error.code, outcome.error.message),
          this.#onAbortTurn,
        );
    }
  }
}
