# Sanitization Report

## Verdict

**PASS WITH WARNINGS — technisch für die öffentliche Source Preview mit den dokumentierten visuellen Assets geeignet.**

Prüfzeitpunkt: 2026-08-29T05:07:57Z (UTC)

Es wurden keine veröffentlichungsblockierenden Secrets, personenbezogenen Daten, privaten
Benutzerpfade, vertraulichen internen Referenzen, gefährlichen Dateien oder echten Finanzdaten
gefunden. Die neun visuellen Dateien bestanden Hash-, Signatur-, SVG-, Metadaten-, OCR- und
Sichtprüfung. Die verbleibenden Warnungen betreffen die begrenzte Rechtekette KI-assistierter
Assets, acht manuell als synthetische False Positives klassifizierte Gitleaks-Treffer und einen
späteren vollständigen juristischen Abhängigkeitscheck vor einer etwaigen Binärdistribution.

## Umfang und Methode

- Current Tree mit 1.234 getrackten Dateien;
- vollständige erreichbare Historie mit zwei Commits und genau einem Root-Commit;
- Dateinamen, Dateimodi, Textinhalte und alle erreichbaren Git-Blobs;
- alle neun visuellen Dateien mit `file`, SHA-256, ImageMagick `identify`, macOS `sips`,
  `strings`, Tesseract OCR und manueller Sichtprüfung;
- ICNS-Container zusätzlich in alle zehn enthaltenen PNG-Größen extrahiert und geprüft;
- lokale Markdownlinks, Lizenz- und Konfigurationsdateien, Build-/Dependency-Ausschlüsse sowie
  die öffentlichen Repository- und Release-Claims;
- Remote nur lesend geprüft; kein Push, kein Release und keine Remote-Änderung.

Verwendete Kernprüfungen:

```text
.tools/gitleaks/8.30.1/darwin-arm64/gitleaks git --redact --verbose --log-opts='--all' .
git grep <Secret-, PII-, Pfad- und Internal-Muster> <jeder erreichbare Commit>
git rev-list --all --objects
git ls-files -z | xargs -0 file
sha256sum <neun Assetdateien>
identify -verbose <PNG-Dateien und extrahierte ICNS-PNGs>
sips -g all <PNG-Dateien>
strings -a <Rasterdateien>
tesseract <Rasterdateien> stdout
git diff --check
git fsck --full --no-reflogs --unreachable
pnpm check:safety
pnpm infra:config
pnpm check:codex-schema
pnpm --filter desktop check
```

## 1. Secrets und Credentials — PASS WITH WARNINGS

- Gitleaks 8.30.1 scannte beide erreichbaren Commits und rund 5,2 MB Git-Inhalt.
- Gitleaks meldete acht Treffer, alle bereits im öffentlichen Root-Commit und alle manuell als
  synthetisch klassifiziert: zwei UUID-Testwerte für Idempotenz, eine technische Beschreibung des
  Begriffs `idempotency key` und fünf ausdrücklich synthetische Capability-Strings in Desktoptests.
  Keiner entspricht einem Providerformat oder einer verwendbaren Zugangsinformation.
- Zusätzliche Muster für AWS, GitHub, GitLab, OpenAI, Anthropic, Slack, Stripe, JWTs,
  Private-Key-Header, Zugangsdaten in URLs und signierte URL-Parameter: **0 echte Treffer**.
- Getrackte Environment-Dateien sind ausschließlich `.env.example` und
  `apps/web/.env.example`; beide enthalten erkennbare lokale Platzhalter.
- In Rasterbildern, SVGs und dem ICNS-Container wurden keine Tokens, URLs, Zugangsdaten oder
  signierten Parameter gefunden.

## 2. PII, private Pfade und Finanzdaten — PASS

- Absolute private Benutzerpfade für macOS, Linux und Windows: **0 Treffer** im Current Tree und
  in beiden erreichbaren Commits.
- IBAN-ähnliche Werte, private IPv4-Adressen sowie echte Kunden-, Konto- oder Dokumentdaten:
  **0 Treffer**.
- Zulässige öffentliche Identität: Christopher Böbel und
  `ChrBoebel@users.noreply.github.com` als Rechteinhaber und Git-Identität.
- Weitere E-Mail-ähnliche Texttreffer sind eine reservierte `.invalid`-Adresse, ein absichtlich
  abgelehnter URL-Parser-Test mit `user@auth.openai.com` sowie `@2x`-Icondateinamen.
- OCR und Sichtprüfung der drei Screenshots zeigen nur klar synthetische Beispiele wie
  „Beispielkunde Nord“, „Musterprojekt Süd“, „Studio Nord“, „Stadtwerke Beispiel“ und
  „Musteragentur GmbH“. Beträge, Rechnungsnummern und gekürzte Hashes sind Demonstrationsdaten;
  keine echte Person oder Organisation ist erkennbar.
