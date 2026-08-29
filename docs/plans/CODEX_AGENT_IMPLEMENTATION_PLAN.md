# Codex Coding Agent – Implementierungsplan

> **Historisch und nicht zur Umsetzung freigegeben:** ADR 0010 und der
> `CODEX_FINANCE_ASSISTANT_IMPLEMENTATION_PLAN.md` ersetzen diesen Coding-Agent-Scope. Chelaro
> implementiert keinen Coding-Agent, keinen Quellcode-Workspace und keinen Patch-Apply-Flow.

- Status: Approved
- Datum: 2026-08-28
- V1-Zielplattform: macOS 15.6 arm64, lokale Source-run-Desktop-Anwendung
- Referenzstand T3 Code: `e2d4d12a81516b55abbecdc64794971f781cacd8`
- Protokoll-Baseline: `@openai/codex`/Codex CLI `0.149.1`
- Primäre Integration: Codex App Server über JSON-RPC/stdio

## 1. Ergebnis und Scope

Chelaro erhält einen lokalen, chatbasierten Coding Agent. Er arbeitet nicht im echten Checkout, sondern in einem sanitisierten, app-eigenen Workspace. Nachrichten, Aktivitäten, Befehle und Datei-Diffs erscheinen in der Desktop-Anwendung. Änderungen am echten Checkout sind ein separater, vollständig sichtbarer und konfliktgeprüfter Nutzer-Apply – niemals eine Nebenwirkung einer Codex-Freigabe.

V1 ist ein standardmäßig deaktiviertes Developer Feature für die bestehende macOS-Source-run-App. Sie liefert Chat, Streaming, Stop, sichere Befehls- und Datei-Freigaben im isolierten Workspace sowie den expliziten Export geprüfter Änderungen. Packaging, Linux, Windows, mobile Nutzung und ein Finance Assistant sind Folgeprojekte.

```text
Live-Checkout ── sicherer Import ──> sanitisiertes Agent-Workspace
      ^                                      |
      |                                      v
Nutzer-Apply <── validierter Diff ── Codex App Server
      ^                                      ^
      |                                      |
React UI -> Next.js Proxy -> Agent Host -> JSON-RPC/stdio
```

## 2. Nicht verhandelbare Grenzen

1. Codex und seine Tool-Prozesse erhalten keinen Lesepfad auf den Live-Checkout, das Benutzer-Home, `.env*`, Finanzdokumente oder Finance-OS-Credentials.
2. Der Codex-Prozess erhält weder `FINANCE_OS_API_TOKEN` noch `FINANCE_OS_AGENT_TOKEN`.
3. Codex arbeitet nur im app-eigenen Workspace. Änderungen am Live-Checkout entstehen ausschließlich durch einen zweiten, host-eigenen Apply-Schritt mit vollständigem Diff und expliziter Zustimmung.
4. Network-, Permission-, Additional-root-, MCP-, Hook-, Plugin- und unbekannte Capability-Eskalationen werden in V1 immer abgelehnt.
5. Eine Codex-Ausführungsfreigabe ist niemals eine Freigabe kanonischer Finanzdaten.
6. Fehlt eine beweisbare Sicherheitsgrenze, wird nur der Agent deaktiviert; Finance API, Web und Desktop bleiben verwendbar.

## 3. Zielarchitektur

### 3.1 Komponenten

```text
React Agent Workspace
        |
        | same-origin HTTP + SSE
        v
Next.js Agent Proxy
        |
        | loopback HTTP + flüchtiges Bridge-Secret
        v
Electron Agent Gateway (stabil über Child-Restarts)
        |
        | validiertes Electron-UtilityProcess-IPC
        v
apps/agent-host (Node.js im Utility Process)
        |
        | JSON-RPC 2.0 über stdio
        v
app-eigene, gepinnte Codex CLI
        |
        | macOS Seatbelt + Codex workspace-write/network-off sandbox
        v
sanitisiertes Workspace unter Finance-OS-User-Data
```

`apps/agent-host` besitzt Codex-Prozesssteuerung, Protokoll, Workspace-Application-Service und providerneutrale Domain Events über IPC. Der Electron Agent Gateway besitzt HTTP/SSE, Bridge-Authentifizierung, globalen Public Reducer, Replay und Child-Supervision. `packages/agent-storage` besitzt den APFS-Image-/Mount-/Quota-Lifecycle; `packages/agent-workspace` besitzt das versionierte Journalformat sowie die einzige Import-/Diff-/Apply-/Recovery-Engine, die Electron und Agent Host gemeinsam verwenden. FastAPI bleibt ausschließlich kanonische Finanz-Domänengrenze. Next.js bleibt UI und serverseitiger Proxy; langlebige Child Processes laufen weder in Route Handlern noch im Browser.

### 3.2 V1-Plattformentscheidung

V1 unterstützt ausschließlich macOS 15.6 auf arm64, den gegenwärtigen verifizierten Source-run-Pfad. Jede weitere OS-Version oder Architektur bleibt deaktiviert, bis dieselben Gates auf einem eigenen CI-/Runtime-Profil bestanden und das ADR erweitert wurden. Codex läuft zusätzlich zu seiner eigenen Sandbox unter einem deny-by-default Seatbelt-Profil. Das Profil erlaubt nur die für CLI/Node/Systembibliotheken nötigen Read-Pfade sowie das app-eigene Codex-Home und Agent-Workspace; der Live-Checkout und das übrige Benutzer-Home bleiben verboten.

Phase 0 ist ein hartes Machbarkeitsgate: Kann der echte gepinnte App Server unter diesem Profil nicht authentifizieren und arbeiten, während negative Dateizugriffe sicher scheitern, wird nicht auf eine schwächere `cwd`- oder Allowlist-Lösung zurückgefallen. Dann stoppt die V1-Implementierung mit einem neuen Isolations-ADR.

Linux benötigt später beispielsweise Bubblewrap/Landlock, Windows eine eigene AppContainer-/Sandbox-Grenze. Diese Mechanismen werden nicht durch ungetestete Plattformabstraktion vorweggenommen.

Das Seatbelt-Profil und der innere Tool-Sandbox-Test decken nicht nur Dateien ab. Sie verweigern Tool-Prozessen Keychain/`security`, Apple Events/`osascript`, Pasteboard, nicht explizit nötige Mach-/XPC-Services, Unix-Domain-Sockets, Loopback und fremde lokale Dienste, Prozessinspektion/-signale sowie TCC-geschützte Desktop-/Documents-/Downloads-Pfade. Dynamische Pfade mit Leerzeichen, Quotes, Unicode und Newlines werden escaped und negativ getestet. Der gepinnte App Server ist als netzwerkberechtigter Control-Plane-Prozess klassifiziert; Seatbelt verspricht keine TLS-Origin-Filterung. Tool-Prozesse bleiben davon unabhängig vollständig network-off und bestehen separate Probes.

Bei jedem App-Start läuft vor Login/Thread-Start ein kleiner versions- und profilgebundener Isolations-Selbsttest. Weichen `sw_vers`, Architektur, Profil-Hash oder erwartete Denials von der freigegebenen macOS-15.6-arm64-Matrix ab, bleibt der Agent deaktiviert. Ein CI-Beweis allein genügt nicht.

## 4. Sanitisiertes Workspace und Live-Apply

### 4.1 App-eigene Pfade

Electron bestimmt alle Pfade aus `app.getPath("userData")`; sie sind nicht vom Browser überschreibbar:

```text
<userData>/agent/
  images/
    control.sparsebundle      # 256 MiB: Codex-Home/Auth
    workspace.sparsebundle    # 512 MiB: nur Tool-Dateien
    baseline.sparsebundle     # 512 MiB: host-only Bytes/Manifest/Hashes
    recovery.sparsebundle     # 512 MiB: host-only Journal/Backups/Staging
  mounts/                     # validierte Mountpoints, Modus 0700
  runtime/                    # Epoche und temporäre IPC-Artefakte
```

Electron erzeugt und mountet vier APFS-Sparsebundles mit fester logischer Maximalgröße; zusammen können Agentdaten höchstens 1,75 GiB belegen. Der Runtime-Selbsttest verifiziert Imageformat, Kapazität, Mount-Flags, Eigentümer und freie Reserve. `CODEX_HOME` ist überall einheitlich `<userData>/agent/mounts/control/home`.

Es gibt drei verschiedene, getestete Profile:

| Prozess | Erlaubte app-eigene Mounts |
| --- | --- |
| Control-App-Server | nur Control-Mount für Config/Auth; kein Workspace |
| Execution-App-Server | Control-Mount plus exakt aktiver Workspace-Mount |
| Vom Modell gestarteter Toolprozess | ausschließlich aktiver Workspace-Mount; Control explizit denied |

Baseline und Recovery sind für sämtliche Codex-/Toolprofile explizit denied und nur für Electron/Agent Host außerhalb dieser Profile zugänglich. „Host-only“ bezieht sich nur auf Baseline und Recovery; Unix-Dateirechte allein wären wegen desselben Benutzerkontos keine Isolation. Da der Execution-App-Server Auth lesen muss, beweist Phase 0 besonders die zusätzliche innere Tool-Sandbox: App Server kann den Control-Mount lesen, ein von ihm gestartetes `cat`, `find`, `security` oder absoluter Pfadzugriff darauf nicht.

`runtime/` enthält ausschließlich feste Lock-/Socket-/Epochendateien unter zusammen 1 MiB und niemals Modell-, Diff- oder Workspace-Inhalt. Sparsebundle-Metadaten plus Runtime besitzen zusätzlich ein überwachtes 256-MiB-Overheadbudget; damit bleibt der gesamte app-eigene Agentpfad unter 2 GiB. Überschreitung verhindert Mount/Start und liefert `agent_storage_limit`.

Der Workspace-Mount erlaubt höchstens 20.000 Dateien und 32 MiB je erzeugter Datei. Ein Host-Watcher plus 250-ms-Reconciliation beendet bei Überschreitung sofort Toolprozess und App Server; das feste 512-MiB-Volume ist die harte letzte Grenze gegen schnelle oder parallele Writer. Danach werden Manifest und Workspace validiert und der Zustand wird `salvage_ready` oder bei Inkonsistenz `recovery_required`. Vor Apply reserviert die Recovery-Engine durch ein voralloziertes Reservefile den Worst Case für Staging plus Backups; ohne vollständige Reservation beginnt kein Live-Write.

Vor jedem rekursiven Cleanup werden kanonischer Pfad, Eigentümer und erwartetes `<userData>/agent/`-Präfix erneut geprüft. Symlinks werden beim Cleanup nicht verfolgt.

### 4.2 Importvertrag

Der Host erstellt einen Snapshot, ohne `.git` oder beliebige Verzeichnisbäume zu kopieren:

- Quelle sind die von `git ls-files` gemeldeten tracked Dateien einschließlich aktueller tracked Working-Tree-Inhalte.
- Untracked Dateien sind standardmäßig ausgeschlossen. Nutzer können sie einzeln auswählen; danach durchlaufen sie dieselben Prüfungen.
- Ignored Dateien, `.env`, `.env.*`, Credentials, Keys, Cookies, Tokens, signierte URLs, Finanz-/Dokumentformate und die Verzeichnisse `data/`, `uploads/`, `quarantine/` und `exports/` sind hart ausgeschlossen und nicht übersteuerbar.
- Nur reguläre Dateien innerhalb des kanonischen Repository-Roots werden importiert. Nach außen zeigende Symlinks, Devices, Sockets und FIFOs werden abgelehnt. Interne Symlinks werden in V1 ebenfalls nicht importiert.
- Höchstens 20.000 Dateien, 256 MiB Snapshot, 2 MiB je Textdatei, 1.024 UTF-8-Bytes je Pfad und 32 Pfadsegmente. Binärdateien sind V1 nicht editierbar.
- Der exakt gepinnte Scanner `gitleaks 8.30.1` prüft Default-Regeln, Entropie und Finance-OS-Regeln für bekannte Token-/Credential-Formate. `scripts/install-agent-tools.mjs` lädt für macOS arm64 ausschließlich `https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_darwin_arm64.tar.gz`, verlangt SHA-256 `b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5`, prüft die MIT-Lizenzmetadaten und installiert in einen ignorierten, versionsgebundenen `.tools`-Pfad. Setup ist explizit; zur Agent-Laufzeit wird nichts heruntergeladen. Treffer blockieren den Import ohne Override. Die Dokumentation verspricht Schutz für hart ausgeschlossene Quellen und das versionierte Scanner-Regelwerk, keine mathematische Erkennung jedes unbekannten Secrets.
- Der Nutzer bestätigt vor Thread-Start eine Zusammenfassung aus Dateianzahl, Gesamtgröße, ausgeschlossenen Pfaden und aktuellem Git-Status.

