# Finanzassistent – Prüfbefunde und offene Punkte

- Status: Abgearbeitet, zur Nachkontrolle
- Datum der Erhebung: 2026-09-01
- Datum der Umsetzung: 2026-09-01
- Anlass: Umsetzung der expliziten Modellauswahl (ADR 0014), anschließender visueller E2E,
  Interface-Analyse und Vergleich mit T3 Code
- Geprüfter Stand: Codex CLI `0.151.0`; Erhebung auf `fix/consent-version-migration`,
  Umsetzung auf `feat/explicit-finance-model-selection`
- Prüfmethode: echter Stack (SQLite, freie Ports, **echter** Agent-Host gegen die reale Codex-CLI),
  Bedienung über Browser-Automatisierung; zusätzlich Code-Vergleich gegen die aus
  `T3 Code (Alpha).app` rekonstruierten Quellen

Diese Datei ist die Nachkontrollliste. Jeder Punkt trägt jetzt, wie er erledigt wurde und wo der
Nachweis liegt.

---

## A. Verifiziert funktionierend

Kein Handlungsbedarf. Hier festgehalten, damit eine spätere Regression auffällt.

- [x] Consent-Gate vor jedem Provider-Kontakt.
- [x] Modellkatalog kommt live aus `model/list` und zeigt exakt die Allowlist
      (`gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`).
- [x] Fast-Mode-Schalter blendet sich bei `gpt-5.4-mini` korrekt aus (kein Service Tier im Katalog).
- [x] Voller Round-Trip gegen reales Codex: Frage → `finance_get_overview` → Antwort.
- [x] Persistierte Bindung exakt wie gewählt:
      `codex | gpt-5.5 | high | priority`.
- [x] Audit-Ereignis trägt die Konfiguration:
      `provider_bound {"provider":"codex","model":"gpt-5.5","effort":"high","service_tier":"priority"}`.
- [x] Determinismus-Kette hält end-to-end: UI → Gateway → `thread/start` → Echo-Prüfung → DB → Audit.

---

## B. Fehler

### B1 — Fortsetzen einer Unterhaltung schlägt im selben App-Lauf fehl

- **Schwere:** hoch. Widersprach ADR 0013.
- **Vorbestehend:** ja. Nicht durch ADR 0014 verursacht.
- **Symptom:** „Unterhaltung beenden" und danach „Unterhaltung fortsetzen" → HTTP 409,
  Überschrift wechselt auf „Der Codex-Kontext konnte nicht wiederaufgenommen werden."
- **Ursache:** `session-manager.ts` registrierte die Provider-Thread-ID über `availableResourceId`
  pro Host-Epoche und warf `identifier_reused`, wenn dieselbe ID erneut auftauchte. Beim Resume ist
  es notwendigerweise dieselbe ID.
- [x] **Behoben.** Das Kennungs-Ledger merkt sich jetzt zusätzlich die *Rolle*
      (`provider_thread`, `provider_turn`, `session`, `turn`). `session.ready` trägt ein
      `resumed`-Flag; ein wiederaufgenommener Thread darf sich erneut anhängen, dieselbe Kennung in
      einer anderen Rolle bleibt verboten. Die Kennung wird dabei nur einmal ins Ledger
      geschrieben, verbraucht also kein zusätzliches Budget.
      Nachweis: `session-manager.test.ts` („reattaches a resumed provider thread but not a foreign
      role"), `finance-agent-service.test.ts` („reopens the same conversation twice in one host
      epoch" und „still refuses a provider thread that arrives as a turn identifier") sowie der
      Desktop-E2E, der jetzt `conversationResumedInSameRun` meldet.
      Vermerkt in ADR 0013.

### B2 — Irreführende Fehlermeldung bei B1

- **Symptom:** „Die Aktion konnte nicht ausgeführt werden. Bitte versuche es erneut."
  Ein erneuter Versuch konnte in diesem Zustand nie gelingen.
- [x] **Behoben** zusammen mit C4. Der Satzbaustein „Bitte versuche es erneut" existiert nicht mehr
      als pauschale Aussage; ein Retry wird nur noch vorgeschlagen, wo er helfen kann.

