# Sanitization Report

## Verdict

**PASS WITH WARNINGS — technisch für eine öffentliche Code-only Source Preview geeignet.**

Prüfzeitpunkt: 2026-08-29T04:35:39Z (UTC)

Der geprüfte Git-Stand besteht aus genau einem Root-Commit. Current Tree und der vollständige erreichbare Verlauf sind damit inhaltlich identisch. Es wurden keine veröffentlichungsblockierenden Secrets, personenbezogenen Daten, internen Referenzen, gefährlichen Artefakte oder visuellen Dateien gefunden. Dieser Bericht ist selbst Bestandteil des abschließend amendierten Root-Commits; die Commit- und Objektkontrollen wurden danach erneut ausgeführt.

## Umfang und Methode

- 1.222 getrackte Dateien einschließlich `FORK_REPORT.md` und dieses Berichts;
- Current Tree sowie jeder erreichbare Commit und Blob der vollständigen Ein-Commit-Historie;
- Dateinamen, Textinhalte, Git-Dateimodi, Dateisignaturen, Konfigurationsvorlagen, Links, Abhängigkeitsmanifesten und Lizenzhinweise;
- keine Installation, kein Netzwerkzugriff, kein Remote, kein Push und keine Veröffentlichung.

Verwendete Kernbefehle (Muster wurden jeweils auf `HEAD` und/oder dessen vollständigen Baum angewendet):

```text
git status --short --branch
git rev-list --all --count
git show -s --format='parents=%P%nA=%an <%ae>%nC=%cn <%ce>' HEAD
git remote -v
git tag --list
git ls-tree -r --name-only HEAD
git grep -I -n -E '<provider-, credential-, PII-, path-, URL- und internal-patterns>' HEAD
git ls-files -z | xargs -0 file
git diff --check
git fsck --full --no-reflogs --unreachable
pnpm check:safety
pnpm infra:config
pnpm --filter @finance-os/agent-host check:codex-schema
```

`gitleaks`, `trufflehog`, `detect-secrets`, `semgrep`, `syft` und `trivy` waren lokal nicht verfügbar und wurden gemäß dem Offline-/No-install-Auftrag nicht nachinstalliert. Ihre Abwesenheit ist eine Restwarnung, kein positiver Befund; die unten genannten nativen und musterbasierten Scans wurden vollständig ausgeführt.

## 1. Secrets, Credentials und URLs — PASS

- Bekannte Provider-Muster für AWS, GitHub, GitLab, OpenAI, Anthropic, Slack, Stripe, Google, npm und PyPI: **0 Treffer**.
- Private-Key-Header, JWTs, signierte URL-Parameter und plausible hart codierte Credential-Zuweisungen: **0 Treffer**.
- Entropieprüfung längerer Token-Kandidaten: ausschließlich Platzhalter, Lockfile-Integritätswerte, generierte Schema-Bezeichner, Dokumentationspfade und Quellbezeichner; **0 plausible Secrets**.
- Getrackte Umgebungsdateien: ausschließlich `.env.example` und `apps/web/.env.example`. Beide enthalten dokumentierte lokale Placeholder-Werte; **0 echte Zugangsdaten**.
- URL-Inventar: öffentliche Dokumentations-, Paket- und Projektziele sowie bewusst lokale Entwicklungsziele (`localhost`/Loopback) und reservierte Testdomains. Keine privaten Hosts, Benutzerinformationen in produktiven URLs oder signierten Download-URLs.

Die komplette erreichbare Historie enthält nur denselben geprüften Root-Baum; es existiert kein früherer erreichbarer Commit, aus dem ein Secret wiederhergestellt werden könnte.

## 2. PII, private Pfade und Identitäten — PASS

- Absolute Benutzerpfade für macOS, Linux und Windows: **0 Treffer**.
- Private IPv4-Adressen, IBAN-ähnliche Werte und produktive Kunden-/Finanzdaten: **0 Treffer**.
- Allowlist der absichtlich öffentlichen Identität: `Christopher Böbel <ChrBoebel@users.noreply.github.com>` als Rechteinhaber und Commit-Identität.
- Weitere E-Mail-artige Treffer wurden manuell klassifiziert: eine reservierte `.invalid`-Adresse in einem Isolationstest und eine URL-Parser-Testzeichenfolge. Beides ist synthetisch und keine PII.
- Der technische Projektbezeichner `finance-os` ist Bestandteil von Paketnamen, Quellcode und öffentlicher Produktdokumentation; er ist weder ein lokaler Benutzername noch ein privater Pfad.

## 3. Interne oder vertrauliche Referenzen — PASS

