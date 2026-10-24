# API

**Use for:** writing or changing the API. Usually a child of [architecture](architecture.md).

**Usually needs:** the architecture overview and the requirements. The data model helps; the two can run together, since the architecture's consistency review catches mismatches.

**Produces:** `docs/architecture/api.md`

## Steps

- [ ] Size it to the real surface. If there's effectively no API, say so and stop.
- [ ] For each endpoint or operation: who can call it, the request, the response, every error, and where validation happens. Realtime or streaming events only if the product needs them.
- [ ] Say how errors are shaped everywhere, how lists are paginated and filtered, how the API is versioned, and where rate limits apply.
- [ ] Review in a fresh session through the security and product lenses: every operation has access rules, errors don't leak internals, and each requirement has the operations it needs.
- [ ] Resolve findings. If this changes an API other work already uses, write an ADR.
- [ ] The engineer approves. Merge to main.
- [ ] Close.
