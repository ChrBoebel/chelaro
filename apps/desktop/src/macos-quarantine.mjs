import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const XATTR_PATH = "/usr/bin/xattr";
const DEFAULT_TIMEOUT_MS = 10_000;

export function createMacOsQuarantineMarker({
  execFileAsync = promisify(execFile),
  now = () => Date.now(),
  createId = randomUUID,
} = {}) {
  if (typeof execFileAsync !== "function" || typeof now !== "function" || typeof createId !== "function") {
    throw new Error("Valid macOS quarantine dependencies are required.");
  }

  return async function markFileQuarantined(filePath) {
    if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
      throw new Error("The quarantined download path must be absolute.");
    }

    const timestamp = Math.floor(now() / 1_000).toString(16);
    const quarantineValue = `0083;${timestamp};Chelaro;${createId()}`;
    await execFileAsync(
      XATTR_PATH,
      ["-w", "com.apple.quarantine", quarantineValue, filePath],
      { timeout: DEFAULT_TIMEOUT_MS, windowsHide: true },
    );
  };
}
