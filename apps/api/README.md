# Chelaro API

Der FastAPI-Dienst besitzt Chelaros kanonische Finanzregeln, Persistenz und öffentliche
Schnittstellenverträge.

## Befehle

Vom Repository-Root aus:

```bash
uv sync --project apps/api --locked --all-groups
pnpm dev:api
pnpm lint:api
pnpm typecheck:api
pnpm test:api
```

Die interaktive OpenAPI-Dokumentation ist in der Entwicklungsumgebung unter `/docs` verfügbar.
In Produktion bleiben die Dokumentationsendpunkte deaktiviert.

## Vertrauensgrenze

Die API verantwortet Autorisierung, unveränderliche Originaldokumente, typisierte
Rechnungsregeln, optimistische Nebenläufigkeit und das Audit Ledger. Jede persistierte Mutation
erzeugt im selben Vorgang ein Audit Event.

Owner- und KI-Bearer-Token sind absichtlich getrennt. Owner dürfen Originale verwalten und direkte
Workbook-Änderungen anwenden. Angebundene KI kann Finanzdaten lesen und Vorschläge erzeugen, aber
weder Originale herunterladen noch direkte Änderungen anwenden oder eigene Vorschläge freigeben.

Weitere Details: [Architektur](../../docs/architecture/ARCHITECTURE.md) ·
[REST-Zugriff](../../docs/agents/REST_ACCESS.md) ·
[Threat Model](../../docs/security/THREAT_MODEL.md)
