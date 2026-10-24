# Architecture change

**Use for:** changing an architecture that already exists: a new service, a schema change other work depends on, moving a store, a new integration. Can stand alone or be the first child of an epic that builds on it.
**Usually needs:** the current architecture, and the requirements the change serves.
**Produces:** a proposal in the item, then updated `docs/architecture/` and an ADR

## Steps

- [ ] Write `proposal.md`: what changes and why, section by section against the current architecture ("changes data model: adds `links` table"), with "no change" stated for the parts that don't move so reviewers know what to skip. Read the code, not only the docs: if they disagree, work from the code and say so. Schema changes as actual schema, before and after. Say whether migrations deploy before or after the code.
- [ ] Review in a fresh session: **the proposal.** A new endpoint has data behind it. A new entity has the operations users need. A new user-facing feature has access rules. A new integration tracks what it sends. A new slow operation reports status. Departures from the architecture have a reason worth accepting.
- [ ] Review in a fresh session: **cross-cutting.** Security (auth on new paths, audit for new data, new attack surface). Data (conventions, indexes justified by queries, a version column for anything edited concurrently). Services (no new cycles, existing ones still do one job). Operations (new config, visibility of async work, deploy order). Testing (fixtures for new integrations).
- [ ] Review in a fresh session: **requirements coverage.** Every requirement this serves maps to the proposal or to an existing section. Check the existing section, don't trust the proposal.
- [ ] Review in a fresh session: **UX impact.** Skip if nothing user-facing changes.
- [ ] Check new or changed dependencies against the dependency policy, with versions looked up. Skip if none.
- [ ] Resolve findings with the engineer; rerun reviews that came back "Revise".
- [ ] The engineer approves the change.
- [ ] Update `docs/architecture/` to describe the new state, as if it had always been this way, and write the ADR for the history. Check links between documents still hold.
- [ ] Merge to main before anything builds on it.
- [ ] If existing code has to change to match, add the steps from `{feature}/feature.md` here, or create child items for it.
- [ ] Close.

writing or changing any project standard that doesn't have its own template: engineering principles, voice and copy, accessibility targets,...

exploring what the product, or one screen of it, should look and feel like before it's built. Runs alongside the architecture; it doesn't need it.

# Architecture sections

ENG US 13:1