Der Host kopiert über bereits geöffnete, validierte File Descriptors in ein neues Verzeichnis, prüft Quelle und Ziel gegen Symlink-/TOCTOU-Wechsel und setzt restriktive Rechte. Baseline-Bytes, Pfad-/Modusmanifest und Source-Hashes liegen ausschließlich unter `baselines/<workspaceId>` und sind im Seatbelt-Profil für Codex weder les- noch schreibbar. Im Tool-Workspace existieren weder `.git` noch hosteigene Metadaten. Der Host berechnet Diffs direkt zwischen seiner unveränderlichen Baseline und validierten Workspace-Bytes; Git-Index oder Refs sind keine Vertrauensquelle.

Projektsteuernde Pfade wie `.codex/**`, `.git/**`, `.claude/**`, Hook-/Plugin-/Skill-Konfiguration sowie alle `AGENTS.md`/`CLAUDE.md` werden entweder hart ausgeschlossen oder als importierte Instruktionen explizit read-only geschützt. Codex kann sie im Tool-Workspace nicht erstellen, ersetzen oder löschen. Versuche mit `git init`, `.git`-Austausch oder Baseline-Manipulation verändern den Host-Diff nicht.

### 4.3 Änderungen und Export

Codex darf ausschließlich den sanitisierten Workspace verändern. Zu einem Workspace gehört höchstens ein aktiver Thread; terminale Sessions dürfen sequenziell durch eine neue Session/Thread-Kombination ersetzt werden. Ein Workspace besitzt einen exklusiven Mutations-Lock; während Diff-Review/Apply dürfen kein Turn, Reimport, Cleanup, New-Chat oder zweiter Apply beginnen. „Auf Arbeitskopie anwenden“ ist eine eigene Nutzeraktion nach einem Turn:

1. Host erzeugt einen vollständigen kanonischen Text-Diff mit Create/Modify/Delete/Rename, relativen Pfaden und Truncation-Status. `contentSha256` ist ausschließlich der SHA-256 dieser übertragenen UTF-8-Anzeige-Bytes.
2. Der Review-Start friert eine `diffRevision` ein. Ihr separater `revisionDigest` ist der SHA-256 über Baseline-ID, sortierte strukturierte Operationen, Pfade, Modusbits und vollständige Zielbytes; er bleibt die Sicherheitsbindung des Apply. Workspace-Schreibzugriffe bleiben bis Abschluss oder Cancel gesperrt.
3. Die ursprüngliche `POST /v1/threads/:id/diff-revisions`-Antwort bleibt offen, während Gateway den Anzeige-Diff streamt. Erst nachdem `content.completed` gegen `contentSha256` validiert und der Reducer die Revision atomar `ready` gesetzt hat, erzeugt der Gateway einen einmaligen, 15 Minuten gültigen Approval-Token und antwortet mit `{ revisionId, revisionDigest, contentSha256, approvalToken, expiresAt }`. Token und rohe Response werden nie in Eventring oder Snapshot übernommen.
4. Apply ist nur aktiv, wenn der komplette Diff unter 1 MiB liegt, keine Binärdatei enthält und alle Pfade erneut die Import-/Deny-Regeln erfüllen. `POST apply` prüft selbst `status === "ready"` und verlangt `revisionId`, `revisionDigest`, Approval-Token und Idempotency-Key; `contentSha256` ist keine Apply-Autorität.
5. Für jede Quelldatei wird der beim Import gespeicherte Hash mit dem aktuellen Live-Checkout verglichen. Create- und Rename-Ziele müssen weiterhin fehlen; Modusbits und Workspace-Revision müssen unverändert sein. Abweichungen liefern `409 live_workspace_changed`; es gibt keinen automatischen Merge oder Overwrite.
6. Dateien werden in einem app-eigenen Staging-Verzeichnis vorbereitet. Vor dem Austausch werden kanonische Zielpfade und Symlinkfreiheit erneut geprüft.
7. Ein persistentes host-only Recovery-Journal unter `recovery/<applyId>` durchläuft nach `fsync` die Zustände `prepared`, `applying`, `committed`, `rollback_required` und `recovered`. Backups werden erst nach durable `committed` entfernt.
8. Vor Workspace-Cleanup oder neuem Apply reconciled Electron alle offenen Journale. Ein Crash nach jedem Filesystem-Schritt führt beim Neustart entweder zu vollständigem Rollback oder einem dauerhaften, erklärten manuellen Recovery-Zustand, der weitere Applies blockiert.
9. Der Nutzer bestätigt den vollständigen Diff und die exakte Dateiliste. Erst danach schreibt der Host.
10. Der Host führt weder `git add`, Commit noch Push aus.

Nach 15 Minuten invalidiert der Gateway Revision und Token atomar, entsperrt den Workspace und publiziert `diff.revision: expired`. Apply, Cancel, Expiry und Crash-Recovery konkurrieren unter demselben Lock; genau eine Transition gewinnt. Ein Snapshot zeigt eine noch aktive Revision ohne Approval-Token und erlaubt nach UI-Reload nur sicheren Cancel oder das Abwarten des Expiry, danach kann eine neue Revision erzeugt werden.

Trennt der Client die Review-POST-Verbindung vor der `ready`-Transition oder läuft sie nach 10 Sekunden aus, abortiert der Gateway Stream und Revision, erzeugt keinen Token und löst den Lock. Gewinnt `ready` atomar vor einem Disconnect, bleiben Revision und Token bis Apply, Cancel oder Expiry gültig; eine verlorene HTTP-Antwort ist absichtlich nicht wiederhol- oder abrufbar, und der Client kann die tokenlose Snapshot-Revision nur canceln. Completion, Disconnect, Timeout, Response-Write, Cancel und Apply werden unter demselben Revisions-Lock linearisiert.

Der Apply ist die reviewbare Agent-Write-Proposal im Sinne der Repository-Invarianten. Er berührt keine Finance-Datenbank. Eine spätere persistente Apply-Historie benötigt ein eigenes Audit-Konzept.

### 4.4 Tooling-Scope

V1 ist ausdrücklich ein Analyse-/Edit-Agent ohne Projekt-Builds. Ignored Dependency-Bäume wie `node_modules`, `.venv`, Build-Caches und Package-Manager-Stores werden nicht importiert oder gemountet; Tool-Netzwerk bleibt aus. Erlaubt sind im isolierten Workspace grundlegende read-only Systemwerkzeuge und textuelle Änderungen. Die UI kennzeichnet Verifikationsvorschläge als „nicht in der Sandbox ausgeführt“.

Ein späterer Ausführungsmodus benötigt ein separates ADR für offline provisionierte Dependencies, Lifecycle-Skripte, native Binaries und einen eigenen Sandbox-/Supply-Chain-Test. V1 behauptet nicht, `pnpm`, `uv`, Tests, Typechecks oder Builds ausführen zu können.

## 5. Codex-Home, Auth und Konfiguration

### 5.1 Eigentum und Lebensdauer

Chelaro nutzt ausschließlich `<userData>/agent/mounts/control/home` als `CODEX_HOME`; das globale `~/.codex` wird weder gelesen noch kopiert, verlinkt oder importiert. Damit werden keine fremden Threads, MCP-Server, Plugins, Skills, Hooks oder Konfigurationen übernommen.

Der Nutzer meldet sich ausschließlich mit `account/login/start { type: "chatgptDeviceCode" }` im App-Home an. Dafür startet der Host einen Auth-App-Server ohne Tool-Workspace, dessen Profil nur Systemruntime und app-eigenes Codex-Home erlaubt. Der Host validiert `loginId`, `verificationUrl` und `userCode`, akzeptiert nur HTTPS auf dem gepinnten Origin `https://auth.openai.com`, zeigt den Code nur flüchtig an und öffnet die URL ausschließlich über den eingeschränkten Electron-External-Open-Pfad. `account/login/completed` muss innerhalb von zehn Minuten dieselbe `loginId` terminal mit Erfolg bestätigen. Cancel sendet genau einmal `account/login/cancel`; Completion, Cancel, Timeout, Logout und Child-Exit sind als Race getestet. Login-ID, URL, User Code und Authfehlerdetails werden nicht geloggt oder persistiert. Die UI nimmt keine API-Keys entgegen.

Nach erfolgreichem Login stoppt der Host den Auth-App-Server. Erst nach Import startet er einen neuen Execution-App-Server mit einem statischen Seatbelt-Profil für exakt diesen einen kanonischen Workspace. V1 erlaubt genau einen aktiven Workspace und höchstens einen aktiven Thread; nach terminaler Session und vollständigem Child-Reap kann sequenziell ein neuer Thread im selben exakt profilierten Workspace starten. Beim Workspacewechsel wird der bisherige Child kontrolliert beendet und Workspace/Baseline nach Apply oder explizitem Verwerfen bereinigt; erst danach darf ein neuer Root profiliert werden. Ein Profil auf dem gemeinsamen `workspaces/`-Elternpfad ist verboten. Der Negativtest legt einen zweiten Workspace neben dem aktiven an und beweist, dass Codex ihn nicht lesen kann.

Auth ist Teil eines serialisierten Control-Server-Lifecycles. Bei jedem App-/Utility-Start und ohne aktiven Workspace startet der Host bei Bedarf einen Control-App-Server mit dem Control-Profil, führt `account/read` sowie optional Login/Cancel/Logout aus und stoppt ihn vollständig. Control- und Execution-App-Server laufen nie parallel; ein Mutex und Prozess-ID-Prüfungen erzwingen dies. Logout bei aktivem Workspace verlangt zuerst Apply oder Verwerfen, stoppt anschließend Execution und startet dann Control. Control-Start, Initialize und Stop haben jeweils 15 Sekunden Timeout. Nach Control-Crash wird ein neuer Control-Server gestartet und Authzustand ausschließlich über `account/read` revalidiert; ein vorher pending Login gilt als fehlgeschlagen und wird nie automatisch fortgesetzt.

Das Home und seine Dateien erhalten Owner-only-Rechte; abweichende Rechte deaktivieren den Agenten. `account/logout` wird erst nach gestoppten Turns ausgeführt und durch `account/read` bestätigt.

Threads werden V1 mit `ephemeral: true` gestartet. Sie existieren nur während der laufenden Agent-Host-Epoche. `thread/list`, `thread/read` und `thread/resume` aus persistentem Codex-Verlauf werden nicht in die öffentliche V1-API aufgenommen. Phase 0 muss mit der echten CLI beweisen, dass ephemere Threads keine Rollout-Historie hinterlassen; andernfalls ist dies ein Blocker.

Authentifizierungsdaten bleiben bis zum Logout oder „Alle Agent-Daten löschen“ bestehen. Die Delete-all-Transaktion gehört Electron: UI → gesicherter Gateway-Request → Agent Host quiesce/ack → Utility Process und App Server reap → offene Apply-Journale reconciled → validierter Image-Cleanup → flüchtigen Gateway-State verwerfen → optionaler frischer Agent-Host-Start. Sie antwortet zunächst `202` und publiziert Fortschritt beziehungsweise einen dauerhaften Recovery-Fehler über den Gateway-Stream. Nach erfolgreichem Cleanup verwirft Electron atomar Public Projection, Timeline/Messages, Replay-Ring, Idempotency-Ledger sowie Request-/Diff-/Login-Tokens, rotiert Gateway-Epoche und CSRF-Token, schließt alle alten Streams und startet mit leerem Snapshot plus redigiertem `dataDeletion: completed`. Alte Event-IDs liefern immer `replay_unavailable`. Ein Host löscht niemals sein eigenes laufendes State-Verzeichnis. V1 hat keine automatische Retention; der First-run-Hinweis erklärt Speicherort, Inhalt und Löschweg.

