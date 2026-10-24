# Deployment

**Use for:** writing or changing how the system is built, released, run and rolled back. Usually a child of [architecture](architecture.md).
**Usually needs:** the architecture overview.
**Produces:** `docs/architecture/deployment.md`

## Steps

- [ ] Ask the engineer about hosting, budget, and any organisation requirements. Notes in `brief.md`.
- [ ] Write the design: environments, how a release happens, config and secrets, health checks that check something real, logs that trace a request, alerts, backups, rollback. Size it to the product: no cluster for a site that doesn't need one.
- [ ] Say how each managed service runs locally, and where local differs from production.
- [ ] Say in what order migrations and code deploy. If migrations run first, every migration must work with the code already running, so anything destructive takes two releases.
- [ ] Review in a fresh session through the operability lens: how you'd know it's broken, what happens when a dependency is down, and whether rollback actually works.
- [ ] Resolve findings. If this changes a design other work already follows, write an ADR.
- [ ] The engineer approves. Merge to main.
- [ ] Close.
