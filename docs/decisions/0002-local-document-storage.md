# ADR 0002: Local document storage

- Status: Accepted
- Date: 2026-08-13

## Context

Chelaro needs durable storage for immutable invoice originals. ADR 0001 selects an S3-compatible object store for production, but local development should remain small and dependable. MinIO's community repository was archived in 2026 and its legacy prebuilt binaries no longer receive updates.

## Decision

- Use a storage interface rather than exposing filesystem paths to domain code or agents.
- Default local development to a gitignored filesystem root at `data/documents`.
- Keep PostgreSQL as the metadata and audit control plane.
- Add a maintained S3-compatible production adapter before the first deployment that contains real documents.
- Preserve the same immutable-object and content-hash contract across both adapters.

## Consequences

- Local setup currently needs only PostgreSQL as a containerized data service.
- Document backups must include both the database and the document root.
- The first real upload milestone must implement atomic metadata registration, content hashing, quarantine, and recovery tests before accepting sensitive files.

## Reference

- [MinIO community distribution notice](https://github.com/minio/minio)
