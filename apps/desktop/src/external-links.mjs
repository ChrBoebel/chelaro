export const EXTERNAL_LINK_CHANNELS = Object.freeze({
  openOpenAiLogin: "finance-os:external:open-openai-login",
});

export function createPlatformExternalOpener({
  execFile,
  platform,
  shellOpenExternal,
}) {
  return async (url, options = {}) => {
    if (platform !== "darwin") {
      await shellOpenExternal(url, options);
      return;
    }

    await new Promise((resolve, reject) => {
      // Launch a fresh default-browser instance so LaunchServices cannot route the URL to an
      // unrelated process that happens to share the browser's bundle ID (for example Chrome
      // running headlessly for screenshots). The browser's own profile lock forwards the URL
      // to the regular user window.
      const args = options.activate === false ? ["-g", "-n", url] : ["-n", url];
      execFile("/usr/bin/open", args, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  };
}

export function isAllowedOpenAiLoginUrl(value) {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "auth.openai.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export function createExternalLinkManager({
  getAppOrigin,
  getWindow,
  ipcMain,
  logger = console,
  openExternal,
}) {
  ipcMain.handle(EXTERNAL_LINK_CHANNELS.openOpenAiLogin, async (event, url) => {
    const window = getWindow();
    const appOrigin = getAppOrigin();
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      !event.senderFrame ||
      !appOrigin ||
      new URL(event.senderFrame.url).origin !== appOrigin
    ) {
      throw new Error("Untrusted external-link request.");
    }
    if (!isAllowedOpenAiLoginUrl(url)) throw new Error("External login URL rejected.");
    logger.info(`[desktop] Öffne OpenAI-Anmeldung extern (${new URL(url).pathname}).`);
    await openExternal(url, { activate: true });
    logger.info("[desktop] OpenAI-Anmeldung wurde an den Browser übergeben.");
    return true;
  });

  return {
    stop() {
      ipcMain.removeHandler(EXTERNAL_LINK_CHANNELS.openOpenAiLogin);
    },
  };
}
