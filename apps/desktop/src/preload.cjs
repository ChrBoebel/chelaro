const { contextBridge, ipcRenderer } = require("electron");

const UPDATE_CHANNELS = Object.freeze({
  getState: "finance-os:update:get-state",
  check: "finance-os:update:check",
  download: "finance-os:update:download",
  openInstaller: "finance-os:update:open-installer",
  openReleasePage: "finance-os:update:open-release-page",
  stateChanged: "finance-os:update:state-changed",
});
const RUNTIME_VERSION_CHANNEL = "finance-os:runtime:get-version";

contextBridge.exposeInMainWorld("financeOS", {
  platform: process.platform,
  runtime: {
    getVersion: () => ipcRenderer.invoke(RUNTIME_VERSION_CHANNEL),
  },
  updates: {
    getState: () => ipcRenderer.invoke(UPDATE_CHANNELS.getState),
    check: () => ipcRenderer.invoke(UPDATE_CHANNELS.check),
    download: () => ipcRenderer.invoke(UPDATE_CHANNELS.download),
    openInstaller: () => ipcRenderer.invoke(UPDATE_CHANNELS.openInstaller),
    openReleasePage: () => ipcRenderer.invoke(UPDATE_CHANNELS.openReleasePage),
    subscribe: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on(UPDATE_CHANNELS.stateChanged, handler);
      return () => ipcRenderer.removeListener(UPDATE_CHANNELS.stateChanged, handler);
    },
  },
});
