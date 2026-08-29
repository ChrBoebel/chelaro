# Chelaro Web

Die Next.js-Oberfläche für persönliche Finanzen, Belege, Rechnungen und überprüfbare
KI-Vorschläge. Sie stellt keine eigene kanonische Finanzlogik bereit, sondern spricht über
Same-Origin-Routen mit der Chelaro API.

## Entwickeln

Vom Repository-Root aus:

```bash
cp apps/web/.env.example apps/web/.env.local
pnpm dev:web
```

Die Anwendung ist anschließend unter [http://127.0.0.1:3000](http://127.0.0.1:3000) erreichbar.
`FINANCE_OS_API_URL` und `FINANCE_OS_API_TOKEN` müssen auf die lokale API zeigen. Tokens dürfen
nicht mit `NEXT_PUBLIC_` beginnen und niemals an den Browser ausgeliefert werden.

## Qualitätsprüfungen

```bash
pnpm lint:web
pnpm typecheck:web
pnpm test:web
pnpm build:web
```

Gemeinsame UI-Primitives liegen unter `src/components/ui`. Öffentliche Produktoberflächen nennen
die Funktion „KI“; konkrete Anbieter- oder Agentennamen erscheinen nur dort, wo technische oder
Einwilligungstransparenz sie erfordert.

Die Source Preview verwendet ausschließlich eine text- und CSS-basierte Wort-/Buchstabenmarke;
Logo- und Bilddateien sind nicht enthalten.

Weitere Details: [Architektur](../../docs/architecture/ARCHITECTURE.md)
