# Herkunft visueller Assets

Stand: 29. August 2026

Verantwortlich für die Freigabe: Christopher Böbel

## Freigabestatus und Owner-Angabe

**PASS WITH WARNINGS für die öffentliche Source Preview.**

Christopher Böbel hat am 29. August 2026 im Rahmen der Veröffentlichung ausdrücklich angegeben,
dass Logo, Hero/Social Preview und Screenshots durch seinen Codex-Agent-Workflow erstellt wurden
und in das öffentliche Repository aufgenommen werden sollen. Die Materialien werden daher
transparent als KI-/Codex-assistiert behandelt und nicht als ausschließlich menschlich erzeugt
dargestellt.

Die aktuell geltenden [OpenAI Europe Terms of Use](https://openai.com/policies/eu-terms-of-use/)
ordnen Output im Verhältnis zwischen Nutzer und OpenAI dem Nutzer zu, soweit das anwendbare Recht
dies zulässt. Die Bedingungen weisen zugleich darauf hin, dass Output nicht einzigartig sein muss
und Drittanbieter-Output ausgenommen sein kann. Dieses Register behauptet deshalb keine
garantierte urheberrechtliche Schutzfähigkeit, Einzigartigkeit oder Rechte an unbekannten
Drittbestandteilen.

## Logo und App-Icons

Das Abakus-Schildkröten-Logo wurde im Codex-Agent-Workflow als textbasiertes SVG aus einfachen
Pfaden, Rechtecken und Ellipsen erzeugt. Die kanonische Quelle enthält keine eingebetteten Bilder,
Schriften, Skripte, Metadaten oder externen Referenzen.

- `assets/brand/chelaro-icon.svg` ist die kanonische Vektorquelle.
- `apps/web/src/app/icon.svg` und `apps/web/public/brand/chelaro-icon.svg` sind bytegleiche Kopien.
- `apps/desktop/assets/icon.png` wird aus der SVG-Quelle mit `rsvg-convert` oder ImageMagick erzeugt.
- `apps/desktop/assets/icon.icns` wird aus den Rastergrößen mit Apples `iconutil` erzeugt.
- `scripts/generate-app-icons.sh` dokumentiert und reproduziert die Ableitung.

## Hero und Social Preview

`assets/brand/github-social-preview.png` wurde laut Owner-Angabe durch seinen Codex-Agent-Workflow
erzeugt. Das eingecheckte PNG ist der freigegebene Output; ein exakter Prompt, Modellstand und eine
editierbare Quelldatei wurden nicht archiviert. Der sichtbare Inhalt besteht aus dem Chelaro-Logo,
Produkttext und einer stilisierten hellen Papier-/Archivszene. Technische und visuelle Prüfungen
fanden keine personenbezogenen Daten, Benutzerpfade, URLs, Autorenfelder oder sonstigen
eingebetteten Herkunftsangaben.

## Produkt-Screenshots

Die drei Screenshots wurden durch den projektinternen Codex-Agent-Workflow über
Electron/Chromiums `webContents.capturePage()` gegen eine lokale Chelaro-Instanz erzeugt. Das
Capture-Skript akzeptiert nur Loopback-URLs, beschränkt den Ausgabepfad auf
`docs/assets/screenshots/` und verlangt
`FINANCE_OS_DOCS_SYNTHETIC_DATA_CONFIRMED=1`.

Die Sichtprüfung des veröffentlichten Pixelstands zeigt ausschließlich synthetische Beispiele,
darunter „Beispielkunde Nord“, „Musterprojekt Süd“, „Studio Nord“, „Stadtwerke Beispiel“ und
„Musteragentur GmbH“. Es sind keine echten Personen, Konten, Dokumente oder identifizierenden
Finanzdaten erkennbar. Die PNGs enthalten nur ein übliches Google/Skia-Farbprofil und keine
Autoren-, Prompt-, Pfad-, E-Mail- oder URL-Metadaten.

## Schriften, Tools und Drittbestandteile

- **Geist Sans und Geist Mono:** über `next/font/google`; Drittanbieterwerke unter ihren eigenen
  Bedingungen. Chelaro beansprucht daran keine Eigentumsrechte.
- **Logo-Ableitung:** SVG/XML, `rsvg-convert` oder ImageMagick sowie Apples `iconutil`.
- **Screenshots:** Electron/Chromium mit der lokalen, synthetischen Chelaro-Demo.
- **Hero:** Codex-Agent-Output; exakter Prompt und Modellstand nicht archiviert.
- **Vorlagen oder Stockmaterial:** Laut verfügbarer Owner-Angabe und Repository-Evidenz nicht
  bewusst verwendet; eine unabhängige Ähnlichkeits- oder Stockdatenbankprüfung wurde nicht
  durchgeführt.

## Integritätswerte

| Datei | SHA-256 |
| --- | --- |
| `assets/brand/chelaro-icon.svg` | `333df1f166798ec422e0e955b74c157bb7ccf873f544aac55c6b72b48f499812` |
| `apps/web/src/app/icon.svg` | `333df1f166798ec422e0e955b74c157bb7ccf873f544aac55c6b72b48f499812` |
| `apps/web/public/brand/chelaro-icon.svg` | `333df1f166798ec422e0e955b74c157bb7ccf873f544aac55c6b72b48f499812` |
| `apps/desktop/assets/icon.png` | `095aa8219f63cef54fd1dd0a0d17b4de93d0cac8eb5304989cf681671d77e169` |
| `apps/desktop/assets/icon.icns` | `5fd76683c97dab300199d8d58443aec2af918e3cacb2ff9b4c41b3b84cbfacc3` |
| `assets/brand/github-social-preview.png` | `4f15b05c8c2c203f1881a832021d1bdd96751b5778877f3dd2082ff207c8a435` |
| `docs/assets/screenshots/overview.png` | `570cec0801371277a2c46e69d4f31fd8685e45103794bfe361d6483eb6fd35db` |
| `docs/assets/screenshots/documents.png` | `a884b592256f86f15a631ebdb85bcd08c429267d5a28f55d7d925176119e3959` |
| `docs/assets/screenshots/workbook.png` | `a6dca9fc1bfadfe125d6987837bac7b7aa649bbba8b518fcdc9d246cec91df26` |

## Rechte- und Nutzungsgrenze

Soweit Christopher Böbel Rechte an den Assets hält oder kontrolliert, bleiben sie ihm vorbehalten.
Die Softwarelizenz erteilt keine allgemeine Marken- oder Wiederverwendungslizenz für die visuellen
Assets. Rechte Dritter und zwingende gesetzliche Rechte bleiben unberührt. Details stehen in
[BRAND_ASSETS.md](BRAND_ASSETS.md).

## Pflegeprozess

1. Neue oder geänderte visuelle Dateien werden mit Erzeuger, Tool, KI-Anteil, Vorlagen,
   Drittanbieterrechten und Datenklassifikation dokumentiert.
2. Ableitungen verweisen auf eine kanonische Quelle und einen reproduzierbaren Generator.
3. Screenshots werden nur über den abgesicherten lokalen Capture-Prozess erzeugt und anschließend
   visuell auf personenbezogene oder echte finanzielle Daten geprüft.
4. Nach jeder Assetänderung werden Hashes sowie Secret-, PII-, Metadaten-, OCR-, Rechte- und
   Git-Historien-Scans erneut ausgeführt.
