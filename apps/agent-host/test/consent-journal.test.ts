import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  FINANCE_CONSENT_DATA_CATEGORIES,
  FINANCE_CONSENT_NOTICE_HASH,
  FINANCE_CONSENT_PROVIDER,
  FINANCE_CONSENT_SCHEMA_VERSION,
  FINANCE_CONSENT_VERSION,
  FinanceConsentJournal,
  FinanceConsentJournalError,
} from "../src/consent-journal.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function fixture(): { journal: FinanceConsentJournal; path: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "finance-os-consent-"));
  temporaryRoots.push(root);
  const path = join(root, "private", "consent.ndjson");
  let instant = 0;
  return {
    journal: new FinanceConsentJournal({
      journalPath: path,
      now: () => new Date(Date.UTC(2026, 7, 28, 10, 0, instant++)),
    }),
    path,
    root,
  };
}

test("consent journal: records an exact, owner-only, durable grant", () => {
  const { journal, path } = fixture();
  assert.deepEqual(journal.load(), {
    denialReason: "missing",
    sequence: 0,
    status: "unknown",
    version: null,
  });

  const granted = journal.grant();
  assert.deepEqual(granted, {
    denialReason: null,
    sequence: 1,
    status: "granted",
    version: FINANCE_CONSENT_VERSION,
  });
  assert.doesNotThrow(() => journal.assertGranted(FINANCE_CONSENT_VERSION));

  const [record] = readFileSync(path, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
  assert.equal(record.provider, FINANCE_CONSENT_PROVIDER);
  assert.equal(record.schemaVersion, FINANCE_CONSENT_SCHEMA_VERSION);
  assert.equal(record.noticeHash, FINANCE_CONSENT_NOTICE_HASH);
  assert.deepEqual(record.categories, FINANCE_CONSENT_DATA_CATEGORIES);
  assert.match(record.recordHash, /^[a-f0-9]{64}$/);
});

test("consent journal: revoke-pending remains the authoritative deny barrier after restart", () => {
  const { journal, path } = fixture();
  journal.grant();
  const pending = journal.beginRevocation();
  assert.equal(pending.status, "revoke_pending");
  assert.throws(
    () => journal.assertGranted(FINANCE_CONSENT_VERSION),
    (error: unknown) => error instanceof FinanceConsentJournalError && error.code === "consent_denied",
  );

  const restarted = new FinanceConsentJournal({ journalPath: path });
  assert.equal(restarted.load().status, "revoke_pending");
  assert.throws(() => restarted.assertGranted(FINANCE_CONSENT_VERSION));
  assert.equal(restarted.completeRevocation().status, "revoked");
  assert.equal(restarted.completeRevocation().sequence, 3);
});

test("consent journal: detects a truncated tail and never revives the prior grant", () => {
  const { journal, path } = fixture();
  journal.grant();
  const grantedLine = readFileSync(path, "utf8");
  writeFileSync(path, `${grantedLine}{"action":"revoke_pending"`, { mode: 0o600 });

  const snapshot = journal.load();
  assert.equal(snapshot.status, "revoked");
  assert.equal(snapshot.denialReason, "invalid_journal");
  assert.throws(() => journal.assertGranted(FINANCE_CONSENT_VERSION));
  assert.throws(() => journal.beginRevocation());
});

test("consent journal: detects hash-chain tampering", () => {
  const { journal, path } = fixture();
  journal.grant();
  const contents = readFileSync(path, "utf8").replace('"provider":"openai"', '"provider":"other"');
  writeFileSync(path, contents, { mode: 0o600 });

  assert.deepEqual(journal.load(), {
    denialReason: "invalid_journal",
    sequence: 0,
    status: "revoked",
    version: null,
  });
});

test("consent journal: denies unknown schema and consent versions", () => {
  const { journal, path } = fixture();
  journal.grant();
  const record = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  record.consentVersion = "future.v99";
  writeFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });

  assert.equal(journal.load().denialReason, "unsupported_version");
  assert.throws(() => journal.grant());
});

test("consent journal: rejects group-readable files and directories", () => {
  const { journal, path, root } = fixture();
  journal.grant();
  chmodSync(path, 0o640);
  assert.equal(journal.load().denialReason, "invalid_permissions");

  chmodSync(path, 0o600);
  chmodSync(join(root, "private"), 0o750);
  assert.equal(journal.load().denialReason, "invalid_permissions");
});

test("consent journal: refuses a symlinked journal target", () => {
  const root = mkdtempSync(join(tmpdir(), "finance-os-consent-link-"));
  temporaryRoots.push(root);
  const privateDirectory = join(root, "private");
  const target = join(root, "target.ndjson");
  const path = join(privateDirectory, "consent.ndjson");
  writeFileSync(target, "", { mode: 0o600 });
  // The private directory itself is valid; only the journal target is untrusted.
  new FinanceConsentJournal({ journalPath: join(privateDirectory, "bootstrap.ndjson") }).grant();
  symlinkSync(target, path);

  const journal = new FinanceConsentJournal({ journalPath: path });
  assert.equal(journal.load().status, "revoked");
  assert.throws(() => journal.grant());

  rmSync(path);
  symlinkSync(join(root, "missing-target.ndjson"), path);
  assert.equal(journal.load().status, "revoked");
  assert.throws(() => journal.grant());
});
