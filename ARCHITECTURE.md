# Architecture guide — Backend

AI agents: read this file and [RULES.md](RULES.md) before changing code.

## Source of truth

- [System architecture](docs/architecture/10-de-xuat-kien-truc-va-repo.md)
- [Repository structure and decisions](docs/architecture/11-de-xuat-cau-truc-repo.md)
- [Feed architecture](docs/architecture/10-nghiep-vu-kien-truc-feed.md)
- [Architecture document index and diagrams](docs/architecture/README.md)

## Backend rules

- Keep module boundaries and database ownership described in the architecture docs.
- Modules communicate through their public `index.ts`; do not import another module's internals or query its schema.
- Keep domain code independent of NestJS and Drizzle. Put transactions in application use cases and write events to the outbox in the same transaction.
- Generate contracts from their source; do not edit generated files by hand.
- Follow `RULES.md` for ownership, migrations, idempotency, checks and branch workflow.
