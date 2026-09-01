import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

import {
  FORBIDDEN_NOTIFICATIONS,
  HANDLED_NOTIFICATIONS,
  IGNORED_NOTIFICATIONS,
  isForbiddenNotificationMethod,
} from "../src/finance-notification-policy.js";

// Read from the generated union rather than from a type: a Codex upgrade adds
// notifications at runtime, and `satisfies` only proves the reviewed lists are
// a subset of what the union offers, never that they still cover all of it.
const generatedMethods = (): string[] => {
  const source = readFileSync(
    resolve(dirname(new URL(import.meta.url).pathname), "../../generated/codex/ts/ServerNotification.ts"),
    "utf8",
  );
  return [...source.matchAll(/\{ "method": "([^"]+)"/gu)].map(([, method]) => method!);
};

test("contract: every server notification of the pinned App Server is reviewed exactly once", () => {
  const offered = generatedMethods();
  assert(offered.length > 0, "The generated ServerNotification union was not readable.");
  assert.equal(new Set(offered).size, offered.length, "Codex offered a notification method twice.");

  const reviewed = [...HANDLED_NOTIFICATIONS, ...FORBIDDEN_NOTIFICATIONS, ...IGNORED_NOTIFICATIONS];
  assert.equal(
    new Set(reviewed).size,
    reviewed.length,
    "A notification method is classified as handled, forbidden, and ignored at once.",
  );

  // Sorted so the failure names the exact upgrade delta a reviewer must decide on.
  assert.deepEqual(
    [...reviewed].sort(),
    [...offered].sort(),
    "The reviewed notification policy no longer matches the App Server. Classify every new method as handled, forbidden, or ignored before raising the supported Codex version.",
  );
});

test("contract: the reviewed notification lists stay sorted and forbid the capability stream", () => {
  for (const [name, list] of [
    ["handled", HANDLED_NOTIFICATIONS],
    ["forbidden", FORBIDDEN_NOTIFICATIONS],
    ["ignored", IGNORED_NOTIFICATIONS],
  ] as const) {
    assert.deepEqual([...list], [...list].sort(), `The ${name} notification list is not sorted.`);
  }

  for (const method of [
    "item/commandExecution/outputDelta",
    "item/fileChange/patchUpdated",
    "item/mcpToolCall/progress",
    "model/rerouted",
    "model/verification",
    "thread/realtime/started",
  ]) {
    assert(isForbiddenNotificationMethod(method), `${method} must abort a finance turn.`);
  }
  for (const method of ["item/completed", "turn/completed", "modelProvider/authRecoveryStarted"]) {
    assert(!isForbiddenNotificationMethod(method), `${method} must not abort a finance turn.`);
  }
});
