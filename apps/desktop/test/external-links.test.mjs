import assert from "node:assert/strict";
import test from "node:test";

import {
  EXTERNAL_LINK_CHANNELS,
  createExternalLinkManager,
  createPlatformExternalOpener,
  isAllowedOpenAiLoginUrl,
} from "../src/external-links.mjs";

test("external opener uses the native macOS browser launcher", async () => {
  const executions = [];
  const shellCalls = [];
  const openExternal = createPlatformExternalOpener({
    execFile(command, args, callback) {
      executions.push({ args, command });
      callback(null);
    },
    platform: "darwin",
    shellOpenExternal: async (...args) => shellCalls.push(args),
  });

  await openExternal("https://auth.openai.com/device", { activate: true });

  assert.deepEqual(executions, [{
    args: ["-n", "https://auth.openai.com/device"],
    command: "/usr/bin/open",
  }]);
  assert.deepEqual(shellCalls, []);
});

test("external opener keeps Electron shell handling on other platforms", async () => {
  const shellCalls = [];
  const openExternal = createPlatformExternalOpener({
    execFile() {
      throw new Error("macOS launcher must not run");
    },
    platform: "linux",
    shellOpenExternal: async (...args) => shellCalls.push(args),
  });

  await openExternal("https://auth.openai.com/device", { activate: true });

  assert.deepEqual(shellCalls, [[
    "https://auth.openai.com/device",
    { activate: true },
  ]]);
});

test("external login accepts only the pinned OpenAI HTTPS origin", () => {
  assert.equal(isAllowedOpenAiLoginUrl("https://auth.openai.com/device?code=TEST"), true);
  assert.equal(isAllowedOpenAiLoginUrl("http://auth.openai.com/device"), false);
  assert.equal(isAllowedOpenAiLoginUrl("https://auth.openai.com.example/device"), false);
  assert.equal(isAllowedOpenAiLoginUrl("https://user@auth.openai.com/device"), false);
  assert.equal(isAllowedOpenAiLoginUrl("https://auth.openai.com/device#fragment"), false);
});

test("external login opens only for the main Chelaro renderer", async () => {
  let handler;
  let removed;
  const webContents = {};
  const opened = [];
  const manager = createExternalLinkManager({
    getAppOrigin: () => "http://127.0.0.1:3000",
    getWindow: () => ({ isDestroyed: () => false, webContents }),
    ipcMain: {
      handle(channel, nextHandler) {
        assert.equal(channel, EXTERNAL_LINK_CHANNELS.openOpenAiLogin);
        handler = nextHandler;
      },
      removeHandler(channel) {
        removed = channel;
      },
    },
    logger: { info() {} },
    openExternal: async (url, options) => opened.push({ options, url }),
  });

  const event = {
    sender: webContents,
    senderFrame: { url: "http://127.0.0.1:3000/" },
  };
  assert.equal(await handler(event, "https://auth.openai.com/device"), true);
  assert.deepEqual(opened, [{
    options: { activate: true },
    url: "https://auth.openai.com/device",
  }]);
  await assert.rejects(
    handler({ ...event, sender: {} }, "https://auth.openai.com/device"),
    /Untrusted/,
  );
  await assert.rejects(handler(event, "https://example.com/device"), /rejected/);

  manager.stop();
  assert.equal(removed, EXTERNAL_LINK_CHANNELS.openOpenAiLogin);
});
