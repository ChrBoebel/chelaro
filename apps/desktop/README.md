# Chelaro Desktop

Die Electron-Shell enthält die lokale API-, Web- und Finance-Agent-Host-Runtime, verwaltet deren
Prozesse und stellt den expliziten macOS-Updateablauf bereit. Paketierte Builds enthalten dauerhaft
den öffentlichen GitHub-Releases-Provider. Die Source Preview bietet noch keine signierten
Downloads, solange Developer-ID-Signierung und Apple-Notarisierung nicht eingerichtet sind.

## Entwickeln und paketieren

Vom Repository-Root aus:

```bash
pnpm dev:desktop
pnpm package:desktop:dir
pnpm package:desktop
```

Lokale Pakete sind absichtlich unsigniert und ausschließlich für Entwicklungstests gedacht. Sie
enthalten zwar `app-update.yml`, sind aber keine freigegebenen Updateartefakte. Nur der geschützte
Tag-Workflow darf signierte DMG-, ZIP-, Blockmap- und `latest-mac.yml`-Dateien veröffentlichen.

## Update-Bootstrap

- `0.1.0` besitzt keine eingebettete Updatekonfiguration und benötigt einmalig eine manuelle,
  signierte `0.2.0`-Installation.
- Ab `0.2.0` prüft Chelaro den stabilen öffentlichen GitHub Release ohne Client-Token.
- Download und Installation starten nur nach einer ausdrücklichen Nutzeraktion.
- Ein Update ersetzt das App-Bundle, nicht den bestehenden Datenpfad unter
  `~/Library/Application Support/Finance OS/`.

## Vertrauensgrenzen

- Originaldokumente und bestehende App-Daten werden bei Updates nicht gelöscht.
- Update-Download und Installation bleiben explizite Nutzeraktionen.
- Runtime-Capabilities werden beim Start frisch erzeugt und nicht in Environment-Dateien abgelegt.
- Externe Links werden außerhalb des isolierten App-Fensters geöffnet.

## Prüfungen

```bash
pnpm quality:desktop
pnpm release:check
```

Die öffentliche Source Preview enthält das dokumentierte Chelaro-App-Icon und drei Screenshots mit
synthetischen Daten, aber derzeit keine veröffentlichten Binärpakete. Screenshots werden über
`pnpm --filter desktop capture:docs` erzeugt; der Capture verlangt eine Loopback-URL und die
ausdrückliche Bestätigung synthetischer Daten.

Weitere Details: [Release-Prozess](../../docs/releases/RELEASE_PROCESS.md) ·
[Architektur](../../docs/architecture/ARCHITECTURE.md)