### 5.2 Restriktive Konfiguration

Chelaro schreibt eine vollständige, versionsgebundene `config.toml` selbst und startet App Server mit `--strict-config`. Die Konfiguration:

- definiert keine MCP-Server, Plugins, Hooks, Apps oder zusätzlichen Skill-Roots;
- deaktiviert Projektkonfigurationsvertrauen und Netzwerk für Agent-Tools;
- übernimmt keine Shell-Environment außer der expliziten Allowlist;
- deaktiviert Analytics standardmäßig;
- erlaubt als Workspace ausschließlich den sanitisierten Root.

Nach `initialize` und unmittelbar vor jedem Thread- sowie Turn-Start prüft der Host mit den für die gepinnte Version verfügbaren Read-Methoden die effektive Konfiguration. `config/read`, `mcpServerStatus/list`, `hooks/list`, `skills/list` und Plugin-/App-Status müssen dem erwarteten leeren beziehungsweise explizit read-only importierten Instruktionszustand entsprechen. `skills/changed`, Config-/Project-Warnings oder andere Invalidation-Notifications sperren weitere Turns, bis dieselbe Prüfung erneut erfolgreich war. Abweichungen sind `unsafe_codex_configuration` und verhindern Thread-/Turn-Starts.

Die Child-Environment wird neu aus einer Allowlist aufgebaut. Finance-OS-Tokens, Datenbank-URLs, Cloud-Credentials und unbekannte Parent-Variablen werden nicht vererbt. Der Seatbelt- und echte-CLI-Test beweist zusätzlich, dass ein Tool-Prozess weder das Codex-Authmaterial noch den Live-Checkout lesen kann.

## 6. Reproduzierbares Codex-Protokoll

### 6.1 Gepinnter Anbieter

`apps/agent-host` deklariert eine exakte `@openai/codex`-Version ohne Range; `pnpm-lock.yaml` ist die Generator- und Laufzeitquelle. V1 verwendet nicht eine beliebige globale `codex`-Installation. Der ausführbare Pfad wird aus dem Workspace-Paket aufgelöst.

Die Baseline `0.149.1` wird in Phase 0 durch einen Dependency-Lizenz-/Distributionscheck bestätigt. Ein Upgrade ist ein eigener fokussierter Commit, der Schema-Diff, Fixtures, Compatibility-Matrix und echte CLI-Smokes gemeinsam aktualisiert.

### 6.2 Generierung und Runtime-Validierung

Vor dem ersten Client-Code werden beide Artefakte deterministisch generiert und committed:

```text
generated/codex/ts/       # codex app-server generate-ts
generated/codex/schema/   # codex app-server generate-json-schema
```

CI regeneriert sie aus der gelockten CLI und fordert einen leeren Diff. JSON-RPC-Nachrichten und HTTP-Bodies werden vor jeder Zustandsmutation mit Ajv 2020 im Strict Mode gegen abgeleitete, versionsgebundene Schemas validiert:

1. maximale Bytes und gültiges JSON;
2. JSON-RPC-Envelope und Request-ID-Typ;
3. exakte Methodendiscriminante;
4. methodenspezifische Params/Result-Union mit `additionalProperties: false`, soweit das Upstream-Schema dies erlaubt;
5. sichere Behandlung unbekannter Notifications erst nach Envelope-Prüfung.

Malformed-, Fuzz-, Unknown-Union-, Oversize- und Schema-Drift-Tests sind Pflicht. Ein TypeScript-Cast gilt nicht als Validierung.

### 6.3 Initialisierung und Server-Request-Policy

Der Host sendet:

```text
experimentalApi: false
requestAttestation: false
mcpServerOpenaiFormElicitation: false
extensions: null
```

Für jede Server-Request-Variante des gepinnten `ServerRequest`-Schemas gilt eine explizite Policy:

| Request | V1-Verhalten |
| --- | --- |
| `item/commandExecution/requestApproval` | nach Capability-Prüfung Nutzerentscheidung |
| `item/fileChange/requestApproval` | nach vollständiger Diff-Korrelation Nutzerentscheidung |
| `item/tool/requestUserInput` | JSON-RPC Method-not-supported; Experimental API ist aus |
| `item/permissions/requestApproval` | getestete No-grant-Antwort `{ permissions: {}, scope: "turn", strictAutoReview: true }`; bei anderer Semantik JSON-RPC-Fehler und Turn-Abbruch |
| `mcpServer/elicitation/request` | `{ action: "decline", content: null, _meta: null }` |
| `item/tool/call` | JSON-RPC-Fehler; keine Dynamic Tools registriert |
| `account/chatgptAuthTokens/refresh` | JSON-RPC-Fehler; External-Token-Modus ist aus |
| `attestation/generate` | JSON-RPC-Fehler; Capability ist aus |
| Legacy `applyPatchApproval` | eigener Mapper: `approved`, `{ denied: { rejection } }` oder `abort` nach derselben File-Prüfung |
| Legacy `execCommandApproval` | eigener Mapper: `approved`, `{ denied: { rejection } }` oder `abort` nach derselben Command-Prüfung |
| unbekannter Request | sofortiger Method-not-supported-Fehler und Protocol Warning |

V2 Command/File nutzen ausschließlich `{ decision: "accept" | "decline" | "cancel" }`; Policy-Amendments und `acceptForSession` werden nie erzeugt. Kein Request bleibt unbeantwortet. Jede Antwort besitzt einen Timeout und wird beim Interrupt oder Child-Exit genau einmal abgeschlossen. Echte-CLI-Contract-Smokes beweisen nicht nur eine terminale Response, sondern dass No-grant, Decline und Cancel keine Capability freischalten.

## 7. Capability-basierte Freigaben

Der einzelne Execution-App-Server startet im exakt profilierten sanitisierten Workspace mit `workspace-write`, `approvalPolicy: untrusted`, Nutzer als Reviewer und deaktiviertem Tool-Netzwerk. Der äußere Dateisandbox begrenzt den maximalen Schaden; die folgende Matrix begrenzt jede Zustimmung zusätzlich:

| Angeforderte Fähigkeit | Nutzer darf Accept wählen? | Bedingung |
| --- | ---: | --- |
| Command im Workspace | Ja | kanonisches `cwd` im Workspace; kein Network-/Policy-Amendment; vollständiger Befehl |
| File Change im Workspace | Ja | `grantRoot` fehlt; vollständiger Diff korreliert; nur erlaubte relative Pfade |
| Network Access | Nein | immer automatisch Decline |
| Permission Profile | Nein | immer automatisch Decline |
| zusätzlicher Write Root/`grantRoot` | Nein | immer automatisch Decline |
| MCP/Plugin/Hook/Dynamic Tool | Nein | nicht konfiguriert und ablehnen |
| gekürzte oder widersprüchliche Anzeige | Nein | nur Decline/Cancel |
| unbekannte Capability | Nein | fail closed |

Ein Accept umfasst nur die konkrete Callback-ID; Session-weites Always-Allow, Exec-/Network-Policy-Amendments und `acceptForSession` sind nicht verfügbar.

Die Approval-UI aktiviert Accept erst, wenn Hostdaten vollständig sind: Request-ID, optionale `approvalId`, Item/Turn/Thread, vollständiger Command oder Diff, kanonisches `cwd`, Pfade, Capability, Reason und Truncation-Status. Für File Changes wird die Darstellung aus Item-/Patch-Events plus Workspace-Diff korreliert. Bei Event-Reordering wartet die Karte; bei Timeout oder Widerspruch bleibt nur Decline.

Negative Integrationstests gegen den echten gepinnten App Server fordern Write außerhalb des Agent-Workspace, `.env`-/Home-Lesezugriff, Symlink-Escape, Netzwerk, `grantRoot` und Permission Profile an. Alle müssen am tatsächlichen Sandboxrand scheitern oder automatisch abgelehnt werden.

## 8. Agent-Host-Verträge

### 8.1 Paketstruktur

```text
apps/agent-host/
  package.json
  src/
    config.ts
    server.ts
    auth.ts
    workspace-service.ts
    codex-process.ts
    jsonl-framer.ts
    json-rpc-client.ts
    runtime-validator.ts
    event-normalizer.ts
    session-manager.ts
    protocol.ts
  generated/codex/{ts,schema}/
  test/
    fake-app-server.ts
    fixtures/
    *.test.ts

packages/agent-workspace/
  src/
    manifest.ts
    importer.ts
    diff-revision.ts
    apply-journal.ts
    recovery.ts
  test/
    *.test.ts

packages/agent-storage/
  src/
    image-layout.ts
    mount-lifecycle.ts
    quota-watcher.ts
    reservation.ts
  test/
    *.test.ts
```

Beide Shared Packages sind eigene pnpm-Workspaces mit `type: module`. Sie kompilieren TypeScript nach `dist/` als ESM plus `.d.ts` und exportieren ausschließlich gebaute Artefakte; Electron lädt keine `.ts`-Quelldateien. Buildreihenfolge ist `agent-storage` → `agent-workspace` → `agent-host` → Desktop. `agent-workspace` deklariert `agent-storage` als Workspace-Dependency, Agent Host und Desktop deklarieren ihre direkten Shared-Package-Abhängigkeiten.

### 8.2 Lokale HTTP/SSE-API

Der stabile Electron Agent Gateway besitzt die HTTP/SSE-API und übersetzt validierte Requests in Utility-Process-IPC. Der Agent Host öffnet keinen eigenen TCP-Port. Alle `/v1`-Routen verlangen das flüchtige Bridge-Secret. `/health` liefert ohne Auth nur konstante Gateway-Identität und Liveness. Antworten nutzen `Cache-Control: no-store` und stabile Fehlerumschläge.

| Methode | Pfad | Zweck |
| --- | --- | --- |
| `GET` | `/health` | Prozessidentität ohne Account-/Workspace-Daten |
| `GET` | `/v1/snapshot` | globale atomare UI-Projektion mit Watermark |
| `GET` | `/v1/status` | Instanz, Auth-, Isolation- und Kompatibilitätsstatus |
| `POST` | `/v1/login` | app-eigenen Account-Login starten |
| `POST` | `/v1/logout` | app-eigenen Account abmelden |
| `POST` | `/v1/data/delete` | Electron-geführte Delete-all-Transaktion starten |
| `POST` | `/v1/workspaces` | geprüften Snapshot importieren |
| `GET` | `/v1/threads` | nur ephemere Threads dieser Host-Epoche |
| `POST` | `/v1/threads` | Thread im ausgegebenen Workspace erstellen |
| `GET` | `/v1/threads/:id` | Snapshot mit `asOfEventId` |
| `POST` | `/v1/threads/:id/turns` | Turn mit verpflichtendem Idempotency-Key starten |
| `POST` | `/v1/threads/:id/interrupt` | aktiven Turn abbrechen |
| `POST` | `/v1/threads/:id/requests/:token` | Approval genau einmal beantworten |
| `POST` | `/v1/threads/:id/diff-revisions` | Workspace sperren und unveränderliche Reviewrevision erzeugen |
| `DELETE` | `/v1/diff-revisions/:id` | Review abbrechen und Workspace entsperren |
| `POST` | `/v1/diff-revisions/:id/apply` | Revision-Digest-/Token-gebundene `ready`-Revision anwenden |
| `GET` | `/v1/events` | SSE mit Gateway-Epoche und Replay |

Der Host hält eine Ownership-Map aller Workspace-, Thread-, Turn- und öffentlichen Request-IDs. Browserwerte werden nie direkt als App-Server-ID oder Pfad verwendet. Fremde, abgelaufene oder manipulierte IDs liefern unterschiedslos `404`.

