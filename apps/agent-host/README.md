# Chelaro Agent Host

Der Agent Host verbindet den einwilligungsgebundenen Finanzassistenten mit dem Codex App
Server. Er stellt ausschließlich die begrenzten Chelaro-Finanzwerkzeuge bereit – keine Shell,
Dateien, Browser-, Web- oder Coding-Werkzeuge.

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

Für die Nutzung muss die unterstützte Codex CLI `0.151.0` installiert sein. Eine vorhandene
`codex login`-Anmeldung wird über den App Server wiederverwendet; Chelaro besitzt keinen eigenen
Login oder Logout und liest keine `auth.json`. Die realen App-Server-Tests laufen über
`pnpm quality:agent:macos`.

Weitere Details: [Finanzassistent-Architektur](../../docs/architecture/ARCHITECTURE.md) ·
[Threat Model](../../docs/security/THREAT_MODEL.md) ·
[ADR 0011](../../docs/decisions/0011-reuse-system-codex-authentication.md)
