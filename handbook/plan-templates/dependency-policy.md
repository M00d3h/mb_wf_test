# Dependency policy

**Use for:** writing or changing the project's rules for dependencies, and checking the core technologies. Usually a child of [architecture](architecture.md).
**Usually needs:** the architecture overview, and any dependency guidance in `docs/reference/`.
**Produces:** `docs/architecture/dependency-policy.md`

## Steps

- [ ] Write the rules, each tied to the requirement or guidance it comes from: what a new dependency has to argue, how fresh versions must be, which licences are allowed, and how updates arrive.
- [ ] Check each core technology the overview chose: the version, looked up in the registry and never from memory; maintenance health; advisories; licence; its ADR. If a choice has a problem, tell the engineer: the architecture may need to change.
- [ ] Review in a fresh session through the dependencies lens: are the rules specific enough to decide with, and do the core technologies pass them?
- [ ] Resolve findings. If this changes a policy other work already follows, write an ADR.
- [ ] The engineer approves. Merge to main.
- [ ] Close.


writing or changing what every screen has in common. A child of [architecture](architecture.md), or on its own once there's a UI.

# Starting points
