const { contextBridge, ipcRenderer } = require("electron");

const UPDATE_CHANNELS = Object.freeze({
  getState: "finance-os:update:get-state",
  download: "finance-os:update:download",
  install: "finance-os:update:install",
  stateChanged: "finance-os:update:state-changed",
});

contextBridge.exposeInMainWorld("financeOS", {
  platform: process.platform,
  updates: {
    getState: () => ipcRenderer.invoke(UPDATE_CHANNELS.getState),
    download: () => ipcRenderer.invoke(UPDATE_CHANNELS.download),
    install: () => ipcRenderer.invoke(UPDATE_CHANNELS.install),
    subscribe: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on(UPDATE_CHANNELS.stateChanged, handler);
      return () => ipcRenderer.removeListener(UPDATE_CHANNELS.stateChanged, handler);
    },
  },
});
