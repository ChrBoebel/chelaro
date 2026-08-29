import assert from "node:assert/strict";
import test from "node:test";

import { JsonLineFrameError, JsonLineFramer } from "../src/jsonl-framer.js";

test("jsonl framer: handles fragmented UTF-8, CRLF, and multiple frames", () => {
  const frames: string[] = [];
  const framer = new JsonLineFramer({ maxFrameBytes: 64, onFrame: (frame) => frames.push(frame) });
  const bytes = Buffer.from('{"text":"grüß"}\r\n{"ok":true}\n');
  const splitInsideUmlaut = bytes.indexOf(Buffer.from("ü")) + 1;
  framer.push(bytes.subarray(0, splitInsideUmlaut));
  framer.push(bytes.subarray(splitInsideUmlaut));
  assert.deepEqual(frames, ['{"text":"grüß"}', '{"ok":true}']);
});

test("jsonl framer: accepts an exact limit and rejects one byte above it", () => {
  const frames: string[] = [];
  const exact = new JsonLineFramer({ maxFrameBytes: 4, onFrame: (frame) => frames.push(frame) });
  exact.push(Buffer.from("1234\n"));
  assert.deepEqual(frames, ["1234"]);

  const oversized = new JsonLineFramer({ maxFrameBytes: 4, onFrame: () => assert.fail() });
  oversized.push(Buffer.from("12"));
  assert.throws(() => oversized.push(Buffer.from("345")), JsonLineFrameError);
});

test("jsonl framer: rejects invalid UTF-8 and supports a final unterminated frame", () => {
  const frames: string[] = [];
  const invalid = new JsonLineFramer({ onFrame: () => assert.fail() });
  assert.throws(() => invalid.push(Buffer.from([0xc3, 0x28, 0x0a])), /not valid UTF-8/);

  const final = new JsonLineFramer({ onFrame: (frame) => frames.push(frame) });
  final.push(Buffer.from('{"final":true}'));
  final.finish();
  assert.deepEqual(frames, ['{"final":true}']);
});
