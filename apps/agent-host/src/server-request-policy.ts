import type { ServerRequest } from "../generated/codex/ts/ServerRequest.js";
import type { DynamicToolCallParams } from "../generated/codex/ts/v2/DynamicToolCallParams.js";

export const SUPPORTED_SERVER_REQUEST_METHODS = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
  "item/permissions/requestApproval",
  "item/tool/call",
  "account/chatgptAuthTokens/refresh",
  "attestation/generate",
  "applyPatchApproval",
  "execCommandApproval",
] as const satisfies ReadonlyArray<ServerRequest["method"]>;

export type ServerRequestPolicyOutcome =
  | { kind: "finance_tool"; params: DynamicToolCallParams }
  | { kind: "response"; result: unknown; abortTurn: boolean }
  | {
      kind: "error";
      error: { code: -32601; message: "Method not supported" };
      abortTurn: true;
    };

const methodNotSupported = (): ServerRequestPolicyOutcome => ({
  kind: "error",
  error: { code: -32601, message: "Method not supported" },
  abortTurn: true,
});

export function classifyServerRequest(request: ServerRequest): ServerRequestPolicyOutcome {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return { kind: "response", result: { decision: "decline" }, abortTurn: true };
    case "item/permissions/requestApproval":
      return {
        kind: "response",
        result: { permissions: {}, scope: "turn", strictAutoReview: true },
        abortTurn: true,
      };
    case "mcpServer/elicitation/request":
      return {
        kind: "response",
        result: { action: "decline", content: null, _meta: null },
        abortTurn: true,
      };
    case "applyPatchApproval":
      return {
        kind: "response",
        result: { decision: { denied: { rejection: "File changes are disabled." } } },
        abortTurn: true,
      };
    case "execCommandApproval":
      return {
        kind: "response",
        result: { decision: { denied: { rejection: "Command execution is disabled." } } },
        abortTurn: true,
      };
    case "item/tool/call":
      return { kind: "finance_tool", params: request.params };
    case "item/tool/requestUserInput":
    case "account/chatgptAuthTokens/refresh":
    case "attestation/generate":
      return methodNotSupported();
    default: {
      const exhaustive: never = request;
      return exhaustive;
    }
  }
}
