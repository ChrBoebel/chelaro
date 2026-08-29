# Prüfung der öffentlichen Code-only Source Preview

Stand: 29. August 2026

## Entscheidung

**Status: technisch freigabefähige Source Preview nach finalem Sanitizer-PASS.**

Diese Freigabe gilt ausschließlich für Quellcode und Dokumentation. Sie ist keine Freigabe einer
fertigen oder produktionsreifen Finanzsoftware und umfasst keine Binärdownloads, GitHub Releases,
Signierung, Notarisierung, Updatekanäle, Support- oder Verfügbarkeitszusagen.

Die öffentliche Kopie wurde ohne alte Git-Historie erzeugt und enthält genau einen Initial Commit
mit GitHub-Noreply-Identität. Die bisherige Historie bleibt in einem getrennten privaten
Repository. Visuelle Markenassets und proprietäre Markenunterlagen sind nicht Bestandteil der
öffentlichen Kopie; siehe [Asset-Register](../../ASSET_PROVENANCE.md).

## Öffentlicher Umfang

- Quellcode für API, Web, Electron-Source-Runtime und den begrenzten Finance Assistant;
- Architektur-, Sicherheits-, Produkt- und Entwicklungsdokumentation;
- PolyForm Noncommercial 1.0.0 und Informationen zur separaten kommerziellen Lizenzierung;
- Contribution-, Security- und Support-Richtlinien;
- Platzhalterbasierte Environment-Beispiele;
- keine Logos, Icons, Social-Preview-Grafiken oder Produkt-Screenshots;
- keine Releases, signierten Pakete oder offiziellen Downloads.

## Lizenzmodell

Der Softwarecode steht unter der
[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/).
Sie erlaubt Nutzung, Änderung und Verteilung nur für die dort definierten nichtkommerziellen
Zwecke. Kommerzielle Nutzung benötigt vorab eine separate schriftliche Lizenz.

Das Projekt wird als **source-available und nicht als Open Source** bezeichnet. Die
[Open Source Definition](https://opensource.org/osd) untersagt in Ziffer 6 Einschränkungen auf
bestimmte Tätigkeitsfelder; die PolyForm-Beschränkung kommerzieller Nutzung erfüllt diese
Definition daher nicht.

Die [Information zur kommerziellen Lizenzierung](../../COMMERCIAL-LICENSE.md) ist noch kein
vollständiger kommerzieller Lizenzvertrag. Vor einem kommerziellen Angebot bleiben eine
anwaltliche Prüfung und ein Vertragsmuster sinnvoll, insbesondere zu Nutzungsumfang,
AGB-Einbeziehung, Gewährleistung, Haftung, Laufzeit, Vergütung, Support, Markenrechten,
Beendigung und Contributor-Rechten.

## Vorläufige Markenrecherche „Chelaro“

Recherchezeitpunkt: 29. August 2026. Die Recherche ist keine professionelle Markenfreigabe.

| Quelle und Suchausdruck | Vorläufiges Ergebnis |
| --- | --- |
| DPMAregister, `MARKE=Chelaro` | Keine Treffer. |
| DPMAregister, `MARKE=Chelar?` | „Alex Chelaru Creations“, Unionsmarke 018875394, Klassen 25 und 35. |
| EUIPO eSearch plus, `Chelaro` | 0 Marken, Designs, Inhaber und Vertreter. |
| TMview, exakt `Chelaro` | Keine Treffer. |
| TMview, enthält `Chelaro` | „Chelaron“, polnische Marke Z.452909, Klasse 5. |

Vor Markenanmeldung oder größerem Produktlaunch fehlen weiterhin eine phonetische,
schriftbildliche und begriffliche Ähnlichkeitsrecherche, nicht registrierte Kennzeichen sowie eine
anwaltliche Klassenentscheidung. Voraussichtlich sind die Klassen 9 und 42 relevant; Klasse 36
hängt vom tatsächlich angebotenen Leistungsumfang ab.

Amtliche Ausgangspunkte:

- [DPMA: Markenrecherche](https://www.dpma.de/marken/markenrecherche/)
- [DPMAregister: Datenbestand Marken](https://register.dpma.de/register/htdocs/test/de/hilfe/datenbestand/marken/index.html)
- [EUIPO: Suche](https://www.euipo.europa.eu/en/search)
- [TMview](https://www.tmdn.org/tmview/)

## Technische und organisatorische Gates

| Gate | Status |
| --- | --- |
| Lokale Qualitätsprüfung | Vor Veröffentlichung vollständig auszuführen und zu dokumentieren. |
| Finaler Sanitizer | Muss `PASS` ergeben; ein `FAIL` blockiert den Push. |
| Alte Git-Historie | Nicht Bestandteil des öffentlichen Ein-Commit-Repositorys. |
| Secrets und personenbezogene Daten | Vollständiger Current-Tree- und Git-Historien-Scan erforderlich. |
| Visuelle Asset-Rechte | Durch Nichtaufnahme aller visuellen Assets aus dem öffentlichen Umfang entfernt. |
| Softwarelizenz | PolyForm Noncommercial 1.0.0; source-available, nicht Open Source. |
| CI und GitHub-Plus | Keine neuen Funktionen oder Konfigurationen für diese Preview. |
| Binärrelease | Nicht freigegeben; keine Downloads oder GitHub Releases. |
| Produktionsreife | Ausdrücklich nicht behauptet. |

## Repository-Struktur

| Repository | Sichtbarkeit | Zweck |
| --- | --- | --- |
| `chelaro-internal` | privat | bisherige Historie und interne Referenz |
| `chelaro` | öffentlich | bereinigte Code-only Source Preview mit einem Initial Commit |

Die aktive lokale Weiterentwicklung soll nach Veröffentlichung aus einer neuen Arbeitskopie des
öffentlichen Repositorys erfolgen. Das private Repository bleibt Referenzarchiv; Änderungen
zwischen beiden Repositorys müssen bewusst und überprüfbar übertragen werden.

Diese Notiz dokumentiert eine technische und organisatorische Vorprüfung. Sie ist keine
Rechtsberatung, Markenfreigabe oder Aussage über Produktreife.