- Der Hero enthält nur Logo und Produkttext. Das App-Icon enthält keinen Text.

## 3. Interne und vertrauliche Referenzen — PASS

- Keine lokalen Quell-/Stagingpfade, privaten Arbeits-Commit-IDs, Obsidian-Pfade,
  Orchestrierungs-Checkpoints oder als vertraulich markierten Notizen.
- Die getrennte Bezeichnung `chelaro-internal` in der Veröffentlichungsdokumentation ist eine
  absichtliche Transparenzangabe ohne URL oder Zugriffsinformation.
- Zwei veraltete Statusaussagen wurden vor Abschluss korrigiert: Die Architektur nennt nun die
  öffentliche, source-available und nicht offene Preview; der historische Produkt-Blueprint
  erwartet `PUBLIC` und setzt keine kostenpflichtigen GitHub-Funktionen voraus.
- Markdown-Linkprüfung über 45 getrackte Markdowndateien: **0 fehlende lokale Ziele**.
- Assetlinks im README, in den Teilprojekt-READMEs und in den Richtlinien zeigen auf vorhandene,
  geprüfte Dateien.

## 4. Gefährliche Dateien und Repository-Hygiene — PASS

- Keine getrackten privaten Schlüssel, Zertifikate, Datenbanken, Dumps, Archive, Office- oder
  PDF-Dokumente; keine Symlinks und keine Datei über 5 MiB.
- Erwartete Binärdateien sind ausschließlich die geprüften PNG-Bilder und das macOS-ICNS-App-Icon.
- Keine getrackten `node_modules`, virtuellen Umgebungen, `.next`, `.tools`, Build-, Dist-, Cache-
  oder Coverage-Ausgaben. Lokal vorhandene Dependency-/Buildverzeichnisse sind ignoriert und
  fehlen auch in `git archive HEAD`.
- Das Screenshot-Skript akzeptiert nur `127.0.0.1` oder `localhost`, verlangt
  `FINANCE_OS_DOCS_SYNTHETIC_DATA_CONFIRMED=1`, beschränkt die Ausgabe auf
  `docs/assets/screenshots/` und startet Electron mit Context Isolation, deaktiviertem
  Node-Integration-Zugriff und Sandbox.
- `pnpm check:safety`, `pnpm infra:config`, `pnpm check:codex-schema`, der vollständige
  Desktop-Check mit 21 Tests und `git diff --check`: **PASS**.

## 5. Konfiguration, Lizenz und Rechtekette — PASS WITH WARNINGS

- PolyForm Noncommercial License 1.0.0, separate kommerzielle Lizenzinformation,
  Contribution-/Security-Dokumentation, Drittanbieterhinweise und Apache-2.0-Lizenztext sind
  vorhanden.
- README und Betriebsdokumentation bezeichnen das Repository ausdrücklich als
  **source-available und nicht Open Source**, nicht produktionsreif und ohne Downloads,
  signierte Builds, Updatekanal oder GitHub Releases.
- Der öffentliche GitHub-Stand hatte zum Prüfzeitpunkt **0 Releases** und deaktivierte Downloads;
  lokal bestehen **0 Tags**. Die Asset-PR erzeugt weder Release noch Binärdownload.
- `ASSET_PROVENANCE.md` dokumentiert Owner-Freigabe, Codex-/KI-Unterstützung, sichtbaren Inhalt,
  Erzeugungsweg, Datenklassifikation, Drittbestandteile und SHA-256-Werte.
- `BRAND_ASSETS.md` trennt Softwarelizenz und begrenzte Asset-/Markennutzung. Die Aufnahme der
  Dateien ist keine Behauptung garantierter urheberrechtlicher Schutzfähigkeit.
- Restwarnung: Für den Hero wurden weder exakter Prompt noch Modellstand oder editierbare Quelle
  archiviert; eine unabhängige Stock-/Ähnlichkeitssuche fand nicht statt. OpenAI-Bedingungen
  können nur das Verhältnis Nutzer/OpenAI regeln und garantieren weder Einzigartigkeit noch Rechte
  an unbekannten Drittbestandteilen. Vor einer kommerziellen oder binären Distribution bleibt
  eine individuelle juristische Rechte- und Abhängigkeitsprüfung sinnvoll.

## 6. Visuelle Assets — PASS WITH WARNINGS

### Integrität und Dateitypen

Alle Werte stimmen exakt mit `ASSET_PROVENANCE.md` überein:

