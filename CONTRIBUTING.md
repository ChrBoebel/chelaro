# Zu Chelaro beitragen

Chelaro ist ein source-available Produkt in einer frühen technischen Preview. Änderungen müssen
seine Datenintegritäts- und Sicherheitsgrenzen bewahren und als kleine, überprüfbare Pull Requests
geliefert werden.

## Entwicklungsumgebung

Die Voraussetzungen und lokalen Startbefehle stehen in der [README](README.md#lokal-entwickeln).
Vor der ersten Änderung:

```bash
pnpm install --frozen-lockfile
uv sync --project apps/api --locked --all-groups
```

Verwende ausschließlich synthetische Daten. Reale Rechnungen, Bankexporte, Namen, Tokens,
Cookies, signierte URLs und `.env`-Dateien dürfen weder in Commits noch in Logs oder Screenshots
gelangen.

## Arbeitsweise

1. Erstelle einen kurzlebigen Branch vom aktuellen `main`.
2. Halte Änderungen fachlich fokussiert.
3. Verwende Conventional Commits, beispielsweise `fix(api): reject stale workbook version`.
4. Ergänze Tests für den dominanten Fehler- und Sicherheitsfall.
5. Aktualisiere API-Vertrag und Clients gemeinsam, wenn sich ein Endpoint ändert.
6. Fülle das Pull-Request-Template vollständig aus.

## Unverhandelbare Produktregeln

- Originale Finanzdokumente bleiben unverändert.
- Nicht verifizierte Automatisierung wird niemals stillschweigend kanonisch.
- KI, Regeln und andere Automatisierung erzeugen standardmäßig überprüfbare Vorschläge.
- Das Entfernen einer Workbook-Zeile löscht kein verknüpftes Dokument.
- Geld verwendet Dezimalwerte und eine explizite ISO-Währung, niemals binäre Floats.
- Jede persistierte Mutation erzeugt im selben Vorgang ein Audit Event.

## Qualitätsprüfung

Vor einem Pull Request muss mindestens der relevante Teil und vor dem Merge der vollständige Gate
erfolgreich sein:

```bash
pnpm quality
pnpm infra:config
git diff --check
```

Kann GitHub Actions wegen eines Infrastrukturproblems keine Jobs starten, muss der vollständige
lokale Gate mit Ursache und Ergebnis im Pull Request dokumentiert werden. Ein echter Testfehler darf
nicht umgangen werden.

## Marke und Produktoberfläche

- Logo, App-Icons, Hero und Screenshots sind enthalten, aber nicht Teil der Softwarelizenz.
  KI-/Codex-Herkunft, Hashes und Datenklassifikation stehen in
  [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md); für die Nutzung gilt die
  [Marken- und Assetrichtlinie](BRAND_ASSETS.md).
- Neue oder veränderte Bilder benötigen vor dem Commit einen Secret-, PII-, Metadaten-, OCR-,
  Rechte- und History-Scan. Screenshots dürfen ausschließlich synthetische Daten zeigen.
- In der primären Produktoberfläche heißt es **KI**. **Agent** und **Codex** bleiben technischen
  Architektur-, Sicherheits- und Diagnosekontexten vorbehalten.
- Ungeprüfte Ergebnisse werden als Vorschlag oder Prüfzustand bezeichnet und dürfen visuell nicht
  wie bestätigte Finanzdaten erscheinen.
- Neue Produkt-, Datenschutz- oder Sicherheitsversprechen müssen durch den implementierten Stand
  belegbar sein.

## Rechte an Beiträgen

Beiträge müssen von dir selbst stammen oder in einer Weise lizenziert sein, die ihre Aufnahme und
Weiterlizenzierung erlaubt. Mit dem Einreichen eines Pull Requests bestätigst du, dass du dazu
berechtigt bist und keine Rechte Dritter verletzt.

Du behältst das Urheberrecht an deinem Beitrag. Gleichzeitig räumst du Christopher Böbel eine
dauerhafte, weltweite, nicht ausschließliche, unentgeltliche und unwiderrufliche Lizenz ein, den
Beitrag zu nutzen, zu vervielfältigen, zu verändern, öffentlich zugänglich zu machen, zu verbreiten,
zu unterlizenzieren und unter anderen Bedingungen weiterzulizenzieren. Das schließt
source-available, kommerzielle und proprietäre Lizenzmodelle ein. Soweit dein Beitrag notwendige
Patentansprüche berührt, erteilst du hierfür eine entsprechende weltweite, unentgeltliche
Patentlizenz.

Diese Rechtekette ermöglicht das Dual-Licensing-Modell. Beiträge mit abweichenden oder zusätzlichen
Bedingungen müssen vorab ausdrücklich schriftlich vereinbart werden.

## Sicherheitsmeldungen

Sicherheitsprobleme gehören nicht in normale Issues. Folge der [Sicherheitsrichtlinie](SECURITY.md).
