export const UPDATE_CHANNELS = Object.freeze({
  getState: "finance-os:update:get-state",
  check: "finance-os:update:check",
  download: "finance-os:update:download",
  openInstaller: "finance-os:update:open-installer",
  openReleasePage: "finance-os:update:open-release-page",
  stateChanged: "finance-os:update:state-changed",
});

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 10_000;

export function createUpdateManager({
  releaseClient,
  ipcMain,
  getWindow,
  isEnabled,
  currentVersion,
  downloadsDirectory,
  openInstaller,
  openReleasePage,
  logger = console,
  initialCheckDelayMs = INITIAL_CHECK_DELAY_MS,
  checkIntervalMs = CHECK_INTERVAL_MS,
}) {
  let state = Object.freeze({ status: isEnabled ? "idle" : "disabled" });
  let availableRelease;
  let downloadedInstallerPath;
  let initialTimer;
  let intervalTimer;

  const publish = (nextState) => {
    state = Object.freeze({ ...nextState });
    const window = getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(UPDATE_CHANNELS.stateChanged, state);
    }
  };

  const assertTrustedSender = (event) => {
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents) {
      throw new Error("Untrusted update request.");
    }
  };

  ipcMain.handle(UPDATE_CHANNELS.getState, (event) => {
    assertTrustedSender(event);
    return state;
  });
  ipcMain.handle(UPDATE_CHANNELS.check, async (event) => {
    assertTrustedSender(event);
    await check();
    return state;
  });
  ipcMain.handle(UPDATE_CHANNELS.download, async (event) => {
    assertTrustedSender(event);
    const canRetry = state.status === "error" && state.stage === "download";
    if (!isEnabled || !availableRelease || (state.status !== "available" && !canRetry)) return state;
    publish({ status: "downloading", version: availableRelease.version, percent: 0 });
    try {
      downloadedInstallerPath = await releaseClient.downloadRelease(
        availableRelease,
        downloadsDirectory,
        (percent) => publish({
          status: "downloading",
          version: availableRelease.version,
          percent,
        }),
      );
      publish({ status: "downloaded", version: availableRelease.version });
    } catch (error) {
      logger.error("[desktop] Update-Download fehlgeschlagen:", error);
      publish({ status: "error", stage: "download", version: availableRelease.version });
    }
    return state;
  });
  ipcMain.handle(UPDATE_CHANNELS.openInstaller, async (event) => {
    assertTrustedSender(event);
    const canRetry = state.status === "error" && state.stage === "open";
    if (!isEnabled || !downloadedInstallerPath || (state.status !== "downloaded" && !canRetry)) {
      return state;
    }
    try {
      await openInstaller(downloadedInstallerPath);
    } catch (error) {
      logger.error("[desktop] Update-DMG konnte nicht geöffnet werden:", error);
      publish({ status: "error", stage: "open", version: availableRelease.version });
    }
    return state;
  });
  ipcMain.handle(UPDATE_CHANNELS.openReleasePage, async (event) => {
    assertTrustedSender(event);
    if (!isEnabled || !availableRelease) return state;
    await openReleasePage(availableRelease.pageUrl);
    return state;
  });

  const check = async () => {
    if (!isEnabled || ["downloading", "downloaded"].includes(state.status)) return;
    publish({ status: "checking" });
    try {
      availableRelease = await releaseClient.getLatestRelease(currentVersion);
      publish(availableRelease
        ? { status: "available", version: availableRelease.version }
        : { status: "idle" });
    } catch (error) {
      logger.error("[desktop] Update-Prüfung fehlgeschlagen:", error);
      publish({ status: "error", stage: "check" });
    }
  };

  return {
    getState: () => state,
    start() {
      if (!isEnabled || initialTimer || intervalTimer) return;
      initialTimer = setTimeout(() => void check(), initialCheckDelayMs);
      initialTimer.unref?.();
      intervalTimer = setInterval(() => void check(), checkIntervalMs);
      intervalTimer.unref?.();
    },
    stop() {
      if (initialTimer) clearTimeout(initialTimer);
      if (intervalTimer) clearInterval(intervalTimer);
      initialTimer = undefined;
      intervalTimer = undefined;
      for (const channel of [
        UPDATE_CHANNELS.getState,
        UPDATE_CHANNELS.check,
        UPDATE_CHANNELS.download,
        UPDATE_CHANNELS.openInstaller,
        UPDATE_CHANNELS.openReleasePage,
      ]) {
        ipcMain.removeHandler(channel);
      }
    },
  };
}
