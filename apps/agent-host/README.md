# Chelaro Agent Host

Der Agent Host verbindet den einwilligungsgebundenen Finanzassistenten mit dem Codex App
Server. Er stellt ausschließlich die begrenzten Chelaro-Finanzwerkzeuge bereit – keine Shell,
Dateien, Prozesse, Browser-, Web- oder Netzwerk-Werkzeuge. Da GPT-5.6 Werkzeugaufrufe über Code
Mode routet, ist dessen isolierter Host aktiv; sein `tools`-Objekt enthält ausschließlich die acht
Finanzfunktionen und hat keinen Node-, Shell-, Datei- oder Netzwerkzugriff.

## Modellkonfiguration

Modell, Denktiefe und Service Tier werden bei jedem `thread/start` und `thread/resume` explizit
gesendet und nie aus `~/.codex/config.toml` geerbt. Ein Thread gilt erst als konfiguriert, wenn die
Antwort genau die angeforderten Werte zurückmeldet — der App Server nimmt unbekannte Werte
kommentarlos an und ersetzt sie still.

Angeboten werden nur Modelle aus `FINANCE_SUPPORTED_MODELS`, deren Provider-Rand nachweislich
ausschließlich die acht Finanzfunktionen erreicht. Die Liste ist nach Neuheit sortiert, der Katalog
wird in diese Reihenfolge gebracht und neue Unterhaltungen starten auf dem ersten Eintrag —
derzeit `gpt-5.6-luna` über den isolierten Code-Mode-Router, danach `gpt-5.5`, `gpt-5.4` und
`gpt-5.4-mini` als direkte Funktionsaufrufe. `gpt-5.6-sol` und `gpt-5.6-terra` bleiben draußen: sie
zeigen zusätzlich eine `collaboration`-Namespace mit `spawn_agent` und Verwandten, die der gepinnte
App Server nicht abschalten kann. `finance-provider-manifest.test.ts` prüft das je Modell gegen die
echte CLI. Details in [ADR 0014](../../docs/decisions/0014-explicit-finance-model-selection.md) ·
[ADR 0015](../../docs/decisions/0015-verified-codex-release-set.md).

## Autoritätsmodell

- Lesende Werkzeuge liefern typisierte Finanzdaten.
- Schreibende Werkzeuge erzeugen ausschließlich prüfpflichtige Vorschläge.
- KI-Ausgaben werden niemals allein durch ihre Formulierung zu kanonischen Finanzdaten.
- Owner- und Assistant-Capabilities bleiben voneinander getrennt.
- Dokumentinhalte gelten als nicht vertrauenswürdige Daten, nicht als Anweisungen.

## Befehle

Vom Repository-Root aus:

```bash
pnpm typecheck:agent-host
pnpm check:codex-schema
pnpm check:codex-compat
pnpm test:agent-host
```

Für die Nutzung muss eine geprüfte Codex CLI installiert sein — `SUPPORTED_CODEX_VERSIONS` in
[`src/codex-provider.ts`](src/codex-provider.ts) nennt sie. Eine vorhandene `codex login`-Anmeldung
wird über den App Server wiederverwendet; Chelaro besitzt keinen eigenen Login oder Logout und
liest keine `auth.json`. Die realen App-Server-Tests laufen über `pnpm quality:agent:macos`.

### Eine Codex-Version prüfen und freigeben

`SUPPORTED_CODEX_VERSIONS` ist eine Menge geprüfter Releases, kein tolerierter Bereich. Eine
Version wird so aufgenommen:

```bash
pnpm check:codex-compat -- --binary /pfad/zu/codex
```

Das Skript erzeugt die App-Server-Schemas aus genau diesem Binary und weist nach, dass alles, was
Chelaro sendet, validiert oder beantwortet, byte-identisch zu den eingecheckten Schemas ist und
dass das Release keine Notification und keine Server-Anfrage sendet, die niemand eingeordnet hat.
Unterschiede außerhalb dieser Fläche werden aufgelistet und gehören ins Review. Danach muss der
Provider-Rand-Test (ADR 0010) gegen dasselbe Binary laufen. Erst dann darf die Version in die
Liste — vor die älteren, denn `SCHEMA_CODEX_VERSION` ist immer das neueste freigegebene Release.

Ein neueres Release wird nicht in die Liste aufgenommen, sondern löst eine Neugenerierung aus:
Pin in `package.json`, `generated/codex`, `SCHEMA_CODEX_VERSION` und die realen Tests wandern
gemeinsam, wie ADR 0011 es verlangt.

### Eine andere Codex-Installation verwenden

`FINANCE_OS_CODEX_BINARY_PATH` zeigt den Agent Host auf ein bestimmtes `codex`-Executable statt auf
das erste im Suchpfad. Damit läuft Chelaro auf einer eigenen, gepinnten Kopie, während die globale
CLI beliebig aktuell bleibt:

```bash
npm install --prefix ~/.chelaro/codex @openai/codex@0.152.0
FINANCE_OS_CODEX_BINARY_PATH=~/.chelaro/codex/node_modules/.bin/codex pnpm dev:desktop
```

Die Variable nimmt ausschließlich einen Pfad an, niemals Argumente: die `--config`-Absicherung des
App Servers aus ADR 0010 und ADR 0011 ist nicht überschreibbar. Das Binary muss trotzdem eine
freigegebene Version melden, und `CODEX_HOME` bleibt die normale Anmeldung des Nutzers. Beim Start
aus dem Finder erbt die App die Shell-Umgebung nicht; dort setzt `launchctl setenv` die Variable.

Weitere Details: [Finanzassistent-Architektur](../../docs/architecture/ARCHITECTURE.md) ·
[Threat Model](../../docs/security/THREAT_MODEL.md) ·
[ADR 0011](../../docs/decisions/0011-reuse-system-codex-authentication.md) ·
[ADR 0014](../../docs/decisions/0014-explicit-finance-model-selection.md) ·
[ADR 0015](../../docs/decisions/0015-verified-codex-release-set.md)
