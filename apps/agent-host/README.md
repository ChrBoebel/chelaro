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
echte CLI. Details in [ADR 0014](../../docs/decisions/0014-explicit-finance-model-selection.md).

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
pnpm test:agent-host
```

Für die Nutzung muss die unterstützte Codex CLI `0.152.0` installiert sein. Eine vorhandene
`codex login`-Anmeldung wird über den App Server wiederverwendet; Chelaro besitzt keinen eigenen
Login oder Logout und liest keine `auth.json`. Die realen App-Server-Tests laufen über
`pnpm quality:agent:macos`.

Weitere Details: [Finanzassistent-Architektur](../../docs/architecture/ARCHITECTURE.md) ·
[Threat Model](../../docs/security/THREAT_MODEL.md) ·
[ADR 0011](../../docs/decisions/0011-reuse-system-codex-authentication.md) ·
[ADR 0014](../../docs/decisions/0014-explicit-finance-model-selection.md)
