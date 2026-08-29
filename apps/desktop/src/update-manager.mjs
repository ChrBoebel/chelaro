export const UPDATE_CHANNELS = Object.freeze({
  getState: "finance-os:update:get-state",
  download: "finance-os:update:download",
  install: "finance-os:update:install",
  stateChanged: "finance-os:update:state-changed",
});

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 10_000;

export function createUpdateManager({
  updater,
  ipcMain,
  getWindow,
  isEnabled,
  stopServices,
  logger = console,
  initialCheckDelayMs = INITIAL_CHECK_DELAY_MS,
  checkIntervalMs = CHECK_INTERVAL_MS,
}) {
  let state = Object.freeze({ status: isEnabled ? "idle" : "disabled" });
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
  ipcMain.handle(UPDATE_CHANNELS.download, async (event) => {
    assertTrustedSender(event);
    if (!isEnabled || state.status !== "available") return state;
    publish({ status: "downloading", version: state.version, percent: 0 });
    try {
      await updater.downloadUpdate();
    } catch (error) {
      logger.error("[desktop] Update-Download fehlgeschlagen:", error);
      publish({ status: "error" });
    }
    return state;
  });
  ipcMain.handle(UPDATE_CHANNELS.install, async (event) => {
    assertTrustedSender(event);
    if (!isEnabled || state.status !== "downloaded") return state;
    publish({ status: "installing", version: state.version });
    try {
      await stopServices();
      updater.quitAndInstall(false, true);
    } catch (error) {
      logger.error("[desktop] Update-Installation fehlgeschlagen:", error);
      publish({ status: "error" });
    }
    return state;
  });

  if (isEnabled) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    updater.on("checking-for-update", () => publish({ status: "checking" }));
    updater.on("update-available", (info) =>
      publish({ status: "available", version: info.version }),
    );
    updater.on("update-not-available", () => publish({ status: "idle" }));
    updater.on("download-progress", (progress) =>
      publish({
        status: "downloading",
        version: state.version,
        percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
      }),
    );
    updater.on("update-downloaded", (info) =>
      publish({ status: "downloaded", version: info.version }),
    );
    updater.on("error", (error) => {
      logger.error("[desktop] Update-Prüfung fehlgeschlagen:", error);
      publish({ status: "error" });
    });
  }

  const check = async () => {
    if (!isEnabled || ["downloading", "downloaded", "installing"].includes(state.status)) return;
    try {
      await updater.checkForUpdates();
    } catch (error) {
      logger.error("[desktop] Update-Prüfung fehlgeschlagen:", error);
      publish({ status: "error" });
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
        UPDATE_CHANNELS.download,
        UPDATE_CHANNELS.install,
      ]) {
        ipcMain.removeHandler(channel);
      }
    },
  };
}
