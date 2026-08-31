import { writeFile } from "node:fs/promises";
import path from "node:path";

const E2E_TIMEOUT_MS = 30_000;

export async function runUpdateFlowE2e(window, { dataRoot, evidence }) {
  const resultPath = path.join(dataRoot, "desktop-update-e2e-result.json");
  const screenshotPath = path.join(dataRoot, "desktop-update-e2e.png");
  try {
    await waitForButton(window, "Update 0.4.0");
    await clickButton(window, "Update 0.4.0");
    await waitForText(window, "Chelaro 0.4.0 ist verfügbar");
    await waitForText(window, "Größe und SHA-256-Prüfsumme");
    await clickButton(window, "DMG herunterladen");
    await waitForText(window, "Download geprüft");
    await clickButton(window, "DMG öffnen");
    await clickButton(window, "Was ist neu?");

    const expectedInstallerPath = path.join(dataRoot, "Chelaro-0.4.0-arm64.dmg");
    const expectedReleasePage = "https://github.com/ChrBoebel/chelaro/releases/tag/v0.4.0";
    if (evidence.openedInstallerPath !== expectedInstallerPath) {
      throw new Error("The verified synthetic installer was not handed to the open action.");
    }
    if (evidence.openedReleasePage !== expectedReleasePage) {
      throw new Error("The exact synthetic release page was not handed to the external open action.");
    }

    const image = await window.webContents.capturePage();
    await writeFile(screenshotPath, image.toPNG(), { mode: 0o600 });
    const result = {
      updateAnnounced: true,
      instructionsShown: true,
      verifiedDownloadCompleted: true,
      installerOpenRequested: true,
      releaseNotesOpenRequested: true,
      temporaryDataRootOnly: true,
    };
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    return result;
  } catch (error) {
    const uiText = await window.webContents.executeJavaScript(
      "document.body?.innerText.slice(0, 4000) ?? ''",
      true,
    ).catch(() => "");
    const result = {
      error: error instanceof Error ? error.message : String(error),
      temporaryDataRootOnly: true,
      uiText,
    };
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    throw error;
  }
}

async function clickButton(window, label) {
  const clicked = await window.webContents.executeJavaScript(`
    (() => {
      const label = ${JSON.stringify(label)};
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.replace("verfügbar", "").trim() === label);
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()
  `, true);
  if (!clicked) throw new Error(`E2E button was unavailable: ${label}`);
}

async function waitForButton(window, label) {
  await waitForCondition(window, `
    [...document.querySelectorAll("button")].some((candidate) =>
      candidate.textContent?.replace("verfügbar", "").trim() === ${JSON.stringify(label)} &&
      candidate instanceof HTMLButtonElement &&
      !candidate.disabled
    )
  `, `E2E button did not appear: ${label}`);
}

async function waitForText(window, text) {
  await waitForCondition(
    window,
    `document.body?.innerText.includes(${JSON.stringify(text)}) ?? false`,
    `E2E text did not appear: ${text}`,
  );
}

async function waitForCondition(window, expression, errorMessage) {
  const deadline = Date.now() + E2E_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression, true)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(errorMessage);
}