| Datei | Typ / Abmessungen | SHA-256 |
| --- | --- | --- |
| `assets/brand/chelaro-icon.svg` | SVG, ViewBox 512×512 | `333df1f166798ec422e0e955b74c157bb7ccf873f544aac55c6b72b48f499812` |
| `apps/web/src/app/icon.svg` | bytegleiches SVG | `333df1f166798ec422e0e955b74c157bb7ccf873f544aac55c6b72b48f499812` |
| `apps/web/public/brand/chelaro-icon.svg` | bytegleiches SVG | `333df1f166798ec422e0e955b74c157bb7ccf873f544aac55c6b72b48f499812` |
| `apps/desktop/assets/icon.png` | PNG, 1024×1024 RGBA | `095aa8219f63cef54fd1dd0a0d17b4de93d0cac8eb5304989cf681671d77e169` |
| `apps/desktop/assets/icon.icns` | Apple ICNS, 10 PNG-Größen | `5fd76683c97dab300199d8d58443aec2af918e3cacb2ff9b4c41b3b84cbfacc3` |
| `assets/brand/github-social-preview.png` | PNG, 1280×640 RGBA | `4f15b05c8c2c203f1881a832021d1bdd96751b5778877f3dd2082ff207c8a435` |
| `docs/assets/screenshots/overview.png` | PNG, 2880×1704 RGB | `570cec0801371277a2c46e69d4f31fd8685e45103794bfe361d6483eb6fd35db` |
| `docs/assets/screenshots/documents.png` | PNG, 2880×1704 RGB | `a884b592256f86f15a631ebdb85bcd08c429267d5a28f55d7d925176119e3959` |
| `docs/assets/screenshots/workbook.png` | PNG, 2880×1704 RGB | `a6dca9fc1bfadfe125d6987837bac7b7aa649bbba8b518fcdc9d246cec91df26` |

### SVG, Metadaten, OCR und Sichtprüfung

- Die drei SVGs sind bytegleich und bestehen nur aus deklarativem XML mit Rechtecken, Pfaden und
  Ellipsen. Keine Skripte, Eventhandler, `foreignObject`, DTD/Entity, eingebetteten Daten,
  Schriften oder internen/externen Referenzen.
- Desktop-PNG und Hero enthalten kein erkanntes ICC-, EXIF- oder XMP-Profil. Die drei Screenshots
  enthalten nur das erwartete 536-Byte-ICC-Profil `Google/Skia/...` mit Copyright-Hinweis von
  Google; keine Autoren-, Prompt-, URL-, E-Mail- oder Pfadfelder.
- Die zehn im ICNS enthaltenen PNGs besitzen nur technische EXIF-Felder für Farbraum und
  Pixelabmessungen; keine Identitäts-, Standort-, Tool-, Pfad- oder Herkunftsfelder.
- Tesseract OCR bestätigte Produkttext und synthetische Beispieldaten. Das deutsche Sprachmodell
  war lokal nicht installiert; deshalb wurde das englische Modell mit manueller Sichtprüfung des
  vollaufgelösten Pixelstands kombiniert.
- Manuelle Sichtprüfung: Logo ist die dokumentierte Abakus-Schildkröte; Hero zeigt Logo,
  Chelaro-Text und eine stilisierte Papier-/Archivszene; Screenshots zeigen ausschließlich die
  lokale Chelaro-Demo ohne Browserleiste, Benutzerkonto, Hostname, echte Dokumentinhalte oder
  sonstige PII.

## Git-Historie und Abschlussgate — PASS

- Erreichbare Historie: genau zwei Commits, davon genau ein Root-Commit; der Asset-Feature-Commit
  hat ausschließlich den öffentlichen Root-Commit als Parent.
- Author und Committer des Feature-Commits: `Christopher Böbel <ChrBoebel@users.noreply.github.com>`.
- Branch `feat/restore-public-brand-assets`; lokaler Arbeitsbaum nach Amend sauber; **0 Tags**.
- `origin` zeigt auf das bereits öffentliche Repository `ChrBoebel/chelaro`; die Remote wurde
  nicht verändert.
- `git fsck --full`: keine fehlenden oder beschädigten Objekte. Ein durch das verlangte Amend
  lokal unerreichbar werdender Vorgänger enthält denselben geprüften Assetstand und wird durch
  einen normalen Branch-Push nicht übertragen. Auftragsgemäß wurde weder Git-GC noch eine
  Umschreibung des öffentlichen Root-Commits vorgenommen.

## Freigabegrenze

Dieser PASS gilt genau für die Source Preview mit den neun oben gehashten Dateien. Er ist keine
Freigabe eines Releases, signierten Downloads, produktionsreifen Finanzprodukts oder einer
kommerziellen Nutzung. Jede Assetänderung, jeder neue Screenshot und jede spätere Release-
Entscheidung erfordern einen erneuten Herkunfts-, Rechte-, Secret-, PII-, Metadaten-, OCR- und
Git-Historiencheck.
