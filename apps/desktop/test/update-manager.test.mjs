import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { UPDATE_CHANNELS, createUpdateManager } from "../src/update-manager.mjs";

function createHarness({ enabled = true } = {}) {
  const updater = new EventEmitter();
  updater.downloadUpdate = async () => {};
  updater.quitAndInstall = () => {};
  updater.checkForUpdates = async () => {};
  const handlers = new Map();
  const sent = [];
  const webContents = {
    send: (channel, state) => sent.push({ channel, state }),
  };
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => handlers.delete(channel),
  };
  const window = { isDestroyed: () => false, webContents };
  let servicesStopped = false;
  const manager = createUpdateManager({
    updater,
    ipcMain,
    getWindow: () => window,
    isEnabled: enabled,
    stopServices: async () => {
      servicesStopped = true;
    },
    initialCheckDelayMs: 60_000,
    checkIntervalMs: 60_000,
    logger: { error: () => {} },
  });
  const invoke = (channel) => handlers.get(channel)({ sender: webContents });
  return { updater, manager, sent, invoke, servicesStopped: () => servicesStopped };
}

test("update flow exposes the button only after a newer version is known", async () => {
  const harness = createHarness();

  assert.deepEqual(await harness.invoke(UPDATE_CHANNELS.getState), { status: "idle" });
  harness.updater.emit("update-available", { version: "0.2.1" });
  assert.deepEqual(harness.manager.getState(), { status: "available", version: "0.2.1" });

  await harness.invoke(UPDATE_CHANNELS.download);
  assert.deepEqual(harness.manager.getState(), {
    status: "downloading",
    version: "0.2.1",
    percent: 0,
  });

  harness.updater.emit("update-downloaded", { version: "0.2.1" });
  assert.equal(harness.sent.at(-1).channel, UPDATE_CHANNELS.stateChanged);
  harness.manager.stop();
});

test("install stops local services before handing off to the updater", async () => {
  const harness = createHarness();
  let installed = false;
  harness.updater.quitAndInstall = () => {
    assert.equal(harness.servicesStopped(), true);
    installed = true;
  };
  harness.updater.emit("update-downloaded", { version: "0.2.1" });

  await harness.invoke(UPDATE_CHANNELS.install);

  assert.equal(installed, true);
  harness.manager.stop();
});

test("failed downloads return the updater to a safe hidden state", async () => {
  const harness = createHarness();
  harness.updater.downloadUpdate = async () => {
    throw new Error("download unavailable");
  };
  harness.updater.emit("update-available", { version: "0.2.1" });

  await harness.invoke(UPDATE_CHANNELS.download);

  assert.deepEqual(harness.manager.getState(), { status: "error" });
  harness.manager.stop();
});

test("update IPC rejects requests from another renderer", async () => {
  const harness = createHarness();
  const getState = new Map();
  const updater = new EventEmitter();
  const ipcMain = {
    handle: (channel, handler) => getState.set(channel, handler),
    removeHandler: () => {},
  };
  createUpdateManager({
    updater,
    ipcMain,
    getWindow: () => ({ isDestroyed: () => false, webContents: {} }),
    isEnabled: false,
    stopServices: async () => {},
  });

  assert.throws(
    () => getState.get(UPDATE_CHANNELS.getState)({ sender: {} }),
    /Untrusted update request/,
  );
  harness.manager.stop();
});