---

## C. Interface-Analyse

### C1 — Vorschlags-Chips sehen klickbar aus, sind es nicht

- **Befund:** „Wie war mein Monat?", „Was ist noch offen?", „Wo gebe ich mehr aus?" waren `<span>`
  mit Rahmen und Pill-Form und erschienen im A11y-Baum als `StaticText`.
- [x] **Umgesetzt.** Es sind `<button>`-Elemente aus einer gemeinsamen `SUGGESTED_PROMPTS`-Liste;
      ein Klick setzt den Text ins Eingabefeld und fokussiert es. Während eines laufenden Turns
      sind sie deaktiviert.
      Nachweis: `finance-assistant.test.tsx` („offers the suggestions as controls …").

### C2 — Das laufende Modell ist während der Unterhaltung unsichtbar

- **Befund:** Sobald die Session stand, ersetzte `ChatPanel` das `SessionPanel` und bekam die
  Modellkonfiguration nicht einmal als Prop.
- [x] **Umgesetzt.** Neuer `ChatHeader` über dem Verlauf zeigt Modell, Denktiefe und – wenn aktiv –
      Fast Mode. Die Angabe stammt aus `snapshot.models.selected`, also aus der vom Thread
      zurückgemeldeten und geprüften Konfiguration, nicht aus der Auswahl im Formular.

### C3 — Hinweistext nennt Fast Mode auch ohne Fast Mode

- [x] **Umgesetzt.** Der Text unter dem Startknopf richtet sich nach dem gewählten Modell: mit Fast
      Mode, ohne Fast Mode (mit ausdrücklichem Hinweis) oder ohne Katalog.

### C4 — Neun Fehlermeldungen ohne Ursache

- **Befund:** `setNotice("Die Aktion konnte nicht ausgeführt werden…")` deckte Consent-, Session-,
  Turn- und Provider-Fehler gleichermaßen ab. Die strukturierten Codes des Gateways kamen im UI
  nirgends an.
- [x] **Umgesetzt.** `assistantRequest` wirft jetzt einen `AssistantRequestError` mit dem
      Gateway-Code; `describeAssistantError` übersetzt sechzehn Codes in konkrete Sätze
      (`model_not_available`, `authentication_required`, `session_busy`, `turn_busy`,
      `unsafe_codex_configuration`, …). Unbekannte Codes werden mitsamt Code genannt statt als
      Sammelmeldung verkleidet. Zusätzlich sind zwei bislang ungeschützte `historyMutation`-Aufrufe
      (neue Unterhaltung anlegen, archivieren/wiederherstellen) abgesichert – dort führte ein
      Fehler vorher zu einer unbehandelten Promise-Ablehnung ohne jede Meldung.
      Nachweis: `finance-assistant.test.tsx` („names the reason a rejected action failed …").

### C5 — Kein Kopieren, Wiederholen oder Editieren

- [x] **Umgesetzt für Kopieren und Wiederholen.** Jede Nachricht mit Inhalt hat „Kopieren"
      (mit kurzer „Kopiert"-Rückmeldung); an der letzten Nachricht erscheint „Erneut senden", wenn
      der letzte Turn fehlgeschlagen oder abgebrochen ist und gerade nichts läuft. Die Wiederholung
      schickt exakt denselben Text als neuen Turn.
- **Bewusst nicht umgesetzt:** Editieren einer bereits gesendeten Nachricht. Das setzt D4 voraus
  (siehe dort).

**Unverändert gut und nicht zu verschlechtern:** Consent-Gate, Streaming, Interrupt, Verlaufsliste
mit Archiv und Löschen, Paginierung älterer Nachrichten, `aria-live` an den richtigen Stellen,
fail-closed Snapshot-Validator im Renderer.

---

## D. Übertragbares aus T3 Code

### D1 — Token- und Kontextverbrauch anzeigen

- **Befund:** `thread/tokenUsage/updated` lief durch `#handleNotification`, traf kein Verbotsmuster,
  traf keinen `case` und wurde stillschweigend verworfen.
- [x] **Umgesetzt.** Die Notification wird auf die Thread-Bindung geprüft (eine Meldung für einen
      fremden Thread ist `protocol_incompatible`), über `assertFinanceThreadUsage` mit exakter
      Schlüsselprüfung ausgewertet und als `usage` in den Snapshot projiziert. Der `ChatHeader`
      zeigt Kontextfüllung in Prozent, belegte und verfügbare Token sowie den Gesamtverbrauch.
      Als Kontextfüllung dient `last.inputTokens` – das ist der Verlauf, den Codex tatsächlich
      gesendet hat, nicht die kumulierte Summe.
      Nachweis: `finance-agent-service.test.ts` („reports thread token usage …" und „rejects token
      usage reported for a foreign thread"), `finance-assistant.test.tsx`.

### D2 — Kontextgrenze und Kompaktierung behandeln

- **Befund:** `thread/compacted` und das `contextCompaction`-Item waren unbehandelt. Schlimmer als
  gedacht: `assertAllowedThreadItem` ließ nur vier Item-Typen zu, ein `contextCompaction` hätte den
  Turn also als `unsafe_codex_configuration` abgebrochen – genau in dem Moment, in dem eine lange
  Unterhaltung ihn am nötigsten braucht.
- [x] **Umgesetzt.** `contextCompaction` ist als inhaltsloser Marker zugelassen und wird gezählt;
      die deprecated Notification `thread/compacted` zählt dieselbe Kompaktierung nicht doppelt
      (Deduplizierung über die Turn-Kennung). Der `ChatHeader` schreibt „Verlauf n× verdichtet".
      Zusammen mit D1 ist die Kontextgrenze damit sichtbar, statt sich nur auszuwirken.

### D3 — Sichtbarer Weg, die Konfiguration einer Unterhaltung zu ändern

- [x] **Umgesetzt.** „Konfiguration ändern" im `ChatHeader` schließt die Session und führt zurück
      auf das `SessionPanel`, wo neu gebunden wird. Die Bindung bleibt bewusst am Thread, weil
      `turn/start` keinen Echo liefert und ein Per-Turn-Wechsel unverifizierbar wäre (ADR 0014).
      Der Weg funktioniert erst, seit B1 behoben ist; der Desktop-E2E fährt ihn ab.

### D4 — Nachrichten-Rollback

- **Befund:** Der gepinnte App Server bietet `thread/revert` (und das deprecated `thread/rollback`).
  Technisch umsetzbar.
- [x] **Bewusst verworfen.** Ein Rollback müsste die lokal gespeicherten Nachrichten und Turns
      löschen. Chelaros lokaler Verlauf ist nach ADR 0013 die Wahrheitsquelle und das
      Ereignisprotokoll ist append-only; ein Bedienelement, das Teile davon entfernt, arbeitet
      gegen genau die Eigenschaft, die den Assistenten prüfbar macht. Der praktische Bedarf
      („nochmal, anders") ist mit „Erneut senden" aus C5 additiv gedeckt. Eine Wiederaufnahme
      erfordert eine eigene Entscheidung zum Löschen aus dem Verlauf, ein neues Ereignis im
      Audit-Vertrag und die zugehörige Migration.

### Bewusst nicht übernehmen

T3s `ModelManifest` lädt die Modellklassifizierung zur Laufzeit von `raw.githubusercontent.com`
nach. Ein Netzabruf, der steuert, welche Modelle ein Finanzassistent anbietet, wäre ein Rückschritt
gegenüber unserer statischen, testgedeckten Allowlist. **Nicht umgesetzt, bleibt so.**

---

## E. Offene Entscheidungen

### E1 — GPT-5.6-Familie

- **Befund (gemessen am Provider-Rand):**

  | Modell | Provider-Rand |
  | --- | --- |
  | `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini` | exakt die acht Finanzfunktionen |
  | `gpt-5.6-luna` | Code Mode: `exec`, `functions`, `wait` |
  | `gpt-5.6-sol`, `gpt-5.6-terra` | Code Mode **plus** `collaboration`, `spawn_agent`, `send_message`, `followup_task`, `interrupt_agent`, `list_agents`, `wait_agent` |

- [x] **Entschieden: die ganze Familie bleibt draußen, `gpt-5.6-luna` eingeschlossen.** `wait` ist
      ein Orchestrierungswerkzeug, weder eine der acht Finanzfunktionen noch Teil des von ADR 0012
      erlaubten Routers. Es aufzunehmen hieße, die Stoppbedingung aus ADR 0010 aufzuweichen, ohne
      dass der Finanzassistent dadurch etwas kann, was `gpt-5.5` nicht kann. Festgehalten in
      ADR 0014.

### E2 — Verhaltensänderung kommunizieren

- [x] **Erledigt.** Der CHANGELOG nennt die Änderung; `docs/releases/v0.5.0.md` erklärt sie in einem
      eigenen Abschnitt, weil eine Maschine mit `model = "gpt-5.6-sol"` in `~/.codex/config.toml`
      den Assistenten bisher genau darauf betrieben hat und ab jetzt auf GPT-5.5 / mittel /
      Standard läuft.

### E3 — Branch-Trennung vor dem PR

- [x] **Getrennt.** `fix/consent-version-migration` trägt nur noch die Consent-Migration (Version
      0.4.1), `feat/explicit-finance-model-selection` setzt darauf auf und trägt die Modellauswahl
      samt Folgearbeiten (Version 0.5.0). Nichts ist gepusht.

---

## F. Nicht ausgeführte Prüfungen

- [x] `pnpm test:e2e:finance-assistant` – **gelaufen und grün.** Dabei kam heraus, dass der
      Fake-Host die Konfiguration nicht zurückmeldete und der E2E an der Echo-Prüfung aus ADR 0014
      gescheitert wäre. Der Fake beantwortet jetzt `model/list` mit der Allowlist und spiegelt
      Modell, Denktiefe und Service Tier wie der echte App Server. Der Durchlauf enthält zusätzlich
      den Resume-Pfad aus B1 (`conversationResumedInSameRun`).
- [x] Alembic-Migration `20260901_0011` gegen **PostgreSQL** – **gelaufen.** Gegen ein
      Wegwerf-`postgres:17.11-alpine3.23` migriert bis `20260831_0010`, dann `upgrade head`,
      `downgrade`, erneutes `upgrade` und `alembic check` („No new upgrade operations detected").
      Spalten, `NOT NULL` und beide Check-Constraints stehen wie erwartet.
- [x] Backfill-Pfad der Migration mit **bestehenden** Zeilen – **geprüft.** Eine vor ADR 0014
      angelegte Bindung (`provider_thread_legacy`) wurde vor der Migration eingefügt und danach
      unverändert mit `gpt-5.5 | medium | default` wiedergefunden.

### Dabei gefundener Zusatzfehler

- [x] **Der Desktop-Pfad hatte gar keinen Backfill.** `desktop_schema.py` legt das SQLite-Schema mit
      `Base.metadata.create_all` an; das ergänzt bei einer bestehenden Installation keine Spalten.
      Eine Installation, die schon auf Schemaversion 4 stand, wäre nach dem Update mit
      „no such column: provider_model" gescheitert. Neu: `migrate_v4_to_v5` baut die Tabelle mit den
      drei Spalten und beiden Check-Constraints neu auf (SQLite kann weder nachträglich `NOT NULL`
      setzen noch Check-Constraints hinzufügen), übernimmt alle Zeilen und füllt sie mit derselben
      Vorgabe wie die PostgreSQL-Migration. `DESKTOP_SCHEMA_VERSION` steht auf 5.
      Nachweis: `test_desktop_database.py::test_desktop_database_backfills_the_explicit_model_binding`.

---

## Referenzen

- [ADR 0010](../decisions/0010-codex-powered-finance-assistant.md) – Provider-Rand-Stoppbedingung
- [ADR 0012](../decisions/0012-isolated-code-mode-finance-routing.md) – isolierter Code-Mode-Router
- [ADR 0013](../decisions/0013-durable-local-assistant-conversations.md) – dauerhafte Unterhaltungen
- [ADR 0014](../decisions/0014-explicit-finance-model-selection.md) – explizite Modellauswahl
