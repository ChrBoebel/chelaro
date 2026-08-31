# Architecture Decision Records

Chelaro hält folgenreiche Architektur- und Autoritätsentscheidungen als unveränderliche ADRs fest.
Ersetzte Entscheidungen bleiben verfügbar und verweisen auf ihre Nachfolgeentscheidung.

| ADR | Entscheidung |
| --- | --- |
| [0001](0001-foundation-architecture.md) | Fundament der Architektur |
| [0002](0002-local-document-storage.md) | Lokale, unveränderliche Dokumentablage |
| [0003](0003-workbook-change-authority.md) | Autorität über Workbook-Änderungen |
| [0004](0004-booked-versus-expected-money.md) | Gebuchtes und erwartetes Geld |
| [0005](0005-receivable-history-and-agent-authority.md) | Forderungshistorie und KI-Autorität |
| [0006](0006-read-only-fints-boundary.md) | Lesende FinTS-Grenze |
| [0007](0007-isolated-codex-agent-boundary.md) | Isolierte Codex-Grenze |
| [0008](0008-stop-codex-v1-on-nested-seatbelt.md) | Stopp von V1 nach gescheiterter Seatbelt-Verschachtelung |
| [0009](0009-trust-pinned-codex-control-plane.md) | Gepinnte Codex-Control-Plane als Vertrauensgrenze |
| [0010](0010-codex-powered-finance-assistant.md) | Codex-gestützter Finanzassistent |
| [0011](0011-reuse-system-codex-authentication.md) | System-Codex und bestehende Anmeldung wiederverwenden |
| [0012](0012-isolated-code-mode-finance-routing.md) | Isolierter GPT-5.6-Router für acht Finanzfunktionen |

Für eine Entscheidung, die eine Produktinvariante, Vertrauensgrenze, das Speichermodell, eine
Release-Grenze oder einen irreversiblen Kompatibilitätsvertrag verändert, wird die nächste
fortlaufende Datei angelegt.
