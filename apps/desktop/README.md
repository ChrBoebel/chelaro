# Chelaro Desktop

Die Electron-Shell enthält die lokale API-, Web- und Finance-Agent-Host-Runtime, verwaltet deren
Prozesse und stellt den expliziten kostenlosen macOS-Updateablauf bereit. Paketierte Builds prüfen
den festen öffentlichen GitHub-Releases-Kanal ohne Client-Token.

## Entwickeln und paketieren

Vom Repository-Root aus:

```bash
pnpm dev:desktop
pnpm package:desktop:dir
pnpm package:desktop
```

Lokale und veröffentlichte Pakete sind absichtlich nicht mit einer Apple Developer ID signiert.
Nur der geschützte Tag-Workflow darf eine DMG zusammen mit `SHA256SUMS.txt` veröffentlichen. Das
ist ein manueller Download- und Installationskanal, kein Squirrel- oder `electron-updater`-Kanal.
Der eingebettete API-Helfer verwendet den PyInstaller-Konsolen-Bootloader und läuft als
Hintergrundprozess, ohne als zweite Anwendung im macOS Dock zu erscheinen.

## Updateablauf

- Ab `0.3.0` prüft Chelaro den neuesten stabilen GitHub Release beim Start und alle sechs Stunden.
- Nur die exakt erwartete `Chelaro-X.Y.Z-arm64.dmg` und `SHA256SUMS.txt` werden akzeptiert.
- Chelaro prüft Größe und SHA-256-Prüfsumme, bevor es die DMG öffnen kann.
- Download und Öffnen starten nur nach einer ausdrücklichen Nutzeraktion.
- Der Nutzer zieht Chelaro selbst nach `Programme` und bestätigt das Ersetzen.
- macOS kann für jede unsigned Version Rechtsklick → „Öffnen“ beziehungsweise „Dennoch öffnen“
  verlangen.
- Ein Update ersetzt das App-Bundle, nicht den bestehenden Datenpfad unter
  `~/Library/Application Support/Finance OS/`.

## Vertrauensgrenzen

- Originaldokumente und bestehende App-Daten werden bei Updates nicht gelöscht.
- Update-Download, DMG-Öffnung und Installation bleiben explizite Nutzeraktionen.
- Eine Prüfsumme schützt vor beschädigten Downloads, ersetzt aber keine Apple-Signatur.
- Runtime-Capabilities werden beim Start frisch erzeugt und nicht in Environment-Dateien abgelegt.
- Externe Links werden außerhalb des isolierten App-Fensters geöffnet.

## Prüfungen

```bash
pnpm quality:desktop
pnpm release:check
```

Die öffentliche Source Preview enthält das dokumentierte Chelaro-App-Icon, drei Screenshots mit
synthetischen Daten und kann experimentelle unsigned DMGs veröffentlichen. Screenshots werden über
`pnpm --filter desktop capture:docs` erzeugt; der Capture verlangt eine Loopback-URL und die
ausdrückliche Bestätigung synthetischer Daten.

Weitere Details: [Release-Prozess](../../docs/releases/RELEASE_PROCESS.md) ·
[Architektur](../../docs/architecture/ARCHITECTURE.md)
