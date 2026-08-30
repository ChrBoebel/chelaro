import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";

import { existsSync } from "node:fs";

import { app, BrowserWindow, dialog, ipcMain, Menu, session } from "electron";
import { loadingPageUrl } from "./loading-page.mjs";
import { runFinanceAssistantE2e } from "./finance-assistant-e2e.mjs";
import {
  WEB_URL,
  createProcessManager,
  isAllowedNavigation,
  startFinanceServices,
  startPackagedFinanceServices,
} from "./runtime.mjs";
import { createUpdateManager } from "./update-manager.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDirectory, "../../..");
const desktopIconPath = path.join(app.getAppPath(), "assets/icon.png");
const preloadPath = path.join(currentDirectory, "preload.cjs");
const processManager = createProcessManager({ repoRoot });
const financeAssistantE2e = process.env.FINANCE_OS_E2E_SCENARIO === "finance-assistant";
const e2eDataRoot = financeAssistantE2e
  ? validatedE2eDataRoot(process.env.FINANCE_OS_E2E_DATA_ROOT)
  : undefined;

app.setName("Chelaro");

// Keep the established storage location so that the public rename cannot orphan local financial
// data. The internal path can be migrated separately once a tested, recoverable migration exists.
app.setPath(
  "userData",
  e2eDataRoot ?? path.join(app.getPath("appData"), "Finance OS"),
);

let mainWindow;
let appOrigin;
let shutdownComplete = false;
let shutdownPromise;
let updateManager;

async function loadConfiguredUpdater() {
  const configurationPath = path.join(process.resourcesPath, "app-update.yml");
  if (!app.isPackaged || !existsSync(configurationPath)) {
    return { updater: undefined, isEnabled: false };
  }

  const updaterModule = await import("electron-updater");
  const updater = updaterModule.autoUpdater ?? updaterModule.default?.autoUpdater;
  if (!updater) throw new Error("The desktop updater could not be loaded.");
  return { updater, isEnabled: true };
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 680,
    show: false,
    title: "Chelaro",
    icon: desktopIconPath,
    backgroundColor: "#f7f8f3",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    if (appOrigin && isAllowedNavigation(target, appOrigin)) return;
    event.preventDefault();
  });
  window.on("closed", () => {
    mainWindow = undefined;
  });

  return window;
}

async function bootstrap() {
  mainWindow = createMainWindow();
  await mainWindow.loadURL(loadingPageUrl);

  try {
    const services = app.isPackaged
      ? await startPackagedFinanceServices(processManager, {
          resourcesPath: process.resourcesPath,
          userDataPath: app.getPath("userData"),
          executablePath: process.execPath,
          userHome: app.getPath("home"),
        })
      : await startFinanceServices(processManager, {
          agentDataRoot: path.join(app.getPath("userData"), "finance-assistant"),
          userHome: app.getPath("home"),
          ...(financeAssistantE2e
            ? {
                agentHostEntryPath: path.join(
                  repoRoot,
                  "apps/agent-host/dist/test/finance-app-e2e-host.js",
                ),
                prepareDatabase: false,
              }
            : {}),
        });
    const webUrl = services.webUrl ?? WEB_URL;
    appOrigin = new URL(webUrl).origin;
    await mainWindow.loadURL(webUrl);
    updateManager?.start();
    await captureSmokeTestImage(mainWindow);
    if (financeAssistantE2e && e2eDataRoot) {
      const result = await runFinanceAssistantE2e(mainWindow, { dataRoot: e2eDataRoot });
      console.info(`[desktop] Finance Assistant E2E bestanden: ${JSON.stringify(result)}`);
      app.quit();
    }
  } catch (error) {
    console.error("[desktop] Start fehlgeschlagen:", error);
    if (financeAssistantE2e) {
      process.exitCode = 1;
      app.quit();
      return;
    }
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Chelaro konnte nicht gestartet werden",
      message: "Die lokalen Chelaro-Dienste konnten nicht gestartet werden.",
      detail: app.isPackaged
        ? `${error instanceof Error ? error.message : String(error)}\n\nStarte die App erneut. Deine lokalen Finanzdaten wurden nicht verändert.`
        : `${error instanceof Error ? error.message : String(error)}\n\nPrüfe, ob Docker Desktop läuft, und starte die App erneut.`,
    });
    app.quit();
  }
}

function validatedE2eDataRoot(value) {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    !path.basename(value).startsWith("finance-os-e2e-")
  ) {
    throw new Error("Finance Assistant E2E requires a dedicated temporary data root.");
  }
  return path.resolve(value);
}

async function captureSmokeTestImage(window) {
  const destination = process.env.FINANCE_OS_DESKTOP_CAPTURE_PATH;
  if (!destination) return;

  await new Promise((resolve) => setTimeout(resolve, 750));
  const image = await window.webContents.capturePage();
  await writeFile(destination, image.toPNG());
  console.info(`[desktop] Testaufnahme gespeichert: ${destination}`);

  if (process.env.FINANCE_OS_DESKTOP_EXIT_AFTER_CAPTURE === "1") app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    if (process.platform === "darwin") app.dock.setIcon(desktopIconPath);
    app.setAboutPanelOptions({
      applicationName: "Chelaro",
      applicationVersion: app.getVersion(),
      credits: "Jede Zahl. Belegt.\nEntwickelt von Christopher Böbel im Austausch mit der Community.",
      copyright: `Copyright © ${new Date().getFullYear()} Christopher Böbel`,
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: "appMenu" },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ]),
    );
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    let updaterConfiguration = { updater: undefined, isEnabled: false };
    try {
      updaterConfiguration = await loadConfiguredUpdater();
    } catch (error) {
      console.error("[desktop] Update-Funktion konnte nicht geladen werden:", error);
    }
    updateManager = createUpdateManager({
      updater: updaterConfiguration.updater,
      ipcMain,
      getWindow: () => mainWindow,
      isEnabled: updaterConfiguration.isEnabled,
      stopServices: async () => {
        await processManager.stopAll();
        shutdownComplete = true;
      },
    });
    await bootstrap();
  });
}

app.on("before-quit", (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  updateManager?.stop();
  shutdownPromise ??= processManager.stopAll().finally(() => {
    shutdownComplete = true;
    app.quit();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
