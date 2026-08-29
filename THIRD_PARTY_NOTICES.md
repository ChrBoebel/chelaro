# Drittanbieterhinweise

Chelaro verwendet Abhängigkeiten und enthält abgeleitete oder generierte Bestandteile, die unter
eigenen Lizenzen stehen. Diese Drittanbieterrechte werden durch die Chelaro-Lizenz nicht ersetzt
oder eingeschränkt. Bei einer Weitergabe müssen die jeweils anwendbaren Lizenz- und
Hinweispflichten eingehalten werden.

## OpenAI Codex

Die Dateien unter `apps/agent-host/generated/codex/` wurden aus den Protokollschemas von
`@openai/codex` Version `0.149.1` erzeugt. Das Paket und seine zugrunde liegenden Bestandteile
stehen unter der Apache License 2.0.

- Projekt: <https://github.com/openai/codex>
- Lizenz: [Apache License 2.0](LICENSES/Apache-2.0.txt)

## Paketabhängigkeiten

Weitere JavaScript- und Python-Abhängigkeiten sind in `pnpm-lock.yaml` und `uv.lock` reproduzierbar
festgehalten. Ihre jeweiligen Paketmetadaten und Lizenztexte sind maßgeblich. Wer Chelaro in
Quell- oder Binärform weitergibt, ist dafür verantwortlich, die dafür erforderlichen
Drittanbieterhinweise vollständig mitzuliefern.
