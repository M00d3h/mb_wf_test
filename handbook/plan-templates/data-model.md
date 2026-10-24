# Data model

**Use for:** writing or changing the data model. Usually a child of [architecture](architecture.md).
**Usually needs:** the architecture overview and the requirements.
**Produces:** `docs/architecture/data-model.md`, and a schema file if the stack has one

## Steps

- [ ] Decide whether the system needs a database at all. If not, say so, say where state lives
  instead, and stop.
- [ ] Search the requirements for anything that tracks, logs, records, retries or expires. Give each
  a table, or a stated reason it doesn't need one.
- [ ] Write the model: entities, relations, constraints enforced in the database rather than only in
  code, indexes justified by the queries that need them, audit fields on every table. Think past the
  happy path: audit trails, lockouts, failed and retried integrations, idempotency, soft deletes
  combined with uniqueness, a version column for anything edited concurrently.
- [ ] Say how migrations run, and that each one can be run twice safely.
- [ ] Review in a fresh session through the data lens: what's missing that nobody mentioned, what
  - [ ] Review in a fresh session through the data lens: what's missing that nobody mentioned, what breaks under concurrency, what a migration could leave half done.
- [ ] Resolve findings. If this changes a model other work already uses, write an ADR.
- [ ] The engineer approves. Merge to main.
- [ ] Close.
