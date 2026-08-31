import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  FinanceAssistantStreamProjector,
  FinanceChatStreamError,
  MAX_ASSISTANT_CHUNK_BYTES,
  MAX_ASSISTANT_MESSAGE_BYTES,
  type FinanceChatStreamEvent,
} from "../src/finance-chat-stream.js";

function fixture(): { events: FinanceChatStreamEvent[]; stream: FinanceAssistantStreamProjector } {
  const events: FinanceChatStreamEvent[] = [];
  return {
    events,
    stream: new FinanceAssistantStreamProjector({
      emit: (event) => events.push(event),
      providerThreadId: "provider_thread_1",
      providerTurnId: "provider_turn_1",
      sessionId: "session_1",
      turnId: "turn_1",
    }),
  };
}

function completed(text: string, itemId = "provider_item_1") {
  return {
    completedAtMs: 2,
    item: {
      delivery: null,
      id: itemId,
      memoryCitation: null,
      phase: "final_answer" as const,
      text,
      type: "agentMessage" as const,
    },
    threadId: "provider_thread_1",
    turnId: "provider_turn_1",
  };
}

test("finance chat stream: emits bounded, verifiable chunks for exact provider text", () => {
  const { events, stream } = fixture();
  const text = `Hallo ${"ü".repeat(MAX_ASSISTANT_CHUNK_BYTES)} Ende`;
  stream.receiveDelta({
    delta: text,
    itemId: "provider_item_1",
    threadId: "provider_thread_1",
    turnId: "provider_turn_1",
  });
  assert.equal(stream.completeItem(completed(text)), true);
  const persisted = stream.finishTurn();
  assert.equal(persisted[0]?.text, text);
  stream.publishCompletions();

  const chunks = events.filter((event) => event.type === "assistant.message.chunk");
  assert.equal(chunks.length > 1, true);
  assert.equal(chunks.every(({ rawBytes }) => rawBytes <= MAX_ASSISTANT_CHUNK_BYTES), true);
  const bytes = Buffer.concat(chunks.map(({ dataBase64 }) => Buffer.from(dataBase64, "base64")));
  assert.equal(bytes.toString("utf8"), text);
  const completion = events.find((event) => event.type === "assistant.message.completed");
  assert.equal(completion?.sha256, createHash("sha256").update(text).digest("hex"));
});

test("finance chat stream: publishes a canonical item even when no deltas arrived", () => {
  const { events, stream } = fixture();
  assert.equal(stream.completeItem(completed("Nur final")), true);
  stream.finishTurn();
  assert.equal(
    Buffer.from(events.find((event) => event.type === "assistant.message.chunk")?.dataBase64 ?? "", "base64").toString(),
    "Nur final",
  );
});

test("finance chat stream: ignores non-message completion items", () => {
  const { events, stream } = fixture();
  assert.equal(stream.completeItem({
    completedAtMs: 2,
    item: {
      arguments: {},
      contentItems: null,
      durationMs: 1,
      id: "tool_1",
      namespace: null,
      status: "completed",
      success: true,
      tool: "finance_get_overview",
      type: "dynamicToolCall",
    },
    threadId: "provider_thread_1",
    turnId: "provider_turn_1",
  }), false);
  assert.deepEqual(events, []);
});

test("finance chat stream: fails closed on provider binding or final-content mismatch", () => {
  const { stream } = fixture();
  assert.throws(
    () => stream.receiveDelta({
      delta: "foreign",
      itemId: "provider_item_1",
      threadId: "foreign_thread",
      turnId: "provider_turn_1",
    }),
    (error: unknown) => error instanceof FinanceChatStreamError && error.code === "provider_binding_mismatch",
  );
  stream.receiveDelta({
    delta: "first",
    itemId: "provider_item_1",
    threadId: "provider_thread_1",
    turnId: "provider_turn_1",
  });
  assert.throws(
    () => stream.completeItem(completed("different")),
    (error: unknown) => error instanceof FinanceChatStreamError && error.code === "content_mismatch",
  );
});

test("finance chat stream: enforces per-message output limits before emitting excess", () => {
  const { events, stream } = fixture();
  const exact = "a".repeat(MAX_ASSISTANT_MESSAGE_BYTES);
  stream.receiveDelta({
    delta: exact,
    itemId: "provider_item_1",
    threadId: "provider_thread_1",
    turnId: "provider_turn_1",
  });
  const eventCount = events.length;
  assert.throws(
    () => stream.receiveDelta({
      delta: "x",
      itemId: "provider_item_1",
      threadId: "provider_thread_1",
      turnId: "provider_turn_1",
    }),
    (error: unknown) => error instanceof FinanceChatStreamError && error.code === "content_too_large",
  );
  assert.equal(events.length, eventCount);
});

test("finance chat stream: refuses turn completion with partial messages", () => {
  const { stream } = fixture();
  stream.receiveDelta({
    delta: "partial",
    itemId: "provider_item_1",
    threadId: "provider_thread_1",
    turnId: "provider_turn_1",
  });
  assert.throws(
    () => stream.finishTurn(),
    (error: unknown) => error instanceof FinanceChatStreamError && error.code === "incomplete_message",
  );
});
