# Lokale Infrastruktur

Der lokale Stack verwendet PostgreSQL 17. Der Multi-Plattform-Image-Digest ist für
reproduzierbare Builds festgeschrieben, der Port ausschließlich an localhost gebunden und die
Daten werden in einem benannten Docker-Volume gespeichert.

Alle Befehle werden vom Repository-Root ausgeführt:

```bash
cp .env.example .env
# Vor dem Start das Platzhalterpasswort in FINANCE_OS_POSTGRES_PASSWORD
# und FINANCE_OS_DATABASE_URL ersetzen.
pnpm infra:up
docker compose --env-file .env -f infra/docker/compose.yaml ps
```

Dienst stoppen, ohne die Daten zu löschen:

```bash
pnpm infra:down
```

Das Löschen des Volumes `postgres_data` vernichtet lokale Finanzmetadaten und ist deshalb bewusst
nicht Bestandteil eines Repository-Skripts.
