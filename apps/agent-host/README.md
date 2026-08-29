# Chelaro Agent Host

Der Agent Host verbindet den einwilligungsgebundenen Finanzassistenten mit dem gepinnten Codex App
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

Die realen App-Server- und Isolationstests benötigen das dokumentierte macOS-15.6-Apple-Silicon-
System und laufen über `pnpm quality:agent:macos`.

Weitere Details: [Finanzassistent-Architektur](../../docs/architecture/ARCHITECTURE.md) ·
[Threat Model](../../docs/security/THREAT_MODEL.md) ·
[ADR 0009](../../docs/decisions/0009-trust-pinned-codex-control-plane.md)
