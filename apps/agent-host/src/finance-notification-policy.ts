import type { ServerNotification } from "../generated/codex/ts/ServerNotification.js";

type NotificationMethod = ServerNotification["method"];

/**
 * Notifications the finance host acts on: the turn stream it projects, the
 * account state the auth controller tracks, token usage, compaction, and the
 * remote-control status it refuses to run under.
 */
export const HANDLED_NOTIFICATIONS = [
  "account/login/completed",
  "account/updated",
  "error",
  "item/agentMessage/delta",
  "item/completed",
  "item/started",
  "remoteControl/status/changed",
  "thread/compacted",
  "thread/tokenUsage/updated",
  "turn/completed",
  "turn/started",
] as const satisfies ReadonlyArray<NotificationMethod>;

/**
 * Notifications that may not reach a finance turn at all. Each one is evidence
 * that a capability ADR 0010 forbids became active — command execution, file
 * changes, MCP servers, plans, hooks, web search, images, collaboration,
 * sub-agents, permissions, patches, approvals, the guardian, auto-review,
 * execution environments, external agents, thread goals and projects, the
 * realtime channel, or filesystem watching. `model/rerouted` and
 * `model/verification` belong here because they mean Codex ran a model other
 * than the one the thread echoed back, which voids the verified configuration.
 * Seeing one aborts the turn.
 */
export const FORBIDDEN_NOTIFICATIONS = [
  "autoApprovalReview/strictReviewRequired",
  "command/exec/outputDelta",
  "externalAgentConfig/import/completed",
  "externalAgentConfig/import/progress",
  "fs/changed",
  "guardianWarning",
  "hook/completed",
  "hook/started",
  "item/autoApprovalReview/completed",
  "item/autoApprovalReview/started",
  "item/commandExecution/outputDelta",
  "item/commandExecution/terminalInteraction",
  "item/fileChange/outputDelta",
  "item/fileChange/patchUpdated",
  "item/mcpToolCall/progress",
  "item/plan/delta",
  "mcpServer/event/stream/notification",
  "mcpServer/oauthLogin/completed",
  "mcpServer/startupStatus/updated",
  "model/rerouted",
  "model/verification",
  "process/exited",
  "process/outputDelta",
  "project/changed",
  "thread/environment/connected",
  "thread/environment/disconnected",
  "thread/goal/cleared",
  "thread/goal/updated",
  "thread/project/updated",
  "thread/realtime/closed",
  "thread/realtime/error",
  "thread/realtime/item/completed",
  "thread/realtime/item/started",
  "thread/realtime/item/transcript/delta",
  "thread/realtime/itemAdded",
  "thread/realtime/outputAudio/delta",
  "thread/realtime/sdp",
  "thread/realtime/started",
  "thread/realtime/transcript/delta",
  "thread/realtime/transcript/done",
  "turn/diff/updated",
  "turn/plan/updated",
] as const satisfies ReadonlyArray<NotificationMethod>;

/**
 * Notifications reviewed as carrying no capability and no state the finance
 * host projects, so they are dropped. Thread bookkeeping Chelaro does not
 * mirror (ADR 0013 makes the local database the source of truth for the
 * visible conversation), reasoning deltas the plain-text renderer never shows,
 * raw provider payloads the item projection replaces, catalog and warning
 * notices, and file-search sessions Chelaro never opens.
 *
 * `modelProvider/authRecoveryStarted` and `modelProvider/authRecoveryCompleted`
 * are here deliberately: they report that the CLI refreshed provider
 * credentials during a turn. That grants no capability and changes no thread
 * configuration, and an account change that does matter arrives separately as
 * `account/updated`, which the auth controller handles.
 */
export const IGNORED_NOTIFICATIONS = [
  "account/rateLimits/updated",
  "app/list/updated",
  "configWarning",
  "deprecationNotice",
  "fuzzyFileSearch/sessionCompleted",
  "fuzzyFileSearch/sessionUpdated",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "model/safetyBuffering/updated",
  "modelProvider/authRecoveryCompleted",
  "modelProvider/authRecoveryStarted",
  "rawResponse/completed",
  "rawResponseItem/completed",
  "serverRequest/resolved",
  "skills/changed",
  "thread/archived",
  "thread/closed",
  "thread/deleted",
  "thread/name/updated",
  "thread/queue/changed",
  "thread/reverted",
  "thread/settings/updated",
  "thread/started",
  "thread/status/changed",
  "thread/unarchived",
  "turn/moderationMetadata",
  "warning",
  "windows/worldWritableWarning",
  "windowsSandbox/setupCompleted",
] as const satisfies ReadonlyArray<NotificationMethod>;

const forbidden: ReadonlySet<string> = new Set(FORBIDDEN_NOTIFICATIONS);

export function isForbiddenNotificationMethod(method: string): boolean {
  return forbidden.has(method);
}
