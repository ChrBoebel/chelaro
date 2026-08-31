import assert from "node:assert/strict";
import test from "node:test";

import { UPDATE_CHANNELS, createUpdateManager } from "../src/update-manager.mjs";

const release = Object.freeze({
  version: "0.3.0",
  pageUrl: "https://github.com/ChrBoebel/chelaro/releases/tag/v0.3.0",
});

function createHarness({ enabled = true, latestRelease = release } = {}) {
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
  const openedInstallers = [];
  const openedReleasePages = [];
  const releaseClient = {
    getLatestRelease: async () => latestRelease,
    downloadRelease: async (_release, destination, onProgress) => {
      onProgress(42);
      return `${destination}/Chelaro-0.3.0-arm64.dmg`;
    },
  };
  const manager = createUpdateManager({
    releaseClient,
    ipcMain,
    getWindow: () => window,
    isEnabled: enabled,
    currentVersion: "0.2.2",
    downloadsDirectory: "/synthetic-downloads",
    openInstaller: async (installerPath) => openedInstallers.push(installerPath),
    openReleasePage: async (releasePageUrl) => openedReleasePages.push(releasePageUrl),
    initialCheckDelayMs: 60_000,
    checkIntervalMs: 60_000,
    logger: { error: () => {} },
  });
  const invoke = (channel, sender = webContents) => handlers.get(channel)({ sender });
  return {
    invoke,
    manager,
    openedInstallers,
    openedReleasePages,
    releaseClient,
    sent,
  };
}

test("a newer stable release is announced and downloaded with progress", async () => {
  const harness = createHarness();

  assert.deepEqual(await harness.invoke(UPDATE_CHANNELS.getState), { status: "idle" });
  await harness.invoke(UPDATE_CHANNELS.check);
  assert.deepEqual(harness.manager.getState(), { status: "available", version: "0.3.0" });

  await harness.invoke(UPDATE_CHANNELS.download);
  assert.deepEqual(harness.manager.getState(), { status: "downloaded", version: "0.3.0" });
  assert.ok(harness.sent.some(({ state }) => state.status === "downloading" && state.percent === 42));
  harness.manager.stop();
});

test("opening the verified DMG and release page uses only manager-owned paths and URLs", async () => {
  const harness = createHarness();
  await harness.invoke(UPDATE_CHANNELS.check);
  await harness.invoke(UPDATE_CHANNELS.openReleasePage);
  await harness.invoke(UPDATE_CHANNELS.download);
  await harness.invoke(UPDATE_CHANNELS.openInstaller);

  assert.deepEqual(harness.openedReleasePages, [release.pageUrl]);
  assert.deepEqual(harness.openedInstallers, ["/synthetic-downloads/Chelaro-0.3.0-arm64.dmg"]);
  harness.manager.stop();
});

test("failed downloads remain retryable without opening an unverified file", async () => {
  const harness = createHarness();
  let attempts = 0;
  harness.releaseClient.downloadRelease = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("checksum mismatch");
    return "/synthetic-downloads/Chelaro-0.3.0-arm64.dmg";
  };
  await harness.invoke(UPDATE_CHANNELS.check);

  await harness.invoke(UPDATE_CHANNELS.download);
  assert.deepEqual(harness.manager.getState(), {
    status: "error",
    stage: "download",
    version: "0.3.0",
  });
  await harness.invoke(UPDATE_CHANNELS.openInstaller);
  assert.deepEqual(harness.openedInstallers, []);

  await harness.invoke(UPDATE_CHANNELS.download);
  assert.equal(attempts, 2);
  assert.equal(harness.manager.getState().status, "downloaded");
  harness.manager.stop();
});

test("disabled updates stay inert and update IPC rejects another renderer", async () => {
  const harness = createHarness({ enabled: false });
  assert.deepEqual(await harness.invoke(UPDATE_CHANNELS.check), { status: "disabled" });
  assert.throws(
    () => harness.invoke(UPDATE_CHANNELS.getState, {}),
    /Untrusted update request/,
  );
  harness.manager.stop();
});