- Keine lokalen Quellpfade, privaten Quell- oder Staging-Commit-IDs, Checkpoint-IDs, Zugangsdaten-URLs oder als vertraulich markierten Arbeitsnotizen.
- `TODO`, `FIXME`, `HACK` und `XXX` außerhalb generierter Lock-/Schema-Daten: **0 Treffer**.
- Der in der öffentlichen Release-Dokumentation erklärte Name eines getrennten privaten Historien-Repositories ist eine absichtliche Transparenzangabe und enthält weder URL noch Zugriff.
- Öffentliche Architektur- und Produktpläne sowie T3-/Codex-Begriffe beschreiben die Anwendung; sie sind keine privaten Orchestrierungs-Checkpoints.
- Markdown-Linkprüfung über 45 Markdown-Dateien: **0 fehlende lokale Ziele**.
- Verweise auf ausgeschlossene Marken- und Bilddateien: keine stale Links. Allgemeine Hinweise auf zukünftige Screenshots sowie Laufzeit-Screenshot-Felder/-Tests sind Funktionsdokumentation bzw. Code und referenzieren keine entfernte Datei.

## 4. Lizenzen, proprietäres Material und Abhängigkeiten — PASS WITH WARNINGS

- Projektlizenz vorhanden: PolyForm Noncommercial License 1.0.0 mit Required Notice für Christopher Böbel.
- `THIRD_PARTY_NOTICES.md` dokumentiert die aus `@openai/codex` 0.149.1 erzeugten Protokollschemas; `LICENSES/Apache-2.0.txt` ist vorhanden und die Version stimmt mit `package.json` und `pnpm-lock.yaml` überein.
- Unter `apps/agent-host/generated/codex/` liegen 955 absichtlich versionierte, generierte Protokoll-Quelldateien. Sie sind kein installiertes Dependency-Verzeichnis und werden durch den genannten Drittanbieterhinweis und Lizenztext abgedeckt.
- Keine getrackten `node_modules`, virtuellen Umgebungen, Vendor-, Build-, Dist-, Cache- oder Coverage-Verzeichnisse; keine kompilierten Maps, Bytecode- oder `tsbuildinfo`-Artefakte.
- JavaScript- und Python-Abhängigkeiten sind nur über `pnpm-lock.yaml` und `uv.lock` festgelegt. Ein vollständiger juristischer Lizenz-Clearingprozess für eine spätere Binärdistribution bleibt außerhalb dieses Code-only-Gates erforderlich.
- Keine internen Brand-Handbücher, proprietären Designquellen oder sonstigen ausgeschlossenen Markenmaterialien im erreichbaren Baum.

## 5. Sicherheitsrelevante Artefakte und Konfiguration — PASS

- Schlüssel-, Zertifikat-, Datenbank-, Dump-, Archiv-, Office-, PDF- und native Binärformate: **0 getrackte Dateien**.
- Symlinks: **0**. Dateien größer als 5 MiB: **0**.
- `pnpm check:safety`: PASS.
- `pnpm infra:config`: PASS mit den Placeholder-Werten aus `.env.example`.
- `pnpm --filter @finance-os/agent-host check:codex-schema`: PASS; der versionierte Snapshot ist reproduzierbar aktuell.
- `git diff --check`: PASS.
- Lokal vorhandene Dependency-, Build-, Cache- und Virtual-Environment-Verzeichnisse sind durch Git ignoriert und nicht Bestandteil des Commit-Baums oder einer Git-Archiv-Ausgabe.

## 6. Visuelle Assets, Metadaten, OCR und Rechte — PASS

- Bilddateiendungen im Current Tree und im einzigen erreichbaren Commit: **0**.
- Dateisignaturprüfung aller getrackten Dateien: **0 als Bild erkannte Dateien**.
- Eingebettete `data:image`-Inhalte und CSS-Verweise auf Bilddateien: **0**.
- Sechs kleine Inline-SVG-Elemente sind deklarativer UI-Quellcode (Loader/Bedienicons), keine separaten oder binären Bildassets und enthalten keine Metadaten. Sie bleiben Bestandteil der genehmigten Code-only-Variante.
- Die neun Bilddateien, sechs internen Brand-Dokumente und drei bildspezifischen Support-Dateien sind nicht im erreichbaren Baum. OCR- und Bildmetadatenprüfung ist deshalb nicht anwendbar; Rechteprobleme werden durch Nichtverteilung vermieden, nicht durch eine erfundene Attestierung.
- `ASSET_PROVENANCE.md` beschreibt diese Code-only-Grenze und die Gates für eine spätere Wiederaufnahme visueller Dateien.

## Git-Abschlussgate

- genau ein erreichbarer Commit und genau ein Root-Commit;
- Author und Committer: `Christopher Böbel <ChrBoebel@users.noreply.github.com>`;
- Branch `main`, **0 Remotes**, **0 Tags**;
- nach dem Amend: sauberer Arbeitsbaum;
- Reflogs abgelaufen und nicht erreichbare Vorgänger/Objekte bereinigt;
- `git fsck --full --no-reflogs --unreachable`: **0 Ausgaben**.

## Restwarnungen und Freigabegrenze

Die Warnungen betreffen nur die nicht installierten spezialisierten Scanner und einen möglichen späteren juristischen Lizenzcheck für Binärdistributionen. Es verbleibt kein technischer Publikationsblocker für genau diesen Code-only-Quellstand. Visuelle Dateien dürfen ohne neuen Herkunfts-, Rechte-, Metadaten-, OCR-, Secret-, PII- und Historiencheck nicht ergänzt werden.
