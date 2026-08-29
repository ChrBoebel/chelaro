# Agent Storage

Dieses TypeScript-Paket enthält historische Isolationsexperimente aus einer früheren
Agent-Architektur. Es ist nicht Bestandteil des aktuellen Chelaro-Finanzassistenten und darf nicht
als kanonischer Finanzspeicher verwendet werden.

## Befehle

Vom Repository-Root aus:

```bash
pnpm typecheck:agent-storage
pnpm test:agent-storage
```

Die aktuelle Produktgrenze und die Gründe für den Architekturwechsel sind in
[ADR 0008](../../docs/decisions/0008-stop-codex-v1-on-nested-seatbelt.md) und
[ADR 0009](../../docs/decisions/0009-trust-pinned-codex-control-plane.md) dokumentiert.
