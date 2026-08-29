const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

export const MAX_CODEX_FRAME_BYTES = 8 * 1024 * 1024;

export class JsonLineFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonLineFrameError";
  }
}

export interface JsonLineFramerOptions {
  maxFrameBytes?: number;
  onFrame: (frame: string) => void;
}

export class JsonLineFramer {
  readonly #decoder = new TextDecoder("utf-8", { fatal: true });
  readonly #maxFrameBytes: number;
  readonly #onFrame: (frame: string) => void;
  #failed = false;
  #frameBytes = 0;
  #parts: Buffer[] = [];

  constructor({ maxFrameBytes = MAX_CODEX_FRAME_BYTES, onFrame }: JsonLineFramerOptions) {
    if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1) {
      throw new TypeError("JSONL frame limit must be a positive safe integer.");
    }
    this.#maxFrameBytes = maxFrameBytes;
    this.#onFrame = onFrame;
  }

  push(chunk: Buffer): void {
    if (this.#failed) {
      return;
    }

    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(NEWLINE, offset);
      const end = newline === -1 ? chunk.length : newline;
      this.#append(chunk.subarray(offset, end));
      if (newline === -1) {
        return;
      }
      this.#emitFrame();
      offset = newline + 1;
    }
  }

  finish(): void {
    if (!this.#failed && this.#frameBytes > 0) {
      this.#emitFrame();
    }
  }

  #append(part: Buffer): void {
    if (part.length === 0) {
      return;
    }
    if (this.#frameBytes + part.length > this.#maxFrameBytes) {
      this.#failed = true;
      this.#parts = [];
      this.#frameBytes = 0;
      throw new JsonLineFrameError(`Codex JSONL frame exceeds ${this.#maxFrameBytes} bytes.`);
    }
    this.#parts.push(part);
    this.#frameBytes += part.length;
  }

  #emitFrame(): void {
    let frame = this.#parts.length === 1 ? this.#parts[0]! : Buffer.concat(this.#parts, this.#frameBytes);
    if (frame.at(-1) === CARRIAGE_RETURN) {
      frame = frame.subarray(0, -1);
    }
    this.#parts = [];
    this.#frameBytes = 0;

    let decoded: string;
    try {
      decoded = this.#decoder.decode(frame);
    } catch (error) {
      this.#failed = true;
      throw new JsonLineFrameError(`Codex JSONL frame is not valid UTF-8: ${String(error)}`);
    }
    this.#onFrame(decoded);
  }
}