Thread-Start setzt serverseitig `serviceName: "finance-os-desktop"`, `threadSource: "finance-os-desktop"`, `ephemeral: true`, exaktes Workspace-`cwd`, `approvalPolicy: "untrusted"`, `approvalsReviewer: "user"` und die erwartete `workspace-write`-Sandbox mit Tool-Netzwerk aus. Sicherheit stützt sich nicht auf das nicht zurücklesbare `serviceName`: Vor Ausgabe einer öffentlichen ID validiert der Host im `ThreadStartResponse` exakt top-level- und `thread.cwd`, `source === "appServer"`, `threadSource === "finance-os-desktop"`, `ephemeral === true`, effektive Approval Policy, Reviewer, Sandbox und ausschließlich die read-only geschützten `instructionSources`. Auch die Antwort muss zur ausstehenden Host-Korrelation gehören. Jede Abweichung beendet App Server und Toolprozesse und liefert `unsafe_codex_configuration`. Contract-Smokes injizieren für jedes einzelne Feld eine schema-valide Abweichung. Pro aktiver Attachment-Belegung wird genau eine Thread-ID ausgegeben; alte IDs bleiben nur ihrer terminalen Session zugeordnet.

### 8.3 Öffentlicher Snapshot-/Eventvertrag

Rohes Codex-JSON erreicht den Browser nie. Der Electron Gateway besitzt den einzigen seriellen Public Reducer, Sequence Counter und Replay-Ring. Der Agent Host liefert validierte, providerneutrale Domain Events über IPC; der Gateway ergänzt Host-Crash, Child-Generation, Recovery und Delete-all. Der gemeinsame Contract enthält mindestens:

```ts
type PublicErrorCode =
  | "agent_unavailable" | "agent_restarted" | "agent_runtime_not_attached" | "agent_storage_limit"
  | "agent_host_build_missing" | "unsafe_codex_configuration"
  | "unsupported_platform" | "isolation_failed" | "login_failed"
  | "import_blocked" | "secret_detected" | "scanner_unavailable" | "rate_limited"
  | "invalid_request" | "request_forbidden" | "resource_not_found" | "payload_too_large" | "frame_too_large"
  | "workspace_busy" | "workspace_already_attached" | "workspace_changed" | "workspace_recovery_required"
  | "request_expired" | "request_not_approvable" | "request_already_resolved" | "diff_too_large"
  | "idempotency_conflict" | "live_workspace_changed" | "replay_unavailable"
  | "protocol_incompatible" | "operation_timed_out";

type PublicOperation =
  | "account.read" | "login" | "logout" | "data.delete"
  | "workspace.import" | "workspace.discard" | "thread.create"
  | "turn.start" | "turn.interrupt" | "request.resolve"
  | "diff.review" | "diff.cancel" | "diff.apply" | "recovery";

type PublicHttpError = {
  error: { code: PublicErrorCode; message: string; requestId: string };
};

type PublicActivity = { sessionId: string } & (
  { kind: "reasoningSummary"; itemId: string; text: string; complete: boolean; truncated: boolean }
  | { kind: "command"; itemId: string; command: string; cwd: string; output: string; truncated: boolean; status: "running" | "completed" | "failed" }
  | { kind: "fileChange"; itemId: string; paths: string[]; operations: Array<"create" | "modify" | "delete" | "rename">; diffComplete: boolean; status: "pending" | "completed" | "failed" }
  | { kind: "tool"; itemId: string; name: string; summary: string; truncated: boolean; status: "running" | "completed" | "failed" }
);

type PublicMessage = {
  id: string;
  sessionId: string;
  sequence: number;
  role: "user" | "assistant";
  text: string;
  status: "submitted" | "streaming" | "completed" | "failed";
  truncated: boolean;
};

type PublicContentKind =
  | "assistant_message" | "user_message" | "command_output"
  | "reasoning_summary" | "tool_summary" | "approval_diff" | "revision_diff";

type PublicContentStreamRef = {
  streamId: string;
  contentKind: PublicContentKind;
  targetId: string;
  state: "streaming" | "completed" | "aborted";
  totalBytes: number | null;
  sha256: string | null;
  truncated: boolean;
};

type PublicContentChunk = {
  streamId: string;
  sequence: number;
  rawBytes: number;       // 1..49.152; ein leerer Stream endet direkt mit content.completed
  dataBase64: string;     // kanonisches Base64, dadurch unabhängig von JSON-Escaping
};

type PublicActiveContentStream = {
  ref: PublicContentStreamRef & { state: "streaming" };
  nextSequence: number;
  validatedBytes: number;
  prefixSha256: string;
  validatedPrefixBase64: string;
};

type PublicStreamAbortCode =
  | "chunk_missing" | "chunk_duplicate" | "chunk_out_of_order"
  | "chunk_invalid" | "stream_digest_mismatch" | "stream_too_large"
  | "stream_timed_out";

type PublicApproval =
  | { kind: "command"; token: string; command: string; cwd: string; reason: string | null; capability: "workspace_command"; truncated: false; expiresAt: string }
  | { kind: "fileChange"; token: string; paths: string[]; operations: Array<"create" | "modify" | "delete" | "rename">; completeDiff: string; diffDigest: string; capability: "workspace_file_change"; grantRoot: null; truncated: false; expiresAt: string }; // vollständiger Diff höchstens 480 KiB

type PublicMessageMetadata = Omit<PublicMessage, "text"> & { content: PublicContentStreamRef };

type PublicActivityMetadata = { sessionId: string } & (
  { kind: "reasoningSummary"; itemId: string; content: PublicContentStreamRef; complete: boolean }
  | { kind: "command"; itemId: string; command: string; cwd: string; content: PublicContentStreamRef; status: "running" | "completed" | "failed" }
  | { kind: "fileChange"; itemId: string; paths: string[]; operations: Array<"create" | "modify" | "delete" | "rename">; diffComplete: boolean; status: "pending" | "completed" | "failed" }
  | { kind: "tool"; itemId: string; name: string; content: PublicContentStreamRef; status: "running" | "completed" | "failed" }
);

type PublicApprovalMetadata =
  | Extract<PublicApproval, { kind: "command" }>
  | (Omit<Extract<PublicApproval, { kind: "fileChange" }>, "completeDiff"> & { diff: PublicContentStreamRef });

type PublicPendingApproval =
  | { phase: "assembling"; request: Extract<PublicApprovalMetadata, { kind: "fileChange" }> }
  | { phase: "approvable"; request: PublicApproval };

type PublicDiffRevision = {
  id: string;
  revisionDigest: string;
  contentSha256: string;
  status: "streaming" | "ready" | "expired" | "applying" | "applied" | "conflict" | "recovery_required";
  diff: PublicContentStreamRef;
  completeDiff: string | null;
  expiresAt: string;
};

type PublicAgentSnapshot = {
  schemaVersion: 1;
  gatewayEpoch: string;
  childGeneration: number;
  asOfEventId: `${string}:${number}`;
  host: { status: "starting" | "ready" | "degraded" | "stopping" | "stopped" };
  login: { status: "signed_out" | "pending" | "signed_in" | "failed" };
  dataDeletion: { status: "idle" | "quiescing" | "reconciling" | "deleting" | "completed" | "failed"; errorCode?: PublicErrorCode };
  workspace: null | { id: string; status: "importing" | "ready" | "review_locked" | "applying" | "salvage_ready" | "recovery_required" | "closed" };
  sessions: Array<{ id: string; status: "active" | "context_lost" | "closed" }>;
  activeSessionId: string | null;
  thread: null | { id: string; sessionId: string; status: "creating" | "ready" | "context_lost" | "closed" | "failed" };
  turn: null | { id: string; status: "starting" | "running" | "interrupting" | "interrupted" | "completed" | "failed" };
  requests: PublicPendingApproval[];
  diffRevision: null | PublicDiffRevision;
  activeContentStreams: PublicActiveContentStream[];
  historyTruncated: boolean;
  messages: PublicMessage[];
  timeline: PublicActivity[];
};

type PublicAgentEvent = {
  schemaVersion: 1;
  eventId: `${string}:${number}`;
  gatewayEpoch: string;
  childGeneration: number;
  occurredAt: string;
  workspaceId?: string;
  threadId?: string;
  turnId?: string;
  payload:
    | { type: "host.status"; status: PublicAgentSnapshot["host"]["status"] }
    | { type: "login.status"; status: "signed_out" | "pending" | "signed_in" | "failed" }
    | { type: "dataDeletion.status"; status: PublicAgentSnapshot["dataDeletion"]["status"]; errorCode?: PublicErrorCode }
    | { type: "workspace.status"; status: NonNullable<PublicAgentSnapshot["workspace"]>["status"] }
    | { type: "session.status"; sessionId: string; status: "active" | "context_lost" | "closed" }
    | { type: "thread.status"; status: "creating" | "ready" | "context_lost" | "closed" | "failed" }
    | { type: "turn.status"; status: "starting" | "running" | "interrupting" | "interrupted" | "completed" | "failed" }
    | { type: "message.upsert"; message: PublicMessageMetadata }
    | { type: "message.completed"; messageId: string; truncated: boolean }
    | { type: "projection.truncated"; scope: "message" | "reasoning" | "tool" | "turn" | "history"; targetId: string }
    | { type: "activity.upsert"; activity: PublicActivityMetadata }
    | { type: "request.opened"; phase: "approvable"; request: Extract<PublicApprovalMetadata, { kind: "command" }> }
    | { type: "request.opened"; phase: "assembling"; request: Extract<PublicApprovalMetadata, { kind: "fileChange" }> }
    | { type: "request.approvable"; token: string; diffDigest: string }
    | { type: "request.resolved"; token: string; outcome: "accepted" | "declined" | "canceled" | "expired" }
    | { type: "content.chunk"; chunk: PublicContentChunk }
    | { type: "content.completed"; streamId: string; totalBytes: number; sha256: string; truncated: boolean }
    | { type: "content.aborted"; streamId: string; code: PublicStreamAbortCode }
    | { type: "diff.revision"; revisionId: string; revisionDigest: string; contentSha256: string; status: PublicDiffRevision["status"]; diff: PublicContentStreamRef; expiresAt: string }
    | { type: "operation.failed"; operation: PublicOperation; code: PublicErrorCode }
    | { type: "protocol.warning"; code: string }
    | { type: "stream.resync_required"; reason: string };
};
```

`PublicErrorCode` ist eine geschlossene Union stabiler, redigierter Codes; freie Upstream-Fehlermeldungen sind nicht zulässig. Der Gateway projiziert die Metadaten der Nutzer-Nachricht vor dem `turn/start`-RPC. Variable Textinhalte werden ausschließlich über `content.chunk` übertragen und deterministisch in die Snapshot-Felder `text`, `output`, `summary` oder `completeDiff` assembliert. `message.upsert`, `activity.upsert` und `request.opened` enthalten nur begrenzte Metadaten, einen Stream-Verweis und den finalen Kürzungszustand, niemals den großen Inhalt selbst. Der einmalige Apply-Approval-Token und der Device Code erscheinen nie in Snapshot, Replay-Ring oder Logs; öffentliche Codex-Request-Tokens leben nur bis zur Requestauflösung in der flüchtigen Projektion. Nach Reload kann eine bestehende Diffrevision nur gecancelt und neu erzeugt werden. Rohes Reasoning (`item/reasoning/textDelta`) und Raw-Response-Items werden im Normalizer verworfen und weder gepuffert noch geloggt. Snapshot und Eventschemas werden gemeinsam generiert/validiert und per Contract-Test zwischen Gateway, Host und Web geteilt.

Jeder Inhaltsstream beginnt implizit mit dem ersten Metadaten-Event und `sequence = 0`. Host, Gateway und Browser halten unabhängig `(nextSequence, totalBytes, SHA-256)` und akzeptieren nur kanonisches Base64 mit höchstens 49.152 dekodierten Bytes pro Chunk; die Base64-Nutzlast bleibt damit höchstens 64 KiB und der gesamte Event-Envelope unter 80 KiB. `content.completed` ist der einzige Completion Marker und wird erst nach Vergleich von Bytelänge und Digest übernommen. Fehlende, doppelte, ungeordnete, ungültige, verspätete oder zu große Chunks sowie ein falscher Abschluss brechen den Stream deterministisch mit `content.aborted` ab; partielle Bytes werden nicht als vollständiger Inhalt angezeigt. Bei Message-, Reasoning-, Tool- und Command-Inhalt wird das Zielobjekt `failed` beziehungsweise sichtbar `truncated`; bei Approval- und Revisions-Diffs wird Accept/Apply sofort deaktiviert und der Request beziehungsweise die Revision terminal `canceled`/`expired`. Nach 30 Sekunden ohne Fortschritt gilt derselbe Abort-Pfad.

