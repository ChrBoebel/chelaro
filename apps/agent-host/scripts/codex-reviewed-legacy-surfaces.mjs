import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// 0.153.3 adds optional thread model/effort metadata and nullable agent-message
// questions. Older payloads still validate. Only the exact reviewed before/after
// pair is accepted: changing either schema requires a fresh compatibility review.
const reviewed = JSON.parse(readFileSync(new URL("./codex-reviewed-legacy-surfaces.json", import.meta.url), "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function isReviewedLegacySurface(version, file, current, legacy) {
  const pair = reviewed.surfaces[file];
  return reviewed.legacyVersions.includes(version) && pair !== undefined &&
    digest(current) === pair.current && digest(legacy) === pair.legacy;
}
