# ADR 0001: Foundation architecture

- Status: Accepted
- Date: 2026-08-13

## Context

Chelaro handles sensitive documents and exposes controlled capabilities to both a web client and external agents. The system needs one domain contract, background document processing, reproducible local development, and an upgrade path to private cloud deployment.

## Decision

- Use a monorepo with Next.js for the web application and FastAPI for the domain API.
- Keep FastAPI as the canonical business boundary; Next.js does not access PostgreSQL directly.
- Use PostgreSQL as the control plane and an S3-compatible object store for immutable blobs.
- Run OCR and extraction outside request handlers in a durable worker pipeline.
- Expose agent capabilities through a Python MCP adapter that calls the same application services as REST.
- Generate the TypeScript API client from versioned OpenAPI instead of duplicating schemas.

## Consequences

- Local development needs Node, Python, PostgreSQL, and object storage.
- Cross-service contracts require automated OpenAPI checks.
- Database mutations, audit events, and outbox messages must become atomic before data-writing features ship.
- More infrastructure is accepted in exchange for clearer trust boundaries and reliable recovery.