Der serielle Gateway-Reducer friert an `asOfEventId` für jeden laufenden Stream einen wiederaufnehmbaren `PublicActiveContentStream` ein. `validatedPrefixBase64` enthält exakt die bereits validierten Bytes; der Browser prüft daraus `validatedBytes`, `prefixSha256`, Zielbindung und `nextSequence`, bevor er Folgeevents nach der Snapshot-Watermark annimmt. Ab diesem Watermark erscheinen ausschließlich Chunks mit der gespeicherten nächsten Stream-Sequenz oder ein Completion/Abort-Event. Der Präfix wird nicht gleichzeitig als freigabefähiger vollständiger Diff interpretiert. Die serialisierte Doppelrepräsentation eines laufenden Anzeige-Präfixes zählt vollständig gegen das 16-MiB-Snapshotbudget. Bei inkonsistentem Resume-Zustand verwirft der Client die Projektion und fordert einen neuen Snapshot; der Gateway abortiert den betroffenen Stream, falls seine eigene eingefrorene Zustandsprüfung fehlschlägt. Damit sind Reload und Replay-Gap während laufender Inhalte ohne ungeprüfte Fortsetzung definiert.

Approval ist auch serverseitig fail-closed: Interne `PendingRequest`-Phasen sind `assembling → approvable → resolved` oder aus jedem nichtterminalen Zustand unwiderruflich `canceled`. Vor `request.opened` besitzt der Host bereits den vollständigen begrenzten File-Change-Diff und dessen `diffDigest`; der Streaming-Ref trägt diesen erwarteten SHA-256 auch im Zustand `streaming`. Ein Command Request ohne Inhaltsstream wird mit `phase: "approvable"` publiziert; ein File-Change Request beginnt mit `phase: "assembling"`. Der serielle Reducer validiert Completion und Korrelation, setzt die interne Phase atomar auf `approvable` und publiziert danach in fester Reihenfolge `content.completed` und das rein bestätigende `request.approvable`; zwischen diesen Events kann ein direkter Endpoint-Call den bereits atomar gesetzten Zustand sehen, aber niemals einen nur teilweise validierten. Der kanonische Endpoint `POST /v1/threads/:id/requests/:token` erlaubt `accept` ausschließlich in `approvable`; vor jeder Phasenprüfung müssen URL-Thread-ID, Token-Ownership, `PendingRequest.threadId`, aktuelle Session und Host-Korrelation übereinstimmen, sonst folgt unterschiedslos `404 resource_not_found`. In `assembling` liefert er `409 request_not_approvable`, in terminalen Phasen den bestehenden `request_already_resolved`. `decline` ist in beiden nichtterminalen Phasen zulässig. Abort, Timeout, Digest-/Sequenzfehler, Child-Exit oder Korrelationverlust antworten dem App Server genau einmal mit Decline, wechseln terminal nach `canceled` und können durch keinen Late Request wieder approvable werden. Die UI-Sperre ist nur eine zusätzliche Darstellung dieser Host-/Gateway-Invariante.

Ein Revisions-Diff besitzt `contentKind: "revision_diff"`, `targetId === revisionId` und zunächst `status: "streaming"`. `revisionDigest` bindet unabhängig davon die strukturierte Mutation an Baseline, Operationen, Pfade, Modi und Zielbytes; `contentSha256` bindet ausschließlich die kanonischen UTF-8-Anzeige-Diffbytes. Erst `content.completed` mit `sha256 === contentSha256` friert `completeDiff` und Status `ready` atomar ein; erst dann darf der nur in der offenen Review-POST-Antwort ausgelieferte Apply-Approval-Token erzeugt werden. Snapshot und `diff.revision` tragen beide Digests und denselben Stream-Verweis, aber nie den Token. Abort, Überschreitung oder verlorene Bindung setzen `expired`, entfernen partielle Bytes nach Darstellung eines sicheren Fehlers und verlangen eine neu erzeugte Revision.

Jede Unterhaltung besitzt eine unveränderliche öffentliche `sessionId`, an die Nachrichten, Activities und Thread gebunden sind. Geht ein bereits verwendeter ephemerer Thread verloren, markiert der Gateway Session und Thread terminal `context_lost`, behält den alten Verlauf nur lesbar, sperrt den Composer und startet niemals still einen Ersatzthread. Der Nutzer muss „Neue Unterhaltung im bestehenden Workspace“ auslösen; unter dem Workspace-Lock werden alter Thread/Execution-Child vollständig reapbar beendet, die aktive Attachment-Belegung freigegeben und erst dann neue Session-/Thread-IDs mit sichtbarem Kontexttrenner erzeugt. V1 rehydriert keinen Modellkontext aus UI-Nachrichten.

Die Projektion hält höchstens eine aktive und vier terminale Sessions, weiterhin unter dem 16-MiB-Gesamtbudget. Bei Überschreitung wird ausschließlich die älteste terminale Session als ganze Einheit mit ihren Messages und Activities entfernt und `historyTruncated: true` gesetzt; aktive Sessions, offene Requests und Review-/Apply-Daten werden nie evicted.

HTTP nutzt ausschließlich `PublicHttpError`: `400 invalid_request`, `403 request_forbidden`, `404 resource_not_found`, `409` für Workspace-/Request-/Idempotency-/Live-Konflikte, `413 payload_too_large|frame_too_large|diff_too_large`, `429 rate_limited`, `503` für nicht angehängte/unverfügbare/unsichere/recovery-blockierte Agentzustände und `504 operation_timed_out`. Der Proxy bewahrt Status, Code und Request-ID, ersetzt aber interne Messages durch sichere deutsche Texte.

Interne→öffentliche Mapper sind explizite `satisfies Record<InternalState, PublicState>`-Tabellen mit `assertNever`: Control-/Execution-App-Serverzustände mappen auf Public Host/Operation, alle internen Workspacezustände einschließlich `salvage_ready` auf die gleichnamige Public Union und alle Turnabschlüsse einschließlich `interrupted` auf die Public Turn Union. Contract-Tests iterieren jede Enum-/Union-Variante; ein neuer interner Zustand bricht Typecheck und Schema-Fixture-Test.

### 8.4 Idempotenz

Turn-Start und Apply verlangen UUIDv4 als `Idempotency-Key`. Der Gateway führt pro Gateway-Epoche ein begrenztes Ledger für 30 Minuten mit operationsspezifischem Scope:

- Turn-Start: `(turn.start, threadId, key)`;
- Diff-Apply einschließlich Salvage: `(diff.apply, workspaceId, key)` und damit unabhängig von einer verlorenen Thread-ID;
- `revisionId`, `revisionDigest`, Approval-Token-Hash und übriger Body liegen ausschließlich im gespeicherten Body-Hash; derselbe Key mit irgendeiner Abweichung liefert `409 idempotency_conflict` und kann keine spätere Revision ausführen;
- gespeichert werden Request-Body-Hash und laufendes/terminales Ergebnis;
- gleicher Key plus gleicher Body teilt das Ergebnis;
- gleicher Key plus anderer Body liefert `409 idempotency_conflict`;
- Clients wiederholen Mutationen nicht automatisch;
- nach Epoch-Wechsel ist das alte Ergebnis nicht rekonstruierbar und der Client muss Zustand neu laden.

### 8.5 Orthogonale Zustände

Approval ist kein exklusiver Turn-Zustand. Der Host modelliert separat:

```text
host:       starting | ready | degraded | stopping | stopped
appServer:  stopped | control_starting | control_ready | execution_starting | execution_ready | stopping | crashed
login:      signed_out | pending | signed_in | failed
workspace:  importing | ready | review_locked | applying | salvage_ready | recovery_required | closed
session:    active | context_lost | closed
thread:     creating | ready | context_lost | closed | failed
turn:       none | starting | running | interrupting | interrupted | completed | failed
connection: connecting | live | reconnecting | resync_required
pendingRequests: Map<publicToken, PendingRequest>
```

`PendingRequest` trennt öffentlichen Zufallstoken, JSON-RPC-Request-ID, `threadId`, `turnId`, `itemId`, optionale `approvalId`, erwarteten Content-Digest und die Phase `assembling | approvable | resolved | canceled`. Mehrere Requests dürfen gleichzeitig offen sein. Eine Transitionstabelle im Code deckt Content-Completion/-Abort, User Response, App-Server-resolved, Late Response, Interrupt, Timeout und Child-Exit ab. Genau ein Pfad darf einen Pending Request terminal auflösen; `accept` ist ausschließlich aus `approvable` zulässig, spätere Antworten liefern `409 request_already_resolved`.

Der Workspace-Lock serialisiert Turn-Mutation, New-Chat, Diff-Review, Apply, Cleanup und Recovery unabhängig vom Threadstatus. Eine parallele Thread-Erstellung oder New-Chat während aktiver Attachment-Belegung liefert `409 workspace_already_attached`; nach terminaler Session, Child-Reap und atomarer Freigabe darf genau eine sequenzielle neue Attachment-Belegung gewinnen.

### 8.6 JSONL, Ressourcen und Backpressure

