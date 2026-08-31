const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

const CODESIGN_PATH = "/usr/bin/codesign";
const CODESIGN_TIMEOUT_MS = 120_000;

async function signBundle(appPath, { execFileAsync = promisify(execFile) } = {}) {
  if (typeof appPath !== "string" || !path.isAbsolute(appPath) || path.extname(appPath) !== ".app") {
    throw new Error("The ad-hoc signed application path must be an absolute .app bundle.");
  }
  if (typeof execFileAsync !== "function") throw new Error("A codesign executor is required.");

  const options = { timeout: CODESIGN_TIMEOUT_MS, windowsHide: true };
  await execFileAsync(
    CODESIGN_PATH,
    ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath],
    options,
  );
  await execFileAsync(
    CODESIGN_PATH,
    ["--verify", "--deep", "--strict", "--verbose=2", appPath],
    options,
  );
}

async function adhocSignAfterPack(context) {
  if (process.platform !== "darwin") {
    throw new Error("Chelaro's macOS ad-hoc signing hook requires macOS.");
  }
  const appName = `${context.packager.appInfo.productFilename}.app`;
  await signBundle(path.join(context.appOutDir, appName));
}

module.exports = adhocSignAfterPack;
module.exports.signBundle = signBundle;
