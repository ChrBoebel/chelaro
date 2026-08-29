# Sicherheitsrichtlinie

Chelaro verarbeitet Finanzdokumente und daraus abgeleitete Daten. Sicherheitsmeldungen werden
deshalb vertraulich behandelt und nicht als gewöhnliche öffentliche Issues diskutiert.

## Unterstützte Versionen

Chelaro ist eine öffentliche, experimentelle Source Preview ohne veröffentlichte Releases oder
Binärdownloads. Sicherheitskorrekturen werden ausschließlich für den aktuellen Stand von `main`
betrachtet; daraus folgt keine Zusage für einen bestimmten Reaktions- oder Wartungszeitraum.

| Version | Sicherheitskorrekturen |
| --- | --- |
| `main` | Ja |
| Lokale Entwicklungsstände | Nein |
| Frühere Builds | Nein |

## Sicherheitsproblem melden

Bitte keine Sicherheitslücke, Zugangsdaten oder Beispieldokumente in einem normalen GitHub Issue
veröffentlichen.

1. Verwende nach Möglichkeit **Security → Report a vulnerability** im GitHub-Repository.
2. Falls Private Vulnerability Reporting nicht verfügbar ist, kontaktiere den Repository-Owner
   privat über das zugehörige GitHub-Profil.
3. Teile nur synthetische oder vollständig anonymisierte Reproduktionsdaten.

Eine hilfreiche Meldung enthält:

- betroffene Version oder Commit-SHA;
- reproduzierbare Schritte und erwartetes Verhalten;
- mögliche Auswirkungen auf Dokumente, Finanzdaten, Tokens oder Updates;
- einen minimalen Proof of Concept ohne reale personenbezogene Daten;
- bekannte Gegenmaßnahmen oder Workarounds.

Es gibt während der Source Preview keine garantierte Reaktionszeit. Kritische Meldungen zu
unautorisierten Finanzmutationen, Datenverlust, Credential-Leaks oder kompromittierten Updates
werden priorisiert.

## Sicherheitsgrenzen

- Originaldokumente sind unveränderlich; Ableitungen erhalten eigene Versionen.
- Nicht verifizierte OCR-, Regel- und KI-Ausgaben sind Vorschläge und keine kanonischen Finanzdaten.
- Persistierte Mutationen müssen im selben Vorgang ein Audit Event erzeugen.
- Dokumentinhalte gelten als nicht vertrauenswürdige Daten und niemals als ausführbare Anweisung.
- Secrets gehören ausschließlich in lokale Environment-Dateien oder geschützte GitHub-Secrets.

Das aktuelle Bedrohungsmodell, bekannte Grenzen und offene Härtungsmaßnahmen stehen im
[Chelaro Threat Model](docs/security/THREAT_MODEL.md).

## Nicht abgedeckt

Die Preview bietet derzeit keine vollständige Absicherung gegen ein kompromittiertes lokales
Benutzerkonto oder Betriebssystem, keine verschlüsselte lokale Datenbank und noch keine
automatisierte Backup-/Restore-Garantie. Sie darf nicht als einzige Aufbewahrung realer
Finanzdokumente verwendet werden.