- Inkrementeller UTF-8-Decoder und Chunk-Liste; keine wiederholte Gesamtrest-Konkatenation.
- Maximaler App-Server-Frame: 8 MiB; maximaler normalisierter interner Event: 512 KiB. Öffentliche Inhalts-Events bleiben durch 49.152 rohe Bytes beziehungsweise 64 KiB Base64 und einen maximal 80 KiB großen JSON-Envelope deutlich darunter.
- Maximal ein aktiver Workspace, ein Thread, ein Turn, eine Diffrevision, 16 Pending Requests und 2 SSE-Clients.
- Die vier APFS-Images erzwingen zusammen maximal 1,75 GiB. Vor Imageanlage/Import müssen mindestens 4 GiB real frei und nach Prognose 2 GiB Sicherheitsreserve verbleiben. Import prüft die jeweiligen Volume-Free-Bytes vor jedem Rename; Apply reserviert seinen Worst Case vor dem ersten Live-Write. Überschreitung liefert `agent_storage_limit`, terminiert Codex bei Tool-Writes, entfernt neue Tempdaten atomar und setzt je nach Manifestprüfung `salvage_ready` oder `recovery_required`.
- Höchstens 64 parallele JSON-RPC-Requests. Initialize/Config-Checks laufen nach 15 Sekunden, Login nach 10 Minuten, Approval nach 10 Minuten, Interrupt nach 10 Sekunden und ein Turn nach 60 Minuten in einen kontrollierten Timeout/Interrupt.
- Prompts sind auf 64 KiB UTF-8 begrenzt. Das 128-KiB-Limit gilt für HTTP-Mutationsrequests und normale IPC-Command-Envelopes, nicht pauschal für Read-Responses. Diffrevisionen und Inhaltsdaten nutzen den festgeschriebenen Chunk-Transport; `/v1/snapshot` ist die unten definierte separate 16-MiB-Response-Ausnahme.
- Workspace-Import inklusive Scanner hat 120 Sekunden, Diffrevision 10 Sekunden, Review-Lock 15 Minuten, Utility-Child-Ready 15 Sekunden, normales Gateway→Host-IPC 30 Sekunden, Apply 60 Sekunden und Delete-all/Recovery 120 Sekunden. Timeout liefert einen stabilen Code und führt je nach Mutation zu Temp-Cleanup oder `recovery_required`.
- Token Buckets pro Gateway-Epoche: höchstens 2 Workspace-Imports pro Stunde mit Burst 1, 5 Login/Logout/Delete/Thread-/Turn-Starts pro Minute mit Burst 5, 10 Diffrevisionen/Applies pro Stunde mit Burst 2, 30 Approval-/Interrupt-Antworten pro Minute mit Burst 10 und 120 Reads pro Minute mit Burst 30.
- Replay-Ring: höchstens 2.000 Events oder 16 MiB, je nachdem was zuerst erreicht wird.
- Globaler Snapshot: höchstens 16 MiB; ältere abgeschlossene Timeline-Aktivitäten werden deterministisch aus der flüchtigen Projektion entfernt, offene Requests und terminaler Turnstatus nie. `GET /v1/snapshot` ist eine explizite Read-Response-Ausnahme vom 128-KiB-Requestlimit: Gateway serialisiert JSON inkrementell, Next proxyt und zählt den Stream unabhängig, keine Schicht materialisiert eine zweite unbegrenzte Kopie. Bei mehr als 16 MiB wird die Response vor einem verwertbaren Abschluss abgebrochen und der Gateway muss die Projektion nach den Eviction-Regeln verkleinern, bevor ein neuer Snapshot ausgegeben wird.
- Der Reducer berechnet vor Annahme jedes Content-Chunks dessen Worst-Case-Snapshotgröße einschließlich Base64-Präfix, bereits assemblierter Anzeige, Metadaten und 1 MiB Reserve für Terminalzustände. Würde die Projektion 16 MiB überschreiten, nimmt er den Chunk nicht an: Anzeige-Streams werden kontrolliert `truncated`/`aborted`, Approval-Streams `canceled` und Revisions-Streams `expired`. Damit bleiben offene Requests zwar unevicted, können bei fehlendem sicherem Darstellungsbudget aber fail-closed terminal aufgelöst werden; ein gültiger Snapshot ist stets erzeugbar.
- Pro Client maximal 2 MiB ungeflushte SSE-Daten. Danach erhält er, soweit schreibbar, `stream.resync_required` und die Verbindung schließt.
- Command-Output wird je Item nach 1 MiB als `truncated` markiert, aber vom Child weiter vollständig gedraint und verworfen.
- User-Nachrichten bleiben unter 64 KiB, jede Assistant-Nachricht unter 2 MiB, jede Reasoning-Summary unter 256 KiB und alle Reasoning-Summaries eines Turns unter 1 MiB. Nachrichten plus Activities eines Turns bleiben unter 8 MiB; die gesamte Public Projection unter 16 MiB. Nach Erreichen wird weiter gedraint und verworfen, das betroffene Objekt erhält `truncated: true`, und der Snapshot setzt bei Eviction älterer abgeschlossener Inhalte `historyTruncated: true`.
- Approval-, Request-Resolution- und Terminal-Events werden nie still verworfen. Ist ihre Aufnahme nicht möglich, geht der Host in `degraded`, unterbricht aktive Turns und erzwingt Resync.
- Stdin respektiert `drain`; RPC-Anzahl und methodenspezifische Timeouts sind begrenzt.
- Codex-stderr besitzt einen redigierten 256-KiB-Ringpuffer und wird nie mit `stdio: inherit` in allgemeine Logs gespiegelt.
- Assistant-/User-Text, Reasoning-Summaries, Tool-Summaries, Command-Output sowie Approval- und Revisions-Diffs verwenden durch Host, IPC, Gateway, Next und Browser denselben sequenzierten `content.chunk`-Vertrag. Jeder Chunk enthält höchstens 49.152 rohe Bytes/64 KiB Base64. Die zustandsbehafteten Assembler in Host, Gateway und Browser validieren jeweils unabhängig Reihenfolge, dekodierte Bytelänge, Gesamtlimit und Abschlussdigest. Next bleibt absichtlich zustandslos: Es validiert pro Request/Response nur Schema, kanonisches Base64, deklarierte Chunkgröße, JSON-Envelope und die gesamte weitergeleitete HTTP-Bytemenge; es behauptet keine Sequenz-/Digestprüfung über getrennte Snapshot- und SSE-Requests. Große Felder erscheinen nie zusätzlich in `message.upsert`, `activity.upsert` oder `request.opened`. Command-Output endet bei 1 MiB, Approval-Diffs bei 480 KiB und Revisions-Diffs bei 1 MiB. Nur der Browser darf nach erfolgreichem Abschluss den jeweiligen begrenzten Inhalt für die Darstellung halten; Zwischenstufen arbeiten mit begrenzten Stream-/Reducer-Puffern und geben Speicher bei Abschluss oder Abort frei.

Alle Werte sind kompilierte Security-Konstanten, keine Browseroptionen. Eine Änderung benötigt fokussierte Last-/Security-Tests. Prompttext wird vor `turn/start` mit demselben gepinnten Secret-Regelwerk geprüft; bekannte Treffer werden ohne Override blockiert und weder geloggt noch in das Idempotency-Ledger aufgenommen.

## 9. SSE-Snapshot- und Replay-Vertrag

Jeder Electron-Gateway-Start erzeugt `gatewayEpoch` als UUID; Agent-Host-Restarts erhöhen nur `childGeneration`. Event-IDs sind `<gatewayEpoch>:<uint64-sequence>`. Der Gateway aktualisiert globale Projektion und Replay-Ring im selben seriellen Reducer.

1. `GET /v1/snapshot` liefert die vollständige globale `PublicAgentSnapshot` für Login, Import, Host, Workspace, Thread, Turn, Requests, Diff und Delete-all.
2. Der Client öffnet SSE mit `Last-Event-ID: asOfEventId`.
3. Der Gateway prüft vor dem Stream-Upgrade Epoche und Replay-Untergrenze.
4. Sind alle Folgeevents vorhanden, replayt er strikt nach Sequence und wechselt atomar auf live.
5. Bei fremder Gateway-Epoche oder Buffer-Gap antwortet er vor Streambeginn mit `409 replay_unavailable`; der Client verwirft seine gesamte Projektion und lädt `/v1/snapshot` neu.
6. Alle 15 Sekunden wird ein Heartbeat gesendet. Eine `stream.ready`-Nachricht bestätigt Epoche und aktuelle Watermark.

Snapshot/Subscribe-Race, Buffer-Überlauf, Child-/Gateway-Neustart, mehrfacher Reconnect und Event-Deduplikation werden deterministisch getestet.

## 10. Desktop-Bootstrap und Prozessaufsicht

Electron erzeugt pro Start ein 256-Bit-Bridge-Secret und öffnet selbst den stabilen Agent Gateway auf `127.0.0.1:0`. Dieser Listener bleibt über Agent-Host-Crashes bestehen. Erst der gebundene Port wird ausschließlich an `start:web`, niemals an `build:web`, zusammen mit dem Secret weitergegeben; es gibt keinen Find-free-port-TOCTOU.

Der Root-Build erzeugt vor `dev:desktop` das ESM-Bundle `apps/agent-host/dist/entry.mjs`. Electron 44 startet es nach `app.ready` explizit mit `utilityProcess.fork`, dessen Node-Runtime beim Start auf Node >=24 und die erwartete IPC-Protokollversion geprüft wird. Ein fehlendes/veraltetes Artefakt ergibt `agent_host_build_missing`, ohne einen beliebigen System-Node zu suchen.

Gateway und Utility Process kommunizieren ausschließlich über versionierte, größenbegrenzte IPC-Envelopes. Der Gateway hält Clientverbindungen, Bridge-Auth und die stabile Adresse; nach Child-Restart erhöht er `childGeneration`, beantwortet laufende Requests terminal mit `agent_restarted` und publiziert `stream.resync_required` innerhalb derselben Gateway-Epoche. Ein echter Integrationstest führt Next → stabilen Gateway → abgestürzten/neuen Host aus und prüft Generation und Identität, ohne Next neu zu starten.

Agent Host und Codex erhalten getrennte minimale Environments. Der Utility Process erhält nur Locale, app-eigene Pfade, Profil-/Protokollversion und notwendige Runtimewerte über `utilityProcess.fork({ env })`; keine Finance-Tokens, DB-URL oder das Gateway-Secret. Der Codex-Child erhält eine noch kleinere Allowlist mit app-eigenem `CODEX_HOME`, Workspace und Systempfaden. Tests inspizieren beide Environments separat.

Ist bereits ein fremder oder vorab gestarteter Webdienst auf Port 3000 aktiv, startet Electron weder Gateway noch Agent Host und die bestehenden Next-Routen antworten `agent_runtime_not_attached`. V1 besitzt keinen dynamischen Nachkonfigurationskanal für fremde Webprozesse. Readiness prüft Dienstidentität, App-Instance und Protokollversion. Das Feature bleibt optional: fehlende Isolation, Login oder Codex-Verfügbarkeit dürfen den restlichen Desktop-Start nicht blockieren.

Utility-Restart-Budget: maximal zwei aufeinanderfolgende Neustarts mit 1 s/4 s Backoff; nach zehn stabilen Minuten Reset. Ein Control-App-Server darf nach Revalidation einmal neu starten. Ein Execution-App-Server darf nur im idle/config-Zustand einmal neu starten; während Thread-Erstellung oder Turn entsteht stattdessen ein terminaler Fehler/Salvage. Aktive Turns werden nie wiederholt.

Ein App-Server-Exit beendet zunächst nur seine RPCs; der Utility Host führt die linke Spalte aus. Ein Utility-Exit wird vom Gateway erkannt; Electron führt vor einem neuen Utility die rechte Spalte über die gemeinsame Recovery-Engine aus:

| Phase | App-Server-Exit bei lebendem Utility | Utility-Exit / Verhalten vor Restart |
| --- | --- | --- |
| Account Read / Login | Pending Login invalidieren, Control neu starten, `account/read`; kein Auto-Login | Login-/Request-IDs verwerfen, neuen Utility/Control starten, Auth revalidieren |
| Logout/Auth-Write | Control neu starten und `account/read`; Ergebnis anzeigen, nicht blind wiederholen | neuen Utility/Control starten, Auth revalidieren; Nutzer entscheidet erneuten Logout |
| Import/Scanner/Temp-Rename | kein App Server aktiv; nicht anwendbar | `.importing-*` ohne durable Manifest entfernen; committed Workspace/Baseline vollständig hashprüfen oder `recovery_required` |
| Config-Revalidation | Execution beenden; einmal neu starten und vollständig revalidieren; vorhandene benutzte Session `context_lost` | Workspace hashprüfen; neuer Execution-Server erst nach vollständiger Configprüfung, kein Ersatzthread |
| Thread-Erstellung | alle neuen IDs verwerfen; kein automatischer Retry | neue öffentliche IDs; alter Start-Key terminal `agent_restarted`; neuer Nutzerstart nötig |
| Turn aktiv | Turn `failed`, Requests auflösen, Session/Thread `context_lost`, Workspace `salvage_ready`; keine Fortsetzung | identisch, zusätzlich Gateway-Projektion resyncen |
| Diffreview aktiv | nicht vom App Server abhängig; Utility führt Review weiter | Revision/Token invalidieren, Lock atomar lösen, `expired` publizieren |
| Apply aktiv | nicht vom App Server abhängig; Utility führt Shared Engine weiter | Electron reconciled Journal; bei Unsicherheit `recovery_required`, kein Utility-Restart |
| Workspace idle | Workspace/Config revalidieren; benutzte Session `context_lost`, kein automatischer Thread | Baseline-/Workspace-Hashes prüfen; Workspace-ID neu ausgeben, alte Session lesbar `context_lost`, expliziter neuer Chat nötig |
| Delete-all | App Server wird ohnehin reapbar gestoppt | Electron setzt seine Delete-all-Transaktion und Journal-Recovery fort |

Alte Thread-, Turn-, Request-, Revision- und Approval-IDs werden nie übernommen. Der Gateway behält Idempotency-Einträge bis TTL nur mit dem terminalen Ergebnis `agent_restarted`, damit derselbe Key keine Mutation wiederholt. Ein rehydrierter Workspace erhält eine neue öffentliche ID; einen neuen Execution-App-Server/Thread gibt es erst nach explizitem „Neue Unterhaltung“. Crash-Injection testet jede Tabellenzeile und den sichtbaren Kontextbruch.

V1 testet Prozessbaum-Shutdown ausschließlich auf macOS: neue Requests sperren, Turns interrupten, IPC schließen, `SIGTERM`, nach fünf Sekunden Prozessgruppe `SIGKILL`. Windows-/Linux-Semantik ist nicht Teil dieser Phase.

