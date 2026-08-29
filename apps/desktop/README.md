# Chelaro Desktop

Die Electron-Shell startet Chelaro lokal aus dem Quellcode. Sie enthält die API- und Web-Runtime,
verwaltet lokale Prozesse und enthält einen derzeit inaktiven Update-Flow für eine mögliche
spätere Evaluation. Die öffentliche Source Preview bietet keine signierten Releases oder
Binärdownloads.

## Entwickeln und paketieren

Vom Repository-Root aus:

```bash
pnpm dev:desktop
pnpm package:desktop:dir
pnpm package:desktop
```

Lokale Pakete sind absichtlich unsigniert und ausschließlich für Entwicklungstests gedacht. Die
Source Preview veröffentlicht keine DMG- oder ZIP-Artefakte.

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

Die öffentliche Source Preview enthält keine Produkt-Screenshots, App-Icons oder veröffentlichten
Binärpakete. Die Electron-Shell verwendet bei lokaler Ausführung das Plattform-Standardicon.

Weitere Details: [Release-Prozess](../../docs/releases/RELEASE_PROCESS.md) ·
[Architektur](../../docs/architecture/ARCHITECTURE.md)
