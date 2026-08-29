import { createHash, type Hash } from "node:crypto";

import type { AgentMessageDeltaNotification } from "../generated/codex/ts/v2/AgentMessageDeltaNotification.js";
import type { ItemCompletedNotification } from "../generated/codex/ts/v2/ItemCompletedNotification.js";

export const MAX_ASSISTANT_CHUNK_BYTES = 32 * 1024;
export const MAX_ASSISTANT_MESSAGE_BYTES = 512 * 1024;
export const MAX_ASSISTANT_TURN_BYTES = 1024 * 1024;
export const MAX_ASSISTANT_MESSAGES_PER_TURN = 8;

export type FinanceChatStreamEvent =
  | {
      messageId: string;
      sessionId: string;
      turnId: string;
      type: "assistant.message.started";
    }
  | {
      dataBase64: string;
      messageId: string;
      rawBytes: number;
      sequence: number;
      sessionId: string;
      turnId: string;
      type: "assistant.message.chunk";
    }
  | {
      messageId: string;
      sessionId: string;
      sha256: string;
      totalBytes: number;
      turnId: string;
      type: "assistant.message.completed";
    };

interface ActiveMessage {
  completed: boolean;
  hasher: Hash;
  messageId: string;
  nextSequence: number;
  parts: Buffer[];
  totalBytes: number;
}

export interface FinanceAssistantStreamProjectorOptions {
  emit: (event: FinanceChatStreamEvent) => void;
  providerThreadId: string;
  providerTurnId: string;
  sessionId: string;
  turnId: string;
}

export class FinanceAssistantStreamProjector {
  readonly #emit: (event: FinanceChatStreamEvent) => void;
  readonly #messages = new Map<string, ActiveMessage>();
  readonly #providerThreadId: string;
  readonly #providerTurnId: string;
  readonly #sessionId: string;
  readonly #turnId: string;
  #terminal = false;
  #turnBytes = 0;

  constructor(options: FinanceAssistantStreamProjectorOptions) {
    this.#emit = options.emit;
    this.#providerThreadId = validId(options.providerThreadId);
    this.#providerTurnId = validId(options.providerTurnId);
    this.#sessionId = validId(options.sessionId);
    this.#turnId = validId(options.turnId);
  }

  receiveDelta(params: AgentMessageDeltaNotification): void {
    this.#assertActive();
    this.#assertProviderBinding(params.threadId, params.turnId);
    const providerItemId = validId(params.itemId);
    if (params.delta.length === 0) return;
    this.#publish(providerItemId, Buffer.from(params.delta, "utf8"));
  }

  completeItem(params: ItemCompletedNotification): boolean {
    this.#assertActive();
    this.#assertProviderBinding(params.threadId, params.turnId);
    if (params.item.type !== "agentMessage") return false;
    const providerItemId = validId(params.item.id);
    let message = this.#messages.get(providerItemId);
    const canonical = Buffer.from(params.item.text, "utf8");
    if (!message) {
      if (canonical.length > 0) this.#publish(providerItemId, canonical);
      message = this.#messages.get(providerItemId) ?? this.#startMessage(providerItemId);
    }
    if (message.completed) throw new FinanceChatStreamError("duplicate_completion");
    if (!Buffer.concat(message.parts, message.totalBytes).equals(canonical)) {
      throw new FinanceChatStreamError("content_mismatch");
    }
    message.completed = true;
    this.#emit({
      messageId: message.messageId,
      sessionId: this.#sessionId,
      sha256: message.hasher.digest("hex"),
      totalBytes: message.totalBytes,
      turnId: this.#turnId,
      type: "assistant.message.completed",
    });
    return true;
  }

  finishTurn(): void {
    this.#assertActive();
    if ([...this.#messages.values()].some(({ completed }) => !completed)) {
      throw new FinanceChatStreamError("incomplete_message");
    }
    this.#terminal = true;
  }

  abort(): void {
    this.#terminal = true;
    this.#messages.clear();
  }

  #publish(providerItemId: string, bytes: Buffer): void {
    const message = this.#messages.get(providerItemId) ?? this.#startMessage(providerItemId);
    if (message.completed) throw new FinanceChatStreamError("late_content");
    if (
      message.totalBytes + bytes.length > MAX_ASSISTANT_MESSAGE_BYTES ||
      this.#turnBytes + bytes.length > MAX_ASSISTANT_TURN_BYTES
    ) {
      throw new FinanceChatStreamError("content_too_large");
    }
    message.parts.push(bytes);
    message.hasher.update(bytes);
    message.totalBytes += bytes.length;
    this.#turnBytes += bytes.length;
    for (let offset = 0; offset < bytes.length; offset += MAX_ASSISTANT_CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + MAX_ASSISTANT_CHUNK_BYTES);
      this.#emit({
        dataBase64: chunk.toString("base64"),
        messageId: message.messageId,
        rawBytes: chunk.length,
        sequence: message.nextSequence,
        sessionId: this.#sessionId,
        turnId: this.#turnId,
        type: "assistant.message.chunk",
      });
      message.nextSequence += 1;
    }
  }

  #startMessage(providerItemId: string): ActiveMessage {
    if (this.#messages.size >= MAX_ASSISTANT_MESSAGES_PER_TURN) {
      throw new FinanceChatStreamError("too_many_messages");
    }
    const message: ActiveMessage = {
      completed: false,
      hasher: createHash("sha256"),
      messageId: `message_${this.#messages.size + 1}`,
      nextSequence: 0,
      parts: [],
      totalBytes: 0,
    };
    this.#messages.set(providerItemId, message);
    this.#emit({
      messageId: message.messageId,
      sessionId: this.#sessionId,
      turnId: this.#turnId,
      type: "assistant.message.started",
    });
    return message;
  }

  #assertProviderBinding(threadId: string, turnId: string): void {
    if (threadId !== this.#providerThreadId || turnId !== this.#providerTurnId) {
      throw new FinanceChatStreamError("provider_binding_mismatch");
    }
  }

  #assertActive(): void {
    if (this.#terminal) throw new FinanceChatStreamError("stream_terminal");
  }
}

export class FinanceChatStreamError extends Error {
  readonly code:
    | "content_mismatch"
    | "content_too_large"
    | "duplicate_completion"
    | "incomplete_message"
    | "invalid_identifier"
    | "late_content"
    | "provider_binding_mismatch"
    | "stream_terminal"
    | "too_many_messages";

  constructor(code: FinanceChatStreamError["code"]) {
    super("Finance assistant output stream was rejected.");
    this.name = "FinanceChatStreamError";
    this.code = code;
  }
}

function validId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new FinanceChatStreamError("invalid_identifier");
  }
  return value;
}