## 11. Next.js-Proxy und Browser-Schutz

Vor Implementierung werden die mit Next.js 16.3.0 ausgelieferten Route-Handler- und Streaming-Dokumente unter `apps/web/node_modules/next/dist/docs/` gelesen.

Neue Server-only Utilities kapseln Bridge-URL und Secret. Der Browser lädt `/api/agent/bootstrap` per `fetch` und erhält einen pro Gateway-Epoche zufälligen CSRF-Token für seinen JS-Speicher. Bereits Bootstrap und ausnahmslos jede weitere `/api/agent/*`-Route – Reads, Status, Diff und Stream eingeschlossen – verlangen exakte Desktop-Origin und `Sec-Fetch-Site: same-origin`. Jede Route nach Bootstrap verlangt zusätzlich den CSRF-Header; Mutationen verlangen außerdem:

- JSON Content Type und 128-KiB-Bodylimit;
- keine Auswertung clientkontrollierter Forwarded-Header.

Fehlende Origin-/Fetch-Metadaten werden für alle Agent-Routen abgelehnt. Der SSE-Stream nutzt `fetch`/ReadableStream mit CSRF-Header, nicht native `EventSource`; Tokens erscheinen nie in URLs. Proxy und Gateway begrenzen Reads, Streams, Mutationsrate und Parallelität. Der Proxy leitet keine Cookies, Hop-by-hop- oder beliebigen Client-Header weiter, bricht Upstream bei Disconnect ab und erhält SSE ohne Buffering. Responses setzen `no-store`, eine restriktive CSP und keine CORS-Freigabe.

Der Next-Prozess besitzt wegen der bestehenden Finance-Routen weiterhin `FINANCE_OS_API_TOKEN`; die Sicherheitsgarantie ist deshalb eine Modul- und Weiterleitungsgrenze, keine Prozessisolation. Agent-Route-Module dürfen `finance-api.ts` nicht importieren, lesen keine Finance-Environmentwerte und leiten ausschließlich die festgeschriebenen Header/Bodyfelder an den Gateway. Agent Host und Gateway erhalten keine Owner-/Agent-Credentials. Architektur-/Import-Tests, Test-Tokens und Request-Capture beweisen, dass Agent-Routen Finance-Tokens weder lesen, loggen noch an Gateway/Browser weiterleiten. Buildartefakte und Client-Bundles werden zusätzlich auf Bridge-Secret-Marker geprüft.

## 12. Weboberfläche

### 12.1 Komponenten und Zustände

```text
apps/web/src/components/agent/
  agent-workspace.tsx
  agent-timeline.tsx
  agent-activity-card.tsx
  agent-request-card.tsx
  agent-diff-review.tsx
  agent-composer.tsx
  agent-setup-state.tsx
  use-agent-session.ts
```

`workspace-shell.tsx` erhält „Agent“. Explizite Zustände: Feature aus, Source-run-Web nicht angehängt, Isolation fehlgeschlagen, Login erforderlich, inkompatibles Protokoll, Import blockiert, idle/running, mehrere Pending Requests, Reconnect/Resync, Output gekürzt, Diff-Konflikt und Host degraded.

Der Composer ist bei aktivem Turn gesperrt; Stop bleibt erreichbar. Text-Deltas werden zeit-/größenbasiert gebündelt, damit nicht jedes Token rendert. Die Threadliste enthält nur ephemere Threads der aktuellen Epoche.

V1 rendert Agentinhalt ausschließlich als Plain Text. Es gibt kein Markdown, kein Raw HTML und keine klickbaren Links aus Modelloutput. Commands und Diffs sind ebenfalls Text. Spätere Rich-Text-Unterstützung benötigt einen separaten Sanitizer-/CSP-Entscheid.

### 12.2 Accessibility und informierte Zustimmung

- Timeline nutzt eine gebündelte, zurückhaltende `aria-live`-Region.
- Request- und Apply-Dialoge besitzen Focus Trap, Rückgabe des Fokus und vollständige Tastaturbedienung.
- Status wird nie nur farblich vermittelt; Reduced Motion wird respektiert.
- Accept ist bei fehlenden, gekürzten oder inkonsistenten Details deaktiviert.
- Create/Modify/Delete/Rename, vollständiger Diff, Zielpfade und Capability sind vor Zustimmung sichtbar.
- Keine Aktion erhält per Default Fokus auf „Accept“.

## 13. Test- und Sicherheitsgates

### Phase-0-Gates mit echter gepinnter CLI

- Der Runtime-Selbsttest akzeptiert ausschließlich macOS 15.6 arm64 und den freigegebenen Profil-Hash.
- Seatbelt erlaubt Login/App-Server-Betrieb, verweigert aber Live-Checkout, `.env`, `.env.local`, Dokumentpfade, Codex-Auth aus Tool-Prozessen und externe Symlinks.
- Tool-Prozesse erreichen weder Keychain, Apple Events, Pasteboard, unerlaubte Mach/XPC-Dienste, Unix-Sockets/Loopback, fremde Prozesse noch TCC-Pfade; Tool-Netzwerk und jede Permission-/Root-Eskalation werden abgelehnt.
- `ephemeral: true` hinterlässt keine wiederaufnehmbare Thread-Historie.
- Effektive Config enthält vor jedem Thread/Turn keine fremden MCPs, Hooks, Plugins, Apps oder Skills; erzeugte Projektconfig oder `skills/changed` blockiert den Folgeturn.
- Alle Varianten des gepinnten `ServerRequest` besitzen das spezifizierte Terminalverhalten.

Scheitert eines dieser Gates, endet die V1-Umsetzung vor UI- oder Proxy-Arbeit.

### Hermetische Agent-Host-Tests

Der Fake App Server spricht echtes JSON-RPC über Child-stdio. Tests decken fragmentierte UTF-8-/JSONL-Frames, Mehrfachframes, 8-MiB-Limit, linearen Speicher, Backpressure, Runtime-Schemafehler, Timeouts, Child-Exit, unbekannte Events, alle Server Requests, Multi-Approval-Races, Interrupt/Late Response, Queue-Überlastung, stderr-Redaction und Environment-Allowlist ab. Separate Chunk-Contract-Tests laufen an den zustandsbehafteten Assemblergrenzen App Server→Host, Host→Gateway und Gateway→Browser: maximale JSON-Escaping-Eingaben, Base64-Grenzen, fehlende/doppelte/ungeordnete Chunks, ungültige deklarierte Bytelängen, falscher Digest, fehlender Completion Marker, Timeout und je ein Byte über Message-, Summary-, Command-, Approval-Diff-, Revisions-Diff-, IPC-Envelope-, Event- und Snapshotlimit. Next-Proxy-Tests prüfen stattdessen pro Envelope/HTTP-Stream Schema, Base64, Chunk-/Gesamtbytes, Abbruch und Cleanup ohne erfundenen clientbezogenen Zustand. Endpoint-/Race-Tests rufen exakt `POST /v1/threads/:id/requests/:token` mit richtiger und fremder Thread-/Token-Kombination auf und senden `accept` vor Completion, gleichzeitig mit Completion, nach Abort/Timeout/Child-Exit und als Late Retry; nur genau eine serialisierte Transition aus `approvable` darf dem App Server Accept beantworten, alle anderen Pfade bleiben fail-closed.

Thread-Contract-Tests variieren einzeln Approval Policy, Reviewer, Sandbox, beide CWD-Felder, Instruction Sources, Ephemeral, Session Source und Thread Source. Jede schema-valide Abweichung muss vor Veröffentlichung der Thread-ID den Execution-App-Server beenden.

Import-/Apply-Tests decken das versionierte Gitleaks-Testkorpus, Secret-Dateien, ignored/untracked Regeln, Symlink-/Path-Traversal, TOCTOU, Binärdateien, Rename/Delete, Hashkonflikte, geänderte Create-Ziele, Modusbits, konkurrierende Operationen während Review, Diffrevision/Digests/Approval-Token sowie Salvage-Apply mit Crash, Konflikt und verlorener Response ohne Thread-ID ab. Getrennte Digest-Tests beweisen: gleiche Anzeige-Diffbytes ergeben denselben `contentSha256`, während jede isolierte Änderung an Baseline-ID, Modusbit, strukturierter Operation, Pfad oder Zielbyte den `revisionDigest` ändert und Apply mit dem alten Digest scheitert. Review-POST-Tests linearisieren Completion gegen Disconnect, 10-Sekunden-Timeout, Abort, Cancel, Token-Erzeugung und verlorene Response; der Apply-Endpoint weist unabhängig jeden Zustand außer `ready` ab. Erkennbare synthetische Secrets werden erst zur Testlaufzeit aus harmlosen Fragmenten in einem temporären Verzeichnis zusammengesetzt; im Repository existiert keine Scanner-Ausnahme und der echte Finance-OS-Repo-Import bleibt ein Gate. `git init`, `.git`-/Index-/Ref-Austausch und Baseline-Löschung dürfen den host-only Diff nicht verändern. Crash-Injection nach jedem Apply-Schritt beweist Journal-Reconcile, Rollback oder dauerhaften Recovery-Lock. Kein Fixture enthält echte Credentials oder Finanzdaten.

Storage-Negativtests erzeugen per `dd`/`truncate`, schneller Shell-Redirection und parallelen Writern Großdateien und mehr als 20.000 Einträge. Das 512-MiB-Workspace-Image verhindert Host-Disk-Fill; Watcher beendet Codex, und Apply beginnt nur mit nachweislich vorreserviertem Recovery-Worst-Case.

Lasttests beweisen die numerischen Frame-, Event-, Snapshot-, Replay-, Output-, IPC-, Client- und Queuegrenzen sowie 1,75-GiB-Image-/2-GiB-Gesamtpfadbudget ohne unbeschränktes Wachstum. Import, Diffrevision und Lock-Expiry besitzen Timeout-/Cleanup-Tests.

### Desktop- und Webtests

- UtilityProcess-Build/IPC-Vertrag, stabiler Gateway-Port, getrennte Gateway-/Host-/Codex-Environments und vorhandener Fremd-Webprozess;
- optionaler/degraded Agent ohne Ausfall der Finanzdienste;
- Restart-Budget und macOS-Prozessgruppen-Shutdown;
- exakte Origin-/Fetch-/CSRF-Prüfung auch für Bootstrap/GET/SSE, Rate-/Body-Limits und keine Forwarded-Header-Vertrauensannahme;
- Snapshot-Watermark, Replay, Gap, Epoch-Wechsel und langsame Clients; Reload/Gap nach jeder Chunkgrenze sowie Races `Snapshot freeze ↔ chunk ↔ completion/abort` prüfen Präfixdigest, `nextSequence`, Zielbindung und lückenlose Fortsetzung ab dem Watermark;
- inkrementelle 16-MiB-Snapshot-Serialisierung/-Weiterleitung ohne doppelte Vollpufferung sowie harter Abbruch und deterministische Projection-Eviction oberhalb des Limits;
- globale Pre-thread-Snapshots während Login/Import, Child-Crashmatrix, Review-Expiry und Delete-all-Gateway-Events;
- Message-/Activity-/Approval-Rekonstruktion aus sequenzierten Content-Chunks, Completion Marker und Digest sowie Abort/Truncation nach Chunkfehler oder Replay-Gap;
- Revisions-Diff-Streaming bindet `revision_diff` an `revisionId`/`contentSha256`, hält `revisionDigest` als separate Apply-Autorität, wird erst nach Completion `ready`, erlaubt vorher keinen Apply-Token und verfällt bei jedem Abort-/Resume-Fehler;
- ephemerer Threadverlust markiert Session/Thread `context_lost`, sperrt Composer und verlangt sichtbaren neuen Chat ohne vorgetäuschte Kontextfortsetzung; Race-Tests serialisieren parallelen New-Chat gegen Child-Reap, Review und Apply;
- Delete-all rotiert Epoche/CSRF, leert Projection/Ring/Ledger/Tokens und weist alte Event-IDs ab;
- Control-/Execution-Serialisierung und jede Crashphase aus Abschnitt 10 auf App-Server- und Utility-Ebene;
- Exhaustiveness von Fehler-, Operation- und Zustandsmappern sowie HTTP-Statusumschlag;
- gemeinsamer Next-Prozess mit gesetztem Test-Owner-Token, das Agent-Routen weder lesen noch weiterleiten;
- alle UI-, Approval-, Diff-, Konflikt-, Fokus- und Tastaturzustände;
- Plain-Text-Darstellung gegen XSS und gefährliche Link-Automatismen;
- Scan von Client-Bundles, Buildartefakten, Logs und Child-Environment auf Test-Secrets.

