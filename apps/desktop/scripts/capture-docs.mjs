import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

import { app, BrowserWindow } from "electron";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, "../../..");
const allowedOutputRoot = path.join(repositoryRoot, "docs/assets/screenshots");
const captureUrl = new URL(
  process.env.FINANCE_OS_DOCS_CAPTURE_URL ?? "http://127.0.0.1:3000",
);
const outputRoot = path.resolve(
  process.env.FINANCE_OS_DOCS_CAPTURE_PATH ?? allowedOutputRoot,
);

if (
  process.env.FINANCE_OS_DOCS_SYNTHETIC_DATA_CONFIRMED !== "1" ||
  !["127.0.0.1", "localhost"].includes(captureUrl.hostname)
) {
  throw new Error(
    "Documentation capture requires confirmed synthetic data on a loopback URL.",
  );
}

const relativeOutput = path.relative(allowedOutputRoot, outputRoot);
if (relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) {
  throw new Error("Documentation captures must stay below docs/assets/screenshots.");
}

const views = [
  { name: "overview", label: null },
  { name: "documents", label: "Dokumente" },
  { name: "workbook", label: "Rechnungen" },
];

async function captureDocumentation() {
  await mkdir(outputRoot, { recursive: true });
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    show: false,
    title: "Chelaro",
    backgroundColor: "#f3f1eb",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await window.loadURL(captureUrl.toString());
  await delay(1_000);

  for (const view of views) {
    if (view.label) {
      const clicked = await window.webContents.executeJavaScript(`
        (() => {
          const label = ${JSON.stringify(view.label)};
          const button = [...document.querySelectorAll("button")]
            .find((candidate) => candidate.textContent?.trim() === label);
          if (!button) return false;
          button.click();
          return true;
        })()
      `);
      if (!clicked) throw new Error(`Navigation button not found: ${view.label}`);
      await delay(500);
    }

    const image = await window.webContents.capturePage();
    await writeFile(path.join(outputRoot, `${view.name}.png`), image.toPNG());
  }

  window.destroy();
  app.quit();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

app.whenReady().then(captureDocumentation).catch((error) => {
  console.error(error);
  app.exit(1);
});