### Manuelle Source-run-Abnahme

Die Abnahme nutzt ein temporäres synthetisches Repository ohne Kunden-/Finanzdaten. Sie prüft fehlendes Login, app-eigenen Device-Code-Login, sicheren Import, Streaming, sichere/unsichere Approval-Fälle, Stop, eingefrorene Diffrevision, Live-Konflikt, Reconnect, Codex-/Host-Crash, Apply-Crash-Recovery, Logout und „Alle Agent-Daten löschen“.

## 14. Lieferphasen und fokussierte Commits

Vor Beginn wird der vorhandene Worktree inventarisiert; die Umsetzung erfolgt auf einem separaten kurzen Branch/Worktree und vermischt keine bestehenden Änderungen. Jeder Commit enthält seine dominanten Tests und hält `main` unabhängig verifizierbar.

### Phase 0 – Entscheidungen und Sicherheits-Spikes

1. `docs(agent): decide isolated codex workspace boundary`
   - ADR mit Plattform-, Home-, Auth-, Import-/Apply- und Capability-Entscheiden.
2. `build(agent-host): pin codex schema generator`
   - exakte CLI-Dependency, Lockfile, TS-/JSON-Schema-Generierung und Drift-Check.
3. `build(agent): pin verified secret scanner tool`
   - reproduzierbarer macOS-arm64-Installer, Hash-/Lizenzcheck und runtime-erzeugte Testdaten.
4. `test(agent-host): add codex protocol contract harness`
   - Fake App Server und echte CLI-Contract-Smokes für sämtliche Server Requests.
5. `test(agent-host): prove macos codex isolation boundary`
   - macOS-15.6-arm64-Selbsttest, Seatbelt-, Auth-, Config-, Ephemeral-, Datei-, lokale Capability- und Network-Negativtests.

Gate: Alle echten CLI-/Isolationskriterien aus Abschnitt 13 sind grün. Andernfalls keine Phase 1.

### Phase 1 – Protokoll, State und Workspace

6. `feat(agent-host): add validated bounded json-rpc transport`
   - Framing, Ajv-Validierung, Backpressure, Limits und Tests zusammen.
7. `feat(agent-host): add deterministic session state machine`
   - orthogonale Zustände, Request-Korrelation, Events und Race-Tests.
8. `feat(agent-storage): add bounded apfs storage lifecycle`
   - Imageerzeugung, Hash-/Mount-/Kapazitätsprüfung, Watcher, Reservation, Detach, Manipulations-, Disk-full- und Crash-Cleanup-Tests.
9. `feat(agent-workspace): add sanitized workspace importer`
   - host-only Baseline, Import, gepinnter Scanner, Kontrollpfad-/Pfadprüfungen und negative Tests.
10. `feat(agent-workspace): add reviewed diff apply and recovery`
   - Workspace-Lock, immutable Diffrevision, Hashbindung, durable Journal/Rollback und Crash-/Konflikttests.

### Phase 2 – API, Replay und Desktop

11. `feat(agent-host): expose validated bounded ipc contract`
   - öffentliche Schemas, Ownership, Idempotenz, Rate-/Ressourcenlimits und Tests.
12. `refactor(desktop): support isolated utility services`
    - Agent-Host-Build, UtilityProcess, getrennte Environments und Prozessaufsicht samt Tests.
13. `feat(desktop): add stable codex agent gateway`
    - stabiler Port-0-Gateway, globaler Reducer/Replay, IPC-Routing, Fremd-Webprozess, Crashmatrix, Delete-all und Shutdown samt Tests.

### Phase 3 – Sicherer Proxy und UI

14. `feat(web): add secured agent command and sse proxy`
    - CSRF, exakte Origin, Header-/Body-/Rate-Limits, Streaming und Tests.
15. `feat(web): add epoch-aware agent client state`
    - Snapshot/Replay/Resync, Deduplikation und Reducer-Tests.
16. `feat(web): add coding agent chat workspace`
    - Setup, Plain-Text-Timeline, Composer und Interaktionstests; Feature bleibt aus.
17. `feat(web): add agent request and diff review flows`
    - informierte Zustimmung, Apply-Konflikt und Accessibility-Tests.
18. `feat(desktop): enable source-run codex agent flag`
    - erst jetzt sichtbarer End-to-end-Pfad, vollständige Quality- und manuelle Abnahme.

### Phase 4 – Dokumentation und Upgradeprozess

19. `docs(agent): document setup data storage and recovery`
20. `ci(agent): gate codex schema compatibility and secret scans`

Gate: `pnpm quality`, echte CLI-Smokes und manuelle macOS-Source-run-Abnahme sind grün. Packaging bleibt ausdrücklich außerhalb dieses Gates.

## 15. Build- und Qualitätsintegration

Neue Root-Skripte:

```text
generate:codex-schema
check:codex-schema
bootstrap:agent-tools
check:agent-tools
build:agent-storage
typecheck:agent-storage
test:agent-storage
quality:agent-storage
build:agent-workspace
typecheck:agent-workspace
test:agent-workspace
quality:agent-workspace
typecheck:agent-host
test:agent-host
test:agent-host:contract
test:agent-host:isolation
build:agent-host
quality:agent-host
build:agent-runtime
```

`build:agent-runtime` baut topologisch Storage, Workspace und Host. `apps/desktop/package.json` führt für `dev` zuerst dieses Root-Skript und erst danach `electron .` aus. Root-`dev:desktop` bleibt der einzige unterstützte Source-run-Start. Root-`pnpm quality` bindet `quality:agent-storage`, `quality:agent-workspace` und `quality:agent-host` zwingend vor `quality:desktop` ein. Echte CLI-/Seatbelt-/APFS-Smokes laufen auf dem freigegebenen macOS-15.6-arm64-CI-Runner und dürfen weder durch Plattform-Guards noch fehlende Tools still übersprungen werden. Dependency-Audit, Repository-Safety und Secret-Scan bleiben verpflichtend.

## 16. Rollout, Recovery und Datenschutz

- `FINANCE_OS_ENABLE_CODEX_AGENT=1` aktiviert die Source-run-Funktion serverseitig.
- Ohne vom Desktop gestarteten Webprozess bleibt der Agent deaktiviert.
- First-run erklärt Modellübertragung, app-eigenen Auth-/Workspace-Speicher und Löschweg.
- Vor jedem Cleanup reconciled Electron persistente Apply-Journale. Erst ohne `applying`/`rollback_required` werden App-Workspaces beim normalen Shutdown gelöscht; nach Crash werden verwaiste Workspaces beim nächsten Start nach Pfad-/Owner-Prüfung entfernt. Unklare Recovery blockiert Cleanup und Live-Applies.
- Das app-eigene Codex-Home bleibt bis Logout oder explizitem vollständigem Löschen erhalten.
- Modellinhalt, Tooloutput und Diffs gelangen nicht in allgemeine Logs oder PostgreSQL.
- Fehler beim Agenten führen in `degraded`, nicht zum Ausfall von Chelaro.
- Es existiert keine Datenbankmigration und kein automatischer Git-Commit/Push.

## 17. Definition of Done

Die V1 ist fertig, wenn:

- echte CLI-Tests die äußere Read-Isolation und innere Network-/Write-Grenze beweisen;
- Codex ausschließlich im sanitisierten Workspace arbeitet und das Live-Repo nur über den separaten hashgebundenen Nutzer-Apply verändert wird;
- app-eigenes Home, Login, restriktive Config, Logout und Datenlöschung funktionieren;
- Protokolltypen und JSON Schemas reproduzierbar gepinnt und zur Laufzeit validiert sind;
- sämtliche gepinnten Server Requests explizit beantwortet werden;
- orthogonale Zustände, Multi-Request-Races, Idempotenz, Limits und Replay/Epoch-Verhalten getestet sind;
- Secrets weder in Child-Environment, Workspace, Logs, Bundles noch Buildartefakten erscheinen;
- Chat, Streaming, Stop sowie sichere Approval- und eingefrorene Diff-Apply-Flows zugänglich funktionieren;
- Electron die Delete-all-Transaktion und Apply-Crash-Recovery vollständig besitzt und testet;
- fehlender/degradierter Agent die übrige App nicht beeinträchtigt;
- vollständige Quality-Pipeline und manuelle macOS-Source-run-Abnahme grün sind;
- ADR, Setup-, Datenschutz-, Berechtigungs-, Recovery- und Upgrade-Dokumentation vorliegen.

## 18. Bewusst nicht enthalten

- Arbeit direkt im Live-Checkout;
- persistente oder wiederaufnehmbare Agent-Threads;
- Network-, Additional-root-, Permission- oder Full-Access-Freigaben;
- Session-weites Always-Allow;
- globale Codex-Konfiguration oder globales `codex login`;
- persistente Agent-Inhalte in PostgreSQL;
- Finance Assistant, Finance MCP oder Zugriff auf Originaldokumente;
- autonome Hintergrund-Loops;
- Packaging, Signierung, Notarisierung, Linux, Windows, Mobile oder Remote-Zugriff;
- Dependency-Mounts sowie Ausführung von Projekt-Tests, Typechecks und Builds im Agent-Workspace;
- Git Commit, Push oder automatische kanonische Finanzänderungen.

## 19. Referenzen

- OpenAI Codex App Server: <https://developers.openai.com/codex/app-server>
- T3 Code Architektur: <https://github.com/pingdotgg/t3code/blob/e2d4d12a81516b55abbecdc64794971f781cacd8/docs/internals/overview.md>
- T3 Code Provider: <https://github.com/pingdotgg/t3code/blob/e2d4d12a81516b55abbecdc64794971f781cacd8/docs/internals/providers.md>
- Gitleaks v8.30.1 Release/Checksums: <https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1>
- Chelaro ADR 0001: `docs/decisions/0001-foundation-architecture.md`
- Chelaro ADR 0003: `docs/decisions/0003-workbook-change-authority.md`
- Chelaro Agent REST Contract: `docs/agents/REST_ACCESS.md`

## 20. Reviewhistorie

- Runde 1: nicht freigegeben; 3 Critical, 12 High und 5 Medium Findings.
- Runde 2: nicht freigegeben; 1 Critical, 7 High und 8 Medium Findings.
- Runde 3: nicht freigegeben; 3 High und 7 Medium Findings.
- Runde 4: nicht freigegeben; 4 High und 5 Medium Findings.
- Runde 5: nicht freigegeben; 1 Blocker, 1 High und 3 Medium Findings.
- Runde 6: nicht freigegeben; 1 High und 2 Medium Findings.
- Runde 7: nicht freigegeben; 1 Medium Finding zur widersprüchlichen Größen- und Transportdefinition großer Public Payloads.
- Runde 8: nicht freigegeben; 2 High und 1 Medium Findings zu Resume laufender Streams, serverseitigem Approval-Fail-closed und Revisions-Diff-Transport.
- Runde 9: nicht freigegeben; 1 High und 3 Medium Findings zu getrennten Revisions-/Content-Digests, Apply-Token-Transport, zustandsloser Next-Prüfung und kanonischem Approval-Pfad.
- Runde 10: freigegeben; keine Blocker-, Critical-, High- oder Medium-Findings, `VERDICT: APPROVED`. Zwei optionale Low-Nitpicks werden vor Abschluss bereinigt.
- Runde 11: final freigegeben; keine Findings, `VERDICT: APPROVED`. `request.opened` ist als diskriminierte Union modelliert; leere Streams enden ohne leeren Chunk direkt mit `content.completed`.
